// Agent C: makes Chrome visible and controllable for the hub, and handles x402 end to end.
// One CDP connection per page tab. The injected script (inject.js) reports state and user events.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import CDP from "chrome-remote-interface";
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { makeRail, type ParsedChallenge } from "./rail.ts";
import type { Action, El, PaymentRequired, Rect, ScreenState } from "../../protocol/types.ts";
import { fmtUsd, intentCheck } from "./intent.ts";
import { record } from "./ledger.ts";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const CHROME = "com.google.Chrome";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9222);
const HUB = `ws://127.0.0.1:${process.env.HUB_PORT ?? 7800}`;
const INJECT = readFileSync(new URL("./inject.js", import.meta.url), "utf8");
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);

// ---------------- hub ----------------

let hub: WebSocket | null = null;
function connectHub(): void {
    const ws = new WebSocket(HUB);
    ws.on("open", () => {
        hub = ws;
        log("hub: connected");
        ws.send(JSON.stringify({ type: "hello", role: "web" }));
        for (const t of tabs.values()) t.requestState();
    });
    ws.on("message", (d) => void onHub(JSON.parse(String(d))).catch((e) => log("hub msg error:", e)));
    ws.on("close", () => {
        if (hub === ws) hub = null;
        setTimeout(connectHub, 1000);
    });
    ws.on("error", () => {});
}
const send = (m: object) => hub?.readyState === WebSocket.OPEN && hub.send(JSON.stringify(m));

// ---------------- tabs ----------------

type Client = Awaited<ReturnType<typeof CDP>>;

class Tab {
    state: ScreenState | undefined;
    seq = 0;
    lastClick: Rect | undefined;
    lastActive = 0;
    visible = false;
    constructor(
        public id: string,
        public client: Client,
    ) {}

    requestState(): void {
        void this.client.Runtime.evaluate({ expression: "window.__tabState && window.__tabState()" }).catch(() => {});
    }

    onEmit(raw: string): void {
        const m = JSON.parse(raw);
        if (m.kind === "state") {
            this.seq++;
            this.visible = !!m.visible;
            this.state = { type: "state", source: "web", app: CHROME, window: m.title || m.url, url: m.url, focused: m.focused, elements: m.elements, seq: this.seq, ts: Date.now() };
            if (m.focused) {
                this.lastActive = Date.now();
                for (const t of tabs.values()) if (t !== this && t.state) t.state.focused = false;
            }
            send(this.state);
        } else if (m.kind === "user_event") {
            if (m.ev === "click" && m.target) this.lastClick = (m.target as El).rect;
            if (m.ev === "navigate") cancelPayments(this); // a new page load drops any request we were holding
            this.lastActive = Date.now();
            send({ type: "user_event", source: "web", app: CHROME, url: this.state?.url ?? "", kind: m.ev, target: m.target, value: m.value, ts: Date.now() });
        }
    }
}

const tabs = new Map<string, Tab>();

async function attach(id: string): Promise<void> {
    if (tabs.has(id)) return;
    const client = await CDP({ port: CDP_PORT, target: id });
    const tab = new Tab(id, client);
    tabs.set(id, tab);
    client.on("disconnect", () => {
        cancelPayments(tab);
        tabs.delete(id);
    });
    client.Runtime.on("bindingCalled", (e) => e.name === "__tabEmit" && tab.onEmit(e.payload));
    client.Fetch.on("requestPaused", (e) => void onPaused(tab, e).catch((err) => log("paused error:", err)));
    await client.Runtime.enable();
    await client.Runtime.addBinding({ name: "__tabEmit" });
    await client.Page.enable();
    await client.Page.addScriptToEvaluateOnNewDocument({ source: INJECT });
    await client.Fetch.enable({ patterns: [{ urlPattern: "http://*.localhost:*/*", requestStage: "Response" }] });
    await client.Runtime.evaluate({ expression: INJECT });
    tab.requestState();
    log(`tab attached ${id.slice(0, 8)}`);
}

async function discover(): Promise<void> {
    try {
        const list = await CDP.List({ port: CDP_PORT });
        for (const t of list) if (t.type === "page" && !t.url.startsWith("devtools://") && !t.url.startsWith("chrome://")) await attach(t.id).catch((e) => log("attach failed:", e.message));
    } catch (e) {
        log(`no Chrome on :${CDP_PORT} (${(e as Error).message}); launch it with the debug command in PLAN.md`);
    }
}

/** The tab an action belongs to: by url (focused, then visible, then most recently active among matches), else the focused one. */
function tabFor(url?: string): Tab | undefined {
    const rank = (ts: Tab[]) => ts.sort((a, b) => Number(!!b.state?.focused) - Number(!!a.state?.focused) || Number(b.visible) - Number(a.visible) || b.lastActive - a.lastActive)[0];
    const all = [...tabs.values()];
    if (url) {
        const strip = (u: string) => u.replace(/[?#].*$/, "");
        const exact = all.filter((t) => t.state?.url === url);
        if (exact.length) return rank(exact);
        const near = all.filter((t) => t.state?.url && strip(t.state.url) === strip(url));
        if (near.length) return rank(near);
    }
    return rank(all);
}

// ---------------- exec ----------------

let execQueue: Promise<unknown> = Promise.resolve();

async function onHub(m: any): Promise<void> {
    switch (m.type) {
        case "exec": {
            // One action at a time, in order: a click must land before the next step looks at the page.
            const run = execQueue.then(() => exec(m.action as Action));
            execQueue = run.catch(() => {});
            const r: { ok: boolean; error?: string } = await run.then(
                () => ({ ok: true }),
                (e: Error) => ({ ok: false, error: e.message }),
            );
            log(`exec ${m.ghostId} ${m.action.op} ${m.action.targetPath ?? m.action.value ?? ""} → ${r.ok ? "ok" : r.error}`);
            send({ type: "exec_result", ghostId: m.ghostId, ...r });
            break;
        }
        case "pay":
            await pay(m.paymentId);
            break;
        case "dismiss_payment":
            await dismissPayment(m.paymentId);
            break;
        case "open_url":
            await CDP.New({ port: CDP_PORT, url: m.url });
            break;
    }
}

const sel = (a: Action) =>
    JSON.stringify(a.targetPath ? a.targetPath : a.targetId ? `[data-tab-id="${a.targetId}"]` : "");

async function exec(a: Action): Promise<void> {
    const tab = tabFor(a.url);
    if (!tab) throw new Error("no Chrome tab");
    const { Runtime, Input, Page } = tab.client;
    const evalJs = async (expression: string) => {
        const r = await Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
    };

    if (a.op === "navigate") {
        await Page.navigate({ url: a.value! });
        return;
    }
    if (a.op === "key") {
        const key = a.value ?? "Enter";
        const code = key === "Enter" ? 13 : key === "Escape" ? 27 : key === "Tab" ? 9 : 0;
        await Input.dispatchKeyEvent({ type: "keyDown", key, code: key, windowsVirtualKeyCode: code, ...(key === "Enter" ? { text: "\r" } : {}) });
        await Input.dispatchKeyEvent({ type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
        return;
    }

    // Resolve the target: by path (preferred), else by id. Scroll it into view and get its viewport center.
    const info = await evalJs(`(() => {
        let el = ${sel(a)} ? document.querySelector(${sel(a)}) : null;
        if (!el && ${JSON.stringify(a.targetId ?? "")}) el = document.querySelector('[data-tab-id="${a.targetId ?? ""}"]');
        if (!el) return null;
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); // smooth never moves on a hidden page
        const r = el.getBoundingClientRect();
        const top = screenY + (outerHeight - innerHeight);
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName, type: (el.type || ""),
                 screen: { x: Math.round(screenX + r.left), y: Math.round(top + r.top), w: Math.round(r.width), h: Math.round(r.height) } };
    })()`);
    if (!info) throw new Error(`target not found: ${a.targetPath ?? a.targetId}`);
    const find = `(document.querySelector(${sel(a)}) || document.querySelector('[data-tab-id="${a.targetId ?? ""}"]'))`;

    if (a.op === "click") {
        tab.lastClick = info.screen; // measured before the click: it may navigate away
        // Input events are processed asynchronously; wait until the page has seen the click (and its handlers ran),
        // so the next step doesn't overtake it. Navigation destroys the context, which also counts as done.
        const seen = Runtime.evaluate({
            expression: `new Promise(r => { document.addEventListener("click", () => setTimeout(() => r(true), 0), { once: true, capture: true }); setTimeout(() => r(false), 1000); })`,
            awaitPromise: true,
        }).catch(() => null);
        for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const)
            await Input.dispatchMouseEvent({ type, x: info.x, y: info.y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1 });
        const r = await seen;
        if (r && !r.exceptionDetails && r.result.value === false) throw new Error("click not received by the page");
        return;
    }
    if (a.op === "type") {
        if (info.tag === "SELECT") {
            const ok = await evalJs(`(() => { const el = ${find}; const o = [...el.options].find(o => o.label.trim() === ${JSON.stringify(a.value ?? "")});
                if (!o) return false; el.value = o.value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
            if (!ok) throw new Error(`no option "${a.value}"`);
            return;
        }
        // Replace the field's value (not append), then commit it like a user would.
        await evalJs(`(() => { const el = ${find}; el.focus(); if (el.select) el.select(); else document.execCommand("selectAll"); })()`);
        await Input.insertText({ text: a.value ?? "" });
        await evalJs(`${find}.dispatchEvent(new Event("change", { bubbles: true }))`);
        return;
    }
    throw new Error(`unsupported op ${a.op}`);
}

// ---------------- 402: hold → pay → fulfill ----------------

type Paused = { tab: Tab; requestId: string; url: string; method: string; headers: Record<string, string>; postData?: string; req: PaymentRequired };
const pending = new Map<string, Paused>();

const rail = makeRail(); // PAY_RAIL in .env: mpp (Tempo testnet, demo) or x402 (Base Sepolia, fallback)

async function onPaused(tab: Tab, e: any): Promise<void> {
    const { Fetch } = tab.client;
    if (e.responseStatusCode !== 402) {
        await Fetch.continueResponse({ requestId: e.requestId });
        return;
    }
    let parsed: ParsedChallenge | null = null;
    try {
        parsed = rail.parseChallenge(new Headers((e.responseHeaders ?? []).map((h: { name: string; value: string }) => [h.name, h.value])));
    } catch (err) {
        log(`402 challenge unreadable for ${rail.name}: ${(err as Error).message}`);
    }
    if (!parsed) {
        await Fetch.continueResponse({ requestId: e.requestId });
        return;
    }
    const amount = parsed.amountUsd;
    const anchorRect = tab.lastClick;
    const req: PaymentRequired = {
        type: "payment_required",
        paymentId: `${tab.id.slice(0, 8)}:${e.requestId}`,
        url: e.request.url,
        method: e.request.method,
        payeeDomain: new URL(e.request.url).hostname,
        payTo: parsed.payTo,
        amountUsd: fmtUsd(amount),
        network: parsed.network,
        asset: parsed.asset,
        verdict: intentCheck(tab.state, amount, anchorRect),
        ...(anchorRect ? { anchorRect } : {}),
    };
    pending.set(req.paymentId, { tab, requestId: e.requestId, url: e.request.url, method: e.request.method, headers: e.request.headers, postData: e.request.postData, req });
    log(`402 held: ${req.payeeDomain} $${req.amountUsd} → ${req.payTo.slice(0, 10)}… verdict ${req.verdict.ok ? "ok" : req.verdict.reason}`);
    send(req);
}

const HOP = new Set(["host", "connection", "content-length", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"]);

async function pay(paymentId: string): Promise<void> {
    const p = pending.get(paymentId);
    if (!p) return;
    const fail = (error: string) => {
        log(`pay failed: ${error}`);
        record({ domain: p.req.payeeDomain, payTo: p.req.payTo, amountUsd: p.req.amountUsd, url: p.url, ok: false });
        send({ type: "payment_result", paymentId, ok: false, error });
    };
    if (!p.req.verdict.ok) return fail(p.req.verdict.reason ?? "blocked by intent check"); // never pay a blocked request
    pending.delete(paymentId);
    try {
        const headers = Object.fromEntries(Object.entries(p.headers).filter(([k]) => !HOP.has(k.toLowerCase())));
        const r = await rail.pay(p.url, { method: p.method, headers, body: p.postData });
        if (r.res) {
            const res = r.res;
            const body = Buffer.from(await res.arrayBuffer());
            const responseHeaders = [...res.headers].filter(([k]) => !["content-encoding", "content-length", "transfer-encoding"].includes(k)).map(([name, value]) => ({ name, value }));
            await p.tab.client.Fetch.fulfillRequest({ requestId: p.requestId, responseCode: res.status, responseHeaders, body: body.toString("base64") });
        } else {
            await p.tab.client.Fetch.continueResponse({ requestId: p.requestId }).catch(() => {}); // the page gets the original 402
        }
        if (!r.ok || !r.txHash) return fail(r.error ?? "payment failed");
        const explorerUrl = r.explorerUrl!;
        record({ domain: p.req.payeeDomain, payTo: p.req.payTo, amountUsd: p.req.amountUsd, url: p.url, txHash: r.txHash, ok: true });
        log(`paid $${p.req.amountUsd} on ${rail.name} → ${explorerUrl}`);
        send({ type: "payment_result", paymentId, ok: true, txHash: r.txHash, explorerUrl });
    } catch (e) {
        await p.tab.client.Fetch.continueResponse({ requestId: p.requestId }).catch(() => {});
        fail((e as Error).message);
    }
}

/** The tab navigated: its held requests are gone. Tell the hub so it stops offering them. */
function cancelPayments(tab: Tab): void {
    for (const [id, p] of pending)
        if (p.tab === tab) {
            pending.delete(id);
            send({ type: "payment_result", paymentId: id, ok: false, error: "cancelled" });
            log(`402 cancelled by navigation: ${p.req.payeeDomain}`);
        }
}

async function dismissPayment(paymentId: string): Promise<void> {
    const p = pending.get(paymentId);
    if (!p) return;
    pending.delete(paymentId);
    await p.tab.client.Fetch.continueResponse({ requestId: p.requestId }).catch(() => {}); // the page gets the original 402
    log(`402 released unpaid: ${p.req.payeeDomain}`);
}

// ---------------- start ----------------

connectHub();
await discover();
setInterval(() => void discover(), 1000);
log(`web: CDP :${CDP_PORT}, hub ${HUB}, pay rail ${rail.name}${rail.ready ? "" : " (NO PAYER KEY: payments will fail)"}`);
