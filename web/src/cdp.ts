// Chrome via CDP: attach to every page target, inject the perception script, and turn what it
// reports into protocol `state` and `user_event` messages.
import CDP from "chrome-remote-interface";
import { readFileSync } from "node:fs";
import type { El, Rect, ScreenState, UserEvent } from "../../protocol/types.ts";

export const CHROME = "com.google.Chrome";
const INJECT = readFileSync(new URL("./inject.js", import.meta.url), "utf8");
const ECHO_MS = 300; // user events right after our own exec are echoes, not the user

export interface Tab {
    targetId: string;
    client: CDP.Client;
    url: string;
    title: string;
    visible: boolean;
    elements: El[];
    state?: ScreenState; // last state sent
    lastClick?: { rect: Rect; ts: number };
    echoUntil: number;
    closed: boolean;
}

export interface CdpEvents {
    state(s: ScreenState): void;
    userEvent(e: UserEvent): void;
    attached(tab: Tab): void; // pay402 hooks Fetch here
    detached(tab: Tab): void;
}

export class Chrome {
    tabs = new Map<string, Tab>();
    focused: Tab | null = null;
    private seq = 0;
    private connecting = new Set<string>();
    private timer: NodeJS.Timeout | null = null;
    private warned = false;

    constructor(
        private port: number,
        private on: CdpEvents,
    ) {}

    start(): void {
        const tick = () =>
            this.discover()
                .catch((e) => {
                    if (!this.warned) console.warn(`[cdp] Chrome not reachable on :${this.port} (${e.message}). Run: npm run chrome`);
                    this.warned = true;
                })
                .finally(() => (this.timer = setTimeout(tick, 1000)));
        tick();
    }

    stop(): void {
        if (this.timer) clearTimeout(this.timer);
        for (const t of this.tabs.values()) t.client.close().catch(() => {});
    }

    private async discover(): Promise<void> {
        const targets = await CDP.List({ port: this.port });
        if (this.warned) console.log("[cdp] Chrome connected");
        this.warned = false;
        const live = new Set<string>();
        for (const t of targets) {
            if (t.type !== "page" || /^(devtools|chrome-extension|chrome-untrusted):/.test(t.url)) continue;
            live.add(t.id);
            if (!this.tabs.has(t.id) && !this.connecting.has(t.id)) this.attach(t.id).catch((e) => console.warn(`[cdp] attach ${t.url}: ${e.message}`));
        }
        for (const [id, tab] of this.tabs) if (!live.has(id)) this.drop(tab);
    }

    private drop(tab: Tab): void {
        if (tab.closed) return;
        tab.closed = true;
        this.tabs.delete(tab.targetId);
        if (this.focused === tab) this.focused = null;
        tab.client.close().catch(() => {});
        this.on.detached(tab);
    }

    private async attach(targetId: string): Promise<void> {
        this.connecting.add(targetId);
        try {
            const client = await CDP({ port: this.port, target: targetId });
            const tab: Tab = { targetId, client, url: "", title: "", visible: false, elements: [], echoUntil: 0, closed: false };
            client.on("disconnect", () => this.drop(tab));
            client.on("Runtime.bindingCalled", ({ name, payload }) => {
                if (name === "__tabEmit") this.onEmit(tab, payload);
            });
            client.on("Page.frameNavigated", ({ frame }) => {
                if (frame.parentId) return;
                const prev = tab.url;
                tab.url = frame.url;
                if (prev && prev !== frame.url) this.navigated(tab);
            });
            client.on("Page.navigatedWithinDocument", ({ url }) => {
                if (url === tab.url) return;
                tab.url = url;
                this.navigated(tab);
            });
            await client.Runtime.enable();
            await client.Runtime.addBinding({ name: "__tabEmit" });
            await client.Page.enable();
            await client.Page.addScriptToEvaluateOnNewDocument({ source: INJECT });
            this.tabs.set(targetId, tab);
            this.on.attached(tab);
            const { result } = await client.Runtime.evaluate({ expression: "location.href", returnByValue: true });
            tab.url = String(result.value ?? "");
            await client.Runtime.evaluate({ expression: INJECT });
            await this.refresh(tab);
        } finally {
            this.connecting.delete(targetId);
        }
    }

    /** Ask a tab to report its state now. */
    async refresh(tab: Tab): Promise<void> {
        await tab.client.Runtime.evaluate({ expression: "window.__tabState && window.__tabState()" }).catch(() => {});
    }

    private navigated(tab: Tab): void {
        tab.lastClick = undefined;
        if (Date.now() < tab.echoUntil) return;
        this.on.userEvent({ type: "user_event", source: "web", app: CHROME, url: tab.url, kind: "navigate", value: tab.url, ts: Date.now() });
    }

    private onEmit(tab: Tab, payload: string): void {
        let m: any;
        try {
            m = JSON.parse(payload);
        } catch {
            return;
        }
        if (m.kind === "error") return console.warn(`[inject] ${tab.url}: ${m.error}`);
        if (m.kind === "state") {
            tab.url = m.url;
            tab.title = m.title;
            tab.visible = m.visible;
            tab.elements = m.elements;
            const wasFocused = this.focused;
            if (m.focused && m.visible) this.focused = tab;
            if (wasFocused && wasFocused !== this.focused) this.emitState(wasFocused); // it lost focus
            this.emitState(tab);
            return;
        }
        if (m.kind === "user_event") {
            if (m.ev === "click" && m.target) tab.lastClick = { rect: m.target.rect, ts: Date.now() };
            if (Date.now() < tab.echoUntil) return;
            if (m.ev === "focus" || m.ev === "click") {
                const was = this.focused;
                this.focused = tab;
                if (was && was !== tab) this.emitState(was);
            }
            this.on.userEvent({ type: "user_event", source: "web", app: CHROME, url: m.url, kind: m.ev, target: m.target, value: m.value, ts: Date.now() });
        }
    }

    private emitState(tab: Tab): void {
        if (!tab.visible || tab.closed) return;
        const s: ScreenState = {
            type: "state",
            source: "web",
            app: CHROME,
            window: tab.title,
            url: tab.url,
            focused: this.focused === tab,
            elements: tab.elements,
            seq: ++this.seq,
            ts: Date.now(),
        };
        tab.state = s;
        this.on.state(s);
    }

    /** Re-send every visible tab's state (e.g. after the hub reconnects). */
    resendAll(): void {
        for (const t of this.tabs.values()) this.emitState(t);
    }

    /** Mark events from this tab as ours for a moment (exec in progress). */
    echo(tab: Tab, ms = ECHO_MS): void {
        tab.echoUntil = Math.max(tab.echoUntil, Date.now() + ms);
    }

    /** The tab a step belongs to: exact URL, then same path, then same host, then the focused tab. */
    pick(url?: string): Tab | null {
        const tabs = [...this.tabs.values()].filter((t) => !t.closed);
        if (url) {
            let u: URL | null = null;
            try {
                u = new URL(url);
            } catch {}
            const byVis = (a: Tab, b: Tab) => Number(b === this.focused) - Number(a === this.focused) || Number(b.visible) - Number(a.visible);
            const exact = tabs.filter((t) => t.url === url).sort(byVis);
            if (exact[0]) return exact[0];
            if (u) {
                const path = tabs.filter((t) => sameUrl(t.url, (x) => x.origin + x.pathname === u!.origin + u!.pathname)).sort(byVis);
                if (path[0]) return path[0];
                const host = tabs.filter((t) => sameUrl(t.url, (x) => x.host === u!.host)).sort(byVis);
                if (host[0]) return host[0];
            }
        }
        return this.focused ?? tabs.find((t) => t.visible) ?? null;
    }

    async openTab(url: string): Promise<Tab | null> {
        const t = await CDP.New({ port: this.port, url });
        await CDP.Activate({ port: this.port, id: t.id }).catch(() => {});
        for (let i = 0; i < 40; i++) {
            const tab = this.tabs.get(t.id);
            if (tab) return tab;
            await new Promise((r) => setTimeout(r, 50));
            if (i === 5) await this.discover().catch(() => {});
        }
        return null;
    }
}

function sameUrl(s: string, f: (u: URL) => boolean): boolean {
    try {
        return f(new URL(s));
    } catch {
        return false;
    }
}
