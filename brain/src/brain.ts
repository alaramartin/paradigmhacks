// Hub logic: routing, the predict loop, ghosts, payments, sequences, counters.
// Transport-free so the websocket server, replay, and tests can all drive it.
import type { Action, El, Ghost, HubToShell, HubToWeb, PaymentRequired, Rect, ScreenState, UserEvent } from "../../protocol/types.ts";
import { countStep, newHud } from "./counters.ts";
import { History, toTarget } from "./history.ts";
import { log } from "./log.ts";
import type { Decider } from "./model.ts";
import { PatternEngine, type PatternAction, type Step } from "./pattern.ts";
import { CHROME, contentSig, findEl, StateStore, stateKey } from "./state.ts";

const DEBOUNCE_MS = 150;
const IDLE_MS = 600; // model ghosts wait for this much quiet
const SHOW_AT = 0.6;
const EXEC_TIMEOUT_MS = 3000;
const STATE_WAIT_MS = 1000;
const ECHO_MS = 400; // user_events C reports for our own exec

type Shown = { ghost: Ghost; action?: Action; paymentId?: string };

export interface BrainOpts {
    sendShell(m: HubToShell): void;
    sendWeb(m: HubToWeb): void;
    decider: Decider | null;
    /** Replay/tests: predict right away instead of debouncing and waiting for idle. */
    immediate?: boolean;
    onPredict?(info: { source: "pattern" | "model"; latencyMs: number; action: Action | null }): void;
}

export class Brain {
    store = new StateStore();
    history = new History();
    pattern = new PatternEngine();
    hud = newHud();

    private gen = 0;
    private ghostSeq = 0;
    private shown: Shown | null = null;
    private dismissedKey: string | null = null;
    private lastInputTs = 0;
    private lastSig = "";
    private timer: NodeJS.Timeout | null = null;
    private payment: PaymentRequired | null = null;
    private running: { stop: boolean } | null = null;
    private echoUntil = 0;
    private execWaiters = new Map<string, (r: { ok: boolean; error?: string }) => void>();
    private stateWaiters: { key: string; resolve: () => void }[] = [];
    private modelCache: { key: string; action: Action | null } | null = null;

    constructor(private o: BrainOpts) {}

    // ---------- inbound ----------

    fromShell(m: any): void {
        log.incoming("shell", m);
        switch (m.type) {
            case "hello":
                this.sendHud();
                break;
            case "frontmost":
                if (m.app === "dev.tab.shell") break;
                this.store.frontmost = { app: m.app, window: m.window };
                this.onActiveMaybeChanged();
                break;
            case "state":
                this.onState(m);
                break;
            case "input":
                this.hud.youDid++;
                this.onUserInput();
                break;
            case "accept":
                this.hud.youDid++;
                void this.onAccept(m.ghostId);
                break;
            case "dismiss":
                this.hud.youDid++;
                this.onDismiss(m.ghostId);
                break;
            case "exec_result":
                this.execWaiters.get(m.ghostId)?.(m);
                break;
            case "hud_click":
                if (m.item === "ledger" && this.hud.lastTx) this.o.sendWeb({ type: "open_url", url: this.hud.lastTx.explorerUrl });
                break;
        }
    }

    fromWeb(m: any): void {
        log.incoming("web", m);
        switch (m.type) {
            case "hello":
                break;
            case "state":
                this.onState(m);
                break;
            case "user_event":
                this.onUserEvent(m);
                break;
            case "exec_result":
                this.execWaiters.get(m.ghostId)?.(m);
                break;
            case "payment_required":
                this.payment = m;
                this.showPayment(m);
                break;
            case "payment_result":
                this.onPaymentResult(m);
                break;
        }
    }

    // ---------- state & input ----------

    private onState(s: ScreenState): void {
        this.store.put(s);
        const key = stateKey(s);
        this.stateWaiters = this.stateWaiters.filter((w) => (w.key === key ? (w.resolve(), false) : true));
        if (this.running) return;
        const active = this.store.active();
        if (!active || stateKey(active) !== key) return;
        const sig = contentSig(active);
        if (sig !== this.lastSig) {
            this.lastSig = sig;
            this.schedule(DEBOUNCE_MS);
        } else {
            this.refreshGhostRect(active);
        }
    }

    private onActiveMaybeChanged(): void {
        const active = this.store.active();
        const sig = active ? stateKey(active) + "\n" + contentSig(active) : "";
        if (sig !== this.lastSig) {
            this.lastSig = sig;
            this.schedule(DEBOUNCE_MS);
        }
    }

    private onUserEvent(e: UserEvent): void {
        if (this.running || Date.now() < this.echoUntil) return; // our own exec, echoed back by the page
        if (e.kind === "focus") return;
        const op = e.kind === "navigate" ? "navigate" : e.kind;
        this.history.push({
            op,
            app: e.app,
            url: e.url,
            target: e.target ? toTarget(e.target) : undefined,
            value: e.value,
            ts: e.ts,
            by: "user",
        });
        this.dismissedKey = null; // the user did something on the page: everything may be offered again
        this.onUserInput(e.kind === "click" && e.target?.role === "button");
    }

    /**
     * Any real input hides the ghost; predict again after quiet. Button clicks may complete a pattern unit, so check that now.
     * Ignoring is sticky: a ghost hidden by input elsewhere isn't re-offered until the user acts on a page (onUserEvent).
     */
    private onUserInput(maybeUnitEnd = false): void {
        if (this.running) return;
        if (this.shown?.action) this.dismissedKey = actionKey(this.shown.action);
        this.hide();
        this.lastInputTs = Date.now();
        this.gen++;
        this.schedule(maybeUnitEnd ? DEBOUNCE_MS : IDLE_MS);
    }

    // ---------- predict ----------

    private schedule(ms: number): void {
        if (this.o.immediate) return; // replay calls predictNow()
        if (this.timer) clearTimeout(this.timer);
        const gen = ++this.gen;
        this.timer = setTimeout(() => void this.predict(gen), ms);
    }

    async predictNow(): Promise<void> {
        await this.predict(++this.gen);
    }

    private async predict(gen: number): Promise<void> {
        if (this.running) return;
        if (this.payment) return this.showPayment(this.payment);
        const active = this.store.active();
        if (!active) return;

        // 1. Pattern rule.
        const now = Date.now();
        const t0 = performance.now();
        const pa = this.pattern.predict(this.history.entries, this.store.recent(now), now);
        const pMs = performance.now() - t0;
        if (pa) {
            const shown = this.maybeShow(pa, gen, pMs);
            this.logPred(gen, "pattern", pMs, pa, shown);
            if (shown) return;
        }

        // 2. Model, only after the user has been idle.
        const decider = this.o.decider;
        if (!decider) return;
        if (!this.o.immediate) {
            const wait = this.lastInputTs + IDLE_MS - Date.now();
            if (wait > 0) {
                this.timer = setTimeout(() => void this.predict(gen), wait);
                return;
            }
        }
        const key = `${stateKey(active)}\n${contentSig(active)}\n${this.history.entries.length}:${this.history.entries.at(-1)?.ts ?? 0}`;
        let action: Action | null;
        let ms = 0;
        if (this.modelCache?.key === key) {
            action = this.modelCache.action;
        } else {
            this.hud.mode = "predicting";
            this.sendHud();
            const t1 = performance.now();
            try {
                this.hud.modelCalls++;
                action = await decider.decide({
                    active,
                    others: this.store.recent(Date.now()),
                    history: this.history.entries,
                });
            } catch (err) {
                console.error(`[model] ${decider.name}:`, (err as Error).message);
                action = null;
            }
            ms = performance.now() - t1;
            this.modelCache = { key, action };
            this.hud.mode = this.shown ? "shown" : "idle";
        }
        const shown = gen === this.gen && !!action && this.maybeShow(action, gen, ms);
        this.logPred(gen, "model", ms, action, shown);
        if (!shown) this.sendHud();
    }

    private maybeShow(a: Action, gen: number, latencyMs: number): boolean {
        if (gen !== this.gen || this.running) return false;
        if (a.confidence < SHOW_AT) return false;
        if (actionKey(a) === this.dismissedKey) return false;
        if (this.shown?.action && actionKey(this.shown.action) === actionKey(a)) return true; // already up
        const ghost = this.buildGhost(a);
        if (!ghost) return false;
        this.shown = { ghost, action: a };
        this.hud.shown++;
        this.hud.mode = "shown";
        this.hud.lastSource = a.source;
        this.hud.lastLatencyMs = Math.round(latencyMs);
        this.o.sendShell({ type: "ghost", ghost });
        this.sendHud();
        return true;
    }

    private buildGhost(a: Action): Ghost | null {
        const id = `g${++this.ghostSeq}`;
        const label = `${a.label} ⇥`;
        const active = this.store.active();

        if (active && active.source === "native") {
            // Terminal: no element rect, pill at the bottom-left of the window.
            const win = active.elements[0]?.rect;
            if (!win) return null;
            return { id, kind: "action", label, pillAt: { x: win.x + 16, y: win.y + win.h - 16 } };
        }

        const el = this.ghostTarget(a);
        if (!el) {
            if (a.op !== "navigate") return null;
            const near = this.lastClickedRect();
            // pillAt is the pill's bottom-left corner; without an anchor, A centers the pill at the top of the screen.
            return near ? { id, kind: "action", label, pillAt: { x: near.x, y: near.y + near.h + 36 } } : { id, kind: "action", label };
        }
        const center = { x: el.rect.x + el.rect.w / 2, y: el.rect.y + el.rect.h / 2 };
        const empty = !el.value;
        if (a.op === "type" && empty && (el.role === "textfield" || el.role === "textarea")) {
            return { id, kind: "text", label: "⇥", rect: el.rect, ghostText: a.value };
        }
        const ghost: Ghost = { id, kind: "action", label, rect: el.rect, cursor: center };
        if (this.pillWouldCover(el, active)) ghost.place = "inside"; // ghost-spec amendment: dock in wide fields
        return ghost;
    }

    /** A pill below a wide field would sit on whatever comes right under it (flow 3: the first list row). */
    private pillWouldCover(el: El, active: ScreenState | undefined): boolean {
        if (!active || !["textfield", "textarea", "select"].includes(el.role) || el.rect.w < 160) return false;
        const top = el.rect.y + el.rect.h, bottom = top + 44; // pill gap + height, with margin
        return active.elements.some(
            (o) => o.id !== el.id && o.rect.y < bottom && o.rect.y + o.rect.h > top && o.rect.x < el.rect.x + 260 && o.rect.x + o.rect.w > el.rect.x,
        );
    }

    /** The element a ghost highlights: the target, or for a sequence, the first step we can find on screen. */
    private ghostTarget(a: Action): El | undefined {
        const steps: Step[] = a.op === "sequence" ? (a.steps as Step[]) ?? [] : [a];
        for (const s of steps) {
            const el = this.resolve(s);
            if (el) return el;
        }
        return undefined;
    }

    private refreshGhostRect(active: ScreenState): void {
        if (!this.shown?.action || !this.shown.ghost.rect) return;
        const el = this.ghostTarget(this.shown.action);
        if (!el || stateKey(active) !== (this.shown.action.url ?? stateKey(active))) return;
        const r = this.shown.ghost.rect;
        if (r.x === el.rect.x && r.y === el.rect.y && r.w === el.rect.w && r.h === el.rect.h) return;
        this.shown.ghost = {
            ...this.shown.ghost,
            rect: el.rect,
            ...(this.shown.ghost.cursor ? { cursor: { x: el.rect.x + el.rect.w / 2, y: el.rect.y + el.rect.h / 2 } } : {}),
        };
        this.o.sendShell({ type: "ghost", ghost: this.shown.ghost });
    }

    private hide(): void {
        if (!this.shown) return;
        this.shown = null;
        this.o.sendShell({ type: "ghost_hide" });
        this.hud.mode = "idle";
        this.sendHud();
    }

    // ---------- accept / dismiss ----------

    private async onAccept(ghostId: string): Promise<void> {
        const s = this.shown;
        if (!s || s.ghost.id !== ghostId) return;
        if (s.ghost.kind === "pay" && s.paymentId) {
            this.hud.accepted++;
            this.o.sendWeb({ type: "pay", paymentId: s.paymentId });
            return;
        }
        if (!s.action) return;
        this.hud.accepted++;
        const steps: Step[] = s.action.op === "sequence" ? (s.action.steps as Step[]) : [s.action];
        const ok = await this.run(ghostId, steps);
        if (ok && s.action.source === "pattern") this.pattern.onAccepted((s.action as PatternAction).sig);
    }

    private onDismiss(ghostId: string): void {
        const s = this.shown;
        if (this.running) {
            this.running.stop = true; // Esc stops a sequence after the current step
            return;
        }
        if (!s || s.ghost.id !== ghostId) return;
        if (s.paymentId) {
            this.o.sendWeb({ type: "dismiss_payment", paymentId: s.paymentId });
            this.payment = null;
        }
        if (s.action) this.dismissedKey = actionKey(s.action);
        this.hide();
    }

    // ---------- sequence runner ----------

    private resolve(s: Step): El | undefined {
        const st = this.store.forStep(s.app, s.url);
        if (s.match) {
            const c = s.match.contains.toLowerCase();
            return st?.elements.find((e) => e.list?.key === s.match!.listKey && e.label.toLowerCase().includes(c));
        }
        return findEl(st, s.targetId, s.targetPath);
    }

    private async run(ghostId: string, steps: Step[]): Promise<boolean> {
        const run = { stop: false };
        this.running = run;
        this.hud.mode = "running";
        this.sendHud();
        let ok = true;
        try {
            for (let k = 0; k < steps.length && !run.stop; k++) {
                const step = steps[k];
                if (step.app !== this.store.frontmost?.app && step.op !== "switch_app") {
                    const sw: Action = { op: "switch_app", app: step.app, value: step.app, label: "", confidence: 1, source: step.source };
                    const r = await this.exec(`${ghostId}:${k}a`, sw, "shell");
                    if (!r.ok) throw new Error(`switch_app ${step.app}: ${r.error}`);
                    countStep(this.hud, sw);
                    this.store.frontmost = { app: step.app, window: "" };
                }
                const target = step.op === "navigate" || step.op === "switch_app" ? undefined : this.resolve(step);
                if (!target && step.op !== "navigate" && step.op !== "switch_app" && step.op !== "key")
                    throw new Error(`step ${k}: target not found (${step.targetPath ?? step.match?.contains ?? step.targetId})`);
                const { match: _m, ...wire } = step;
                const action: Action = { ...wire, targetId: target?.id ?? step.targetId, targetPath: target?.path ?? step.targetPath };
                const waitState = this.waitForState(step.app === CHROME && step.url ? step.url : step.app);
                const r = await this.exec(`${ghostId}:${k}`, action, step.op === "switch_app" ? "shell" : step.app === CHROME ? "web" : "shell");
                if (!r.ok) throw new Error(`step ${k} ${step.op}: ${r.error}`);
                countStep(this.hud, action, target);
                this.history.push({
                    op: action.op,
                    app: action.app,
                    url: step.url ?? this.store.active()?.url,
                    target: target ? toTarget(target) : undefined,
                    value: action.value,
                    ts: Date.now(),
                    by: "tab",
                });
                this.sendHud();
                await waitState;
            }
        } catch (err) {
            ok = false;
            console.error(`[seq] ${ghostId}:`, (err as Error).message);
        } finally {
            this.running = null;
            this.echoUntil = Date.now() + ECHO_MS;
            this.shown = null;
            this.o.sendShell({ type: "ghost_hide" });
            this.hud.mode = "idle";
            this.sendHud();
            this.lastSig = ""; // force a fresh prediction on the next state
            this.schedule(DEBOUNCE_MS);
        }
        return ok && !run.stop;
    }

    private exec(ghostId: string, action: Action, to: "shell" | "web"): Promise<{ ok: boolean; error?: string }> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.execWaiters.delete(ghostId);
                resolve({ ok: false, error: "exec timeout" });
            }, EXEC_TIMEOUT_MS);
            this.execWaiters.set(ghostId, (r) => {
                clearTimeout(timer);
                this.execWaiters.delete(ghostId);
                resolve(r);
            });
            if (to === "shell") this.o.sendShell({ type: "exec", ghostId, action });
            else this.o.sendWeb({ type: "exec", ghostId, action });
        });
    }

    private waitForState(key: string): Promise<void> {
        return new Promise((resolve) => {
            const w = { key, resolve };
            this.stateWaiters.push(w);
            setTimeout(() => {
                this.stateWaiters = this.stateWaiters.filter((x) => x !== w);
                resolve();
            }, STATE_WAIT_MS);
        });
    }

    // ---------- payments ----------

    private showPayment(p: PaymentRequired): void {
        if (!p.anchorRect) p.anchorRect = this.lastClickedRect(); // C should send it; fall back to what the user just clicked
        const id = `g${++this.ghostSeq}`;
        const ghost: Ghost = p.verdict.ok
            ? { id, kind: "pay", label: `Pay $${p.amountUsd} · ${p.payeeDomain} ⇥`, rect: p.anchorRect }
            : { id, kind: "blocked", label: `Blocked · ${p.verdict.reason ?? "payment does not match the page"}`, rect: p.anchorRect };
        if (this.shown?.paymentId === p.paymentId && this.shown.ghost.kind === ghost.kind) return;
        this.shown = { ghost, paymentId: p.paymentId };
        this.hud.shown++;
        this.hud.mode = "shown";
        this.o.sendShell({ type: "ghost", ghost });
        this.sendHud();
    }

    private onPaymentResult(r: { paymentId: string; ok: boolean; txHash?: string; explorerUrl?: string; error?: string }): void {
        const p = this.payment;
        if (p && p.paymentId !== r.paymentId) return; // about a payment we've already moved past
        this.payment = null;
        if (!r.ok && r.error === "cancelled") {
            // The page went away (navigation, tab closed): nothing to pay or block anymore.
            if (this.shown?.paymentId === r.paymentId) this.hide();
            return;
        }
        const id = `g${++this.ghostSeq}`;
        const rect = p?.anchorRect;
        const ghost: Ghost = r.ok
            ? { id, kind: "done", label: `Paid $${p?.amountUsd ?? "?"} ✓`, rect, ttlMs: 1500 }
            : { id, kind: "blocked", label: `Blocked · ${r.error ?? "payment failed"}`, rect };
        if (r.ok && r.txHash && r.explorerUrl) this.hud.lastTx = { hash: r.txHash, explorerUrl: r.explorerUrl, amountUsd: p?.amountUsd ?? "" };
        this.shown = r.ok ? null : { ghost, paymentId: r.paymentId };
        this.o.sendShell({ type: "ghost", ghost });
        this.hud.mode = r.ok ? "idle" : "shown";
        this.sendHud();
    }

    // ---------- misc ----------

    /** Where the user (or Tab) last clicked, with the element's current rect. */
    private lastClickedRect(): Rect | undefined {
        for (let k = this.history.entries.length - 1; k >= 0; k--) {
            const e = this.history.entries[k];
            if (e.op !== "click" || !e.target) continue;
            return findEl(this.store.forStep(e.app, e.url), e.target.id, e.target.path)?.rect;
        }
        return undefined;
    }

    private sendHud(): void {
        this.o.sendShell({ type: "hud", hud: this.hud });
    }

    private logPred(gen: number, source: "pattern" | "model", latencyMs: number, action: Action | null, shown: boolean): void {
        const brief = action && { op: action.op, label: action.label, targetId: action.targetId, value: action.value, confidence: action.confidence, steps: action.steps?.length };
        log.prediction({ ts: Date.now(), gen, source, latencyMs: Math.round(latencyMs * 10) / 10, action: brief, shown });
        this.o.onPredict?.({ source, latencyMs, action });
    }
}

function actionKey(a: Action): string {
    return a.op === "sequence" ? `seq|${a.label}` : `${a.op}|${a.app}|${a.targetPath ?? a.targetId ?? ""}|${a.value ?? ""}`;
}
