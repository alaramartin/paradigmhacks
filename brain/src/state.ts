import type { El, ScreenState } from "../../protocol/types.ts";

export const CHROME = "com.google.Chrome";
// PLAN says 120 s, but C only re-emits on change, so static pages (release notes, inbox) go stale fast.
export const CACHE_MS = 600_000;

/** Web states are keyed by URL, native states by app. */
export function stateKey(s: { app: string; url?: string }): string {
    return s.app === CHROME && s.url ? s.url : s.app;
}

/** Content signature: ignores rects, so window moves and scrolls don't re-trigger prediction. */
export function contentSig(s: ScreenState): string {
    return s.elements
        .map((e) => `${e.id}|${e.role}|${e.label}|${e.value ?? ""}|${e.checked ?? ""}|${e.enabled}`)
        .join("\n");
}

export class StateStore {
    private byKey = new Map<string, ScreenState>();
    frontmost: { app: string; window: string } | null = null;

    put(s: ScreenState): void {
        this.byKey.set(stateKey(s), s);
        if (s.source === "web" && s.focused) {
            // Only one web tab can be focused; clear the flag on the others.
            for (const [k, o] of this.byKey) if (k !== stateKey(s) && o.source === "web") o.focused = false;
        }
    }

    get(key: string): ScreenState | undefined {
        return this.byKey.get(key);
    }

    /** Active state: the frontmost app's state; for Chrome, the focused tab. */
    active(): ScreenState | undefined {
        const app = this.frontmost?.app;
        if (!app) return undefined;
        if (app === CHROME) {
            let best: ScreenState | undefined;
            for (const s of this.byKey.values())
                if (s.source === "web" && s.focused && (!best || s.ts > best.ts)) best = s;
            return best;
        }
        return this.byKey.get(app);
    }

    /** States seen within CACHE_MS, newest first. */
    recent(now: number): ScreenState[] {
        return [...this.byKey.values()].filter((s) => now - s.ts <= CACHE_MS).sort((a, b) => b.ts - a.ts);
    }

    /** Latest state for a step: by url for web steps, by app otherwise. */
    forStep(app: string, url?: string): ScreenState | undefined {
        if (app === CHROME && url) return this.byKey.get(url);
        if (app === CHROME) return this.active()?.app === CHROME ? this.active() : undefined;
        return this.byKey.get(app);
    }
}

export function findEl(s: ScreenState | undefined, targetId?: string, targetPath?: string): El | undefined {
    if (!s) return undefined;
    if (targetPath) {
        const el = s.elements.find((e) => e.path === targetPath);
        if (el) return el;
    }
    if (targetId) return s.elements.find((e) => e.id === targetId);
    return undefined;
}
