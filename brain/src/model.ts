// One model client behind decide(). Jev (default) or, if added later, Claude.
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Action, El, ScreenState } from "../../protocol/types.ts";
import type { HistEntry } from "./history.ts";
import { candidates, mentionedOptions, otherPagesText, type Candidate } from "./candidates.ts";
import { EXAMPLES, OUTPUT_SCHEMA, SYSTEM } from "./prompt.ts";
import { stateKey } from "./state.ts";

// Jev is usually ~0.1 s but slowed to 1–3 s on demo morning; give it room, and lean on the answer cache below.
const HARD_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 5000);
/** With a cached answer for this screen, wait at most this long for Jev before using the cached one. */
const CACHE_AFTER_MS = Number(process.env.JEV_CACHE_AFTER_MS ?? 1200);

export interface ModelInput {
    active: ScreenState;
    others: ScreenState[];
    history: HistEntry[];
}

function compactEl(e: El) {
    return {
        id: e.id,
        role: e.role,
        label: e.label,
        ...(e.value ? { value: e.value } : {}),
        ...(e.options ? { options: e.options } : {}),
        ...(e.checked !== undefined ? { checked: e.checked } : {}),
        ...(e.enabled ? {} : { enabled: false }),
    };
}

function compactState(s: ScreenState, max: number) {
    return { app: s.app, window: s.window, ...(s.url ? { url: s.url } : {}), elements: s.elements.slice(0, max).map(compactEl) };
}

export function buildInput(m: ModelInput): string {
    const now = Date.now();
    return JSON.stringify({
        ACTIVE: compactState(m.active, 120),
        OTHER: m.others.filter((s) => stateKey(s) !== stateKey(m.active)).map((s) => compactState(s, 60)),
        HISTORY: m.history.slice(-15).map((h) => ({
            ago_s: Math.round((now - h.ts) / 1000),
            by: h.by,
            op: h.op,
            ...(h.url ? { url: h.url } : {}),
            ...(h.target ? { target: h.target.label } : {}),
            ...(h.value ? { value: h.value } : {}),
        })),
    });
}

export interface Decider {
    name: string;
    decide(m: ModelInput, signal?: AbortSignal): Promise<Action | null>;
}

class ClaudeDecider implements Decider {
    name: string;
    private client = new Anthropic({ timeout: HARD_TIMEOUT_MS, maxRetries: 0 });
    constructor(private model: string) {
        this.name = `claude:${model}`;
    }

    async decide(m: ModelInput, signal?: AbortSignal): Promise<Action | null> {
        const res = await this.client.messages.create(
            {
                model: this.model,
                max_tokens: 2000,
                system: [{ type: "text", text: `${SYSTEM}\n\n${EXAMPLES}`, cache_control: { type: "ephemeral" } }],
                output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
                messages: [{ role: "user", content: buildInput(m) }],
            },
            { signal },
        );
        if (res.stop_reason !== "end_turn") return null;
        const text = res.content.find((b) => b.type === "text");
        if (!text || text.type !== "text") return null;
        const o = JSON.parse(text.text) as { op: string; app: string; targetId: string; value: string; label: string; confidence: number };
        return validate(o, m.active);
    }
}

/** Reject outputs that don't point at something real. */
export function validate(
    o: { op: string; app: string; targetId: string; value: string; label: string; confidence: number },
    active: ScreenState,
): Action | null {
    if (o.op === "none") return null;
    const a: Action = { op: o.op as Action["op"], app: o.app || active.app, label: o.label, confidence: o.confidence, source: "model" };
    if (o.op === "navigate") {
        if (!/^https?:\/\//.test(o.value)) return null;
        return { ...a, app: "com.google.Chrome", value: o.value };
    }
    const el = active.elements.find((e) => e.id === o.targetId);
    if (!el || !el.enabled) return null;
    if (o.op === "type" && el.role === "select" && el.options && !el.options.includes(o.value)) return null;
    return { ...a, app: active.app, url: active.url, targetId: el.id, targetPath: el.path, ...(o.value ? { value: o.value } : {}) };
}

/** Jev (TypeSafe, docs/jev.md): code proposes candidate actions, Jev picks one with a calibrated confidence. */
export class JevDecider implements Decider {
    name = "jev:jev-latest";
    private url = `${(process.env.JEV_BASE_URL || "https://api.typesafe.ai").replace(/\/$/, "")}/v1/systemone`;
    readonly cache: AnswerCache;
    constructor(
        private key: string,
        opts: { cacheFile?: string | null } = {},
    ) {
        this.cache = new AnswerCache(opts.cacheFile ?? null);
    }

    /**
     * Ask Jev; remember confident answers by screen. If Jev is slow (no answer within CACHE_AFTER_MS) or fails and this
     * screen was answered before, replay that answer; a late live answer still refreshes the cache.
     */
    async decide(m: ModelInput, signal?: AbortSignal): Promise<Action | null> {
        const cands = candidates(m.active, m.others, m.history);
        if (cands.length === 0) return null;
        const key = screenKey(m.active);
        const live = this.ask(m, cands, signal).then((r) => {
            if (r && r.action.confidence >= 0.6) this.cache.put(key, r.desc, r.action.confidence);
            return r?.action ?? null;
        });
        const hit = this.cache.get(key);
        const cached = hit && cands.find((c) => c.desc === hit.desc);
        if (!cached) return live;
        const fromCache = { ...cached.action, confidence: hit.confidence };
        let timer: NodeJS.Timeout | undefined;
        const slow = new Promise<"slow">((r) => (timer = setTimeout(() => r("slow"), CACHE_AFTER_MS)));
        try {
            const first = await Promise.race([live, slow]);
            if (first !== "slow") return first;
        } catch {
            /* Jev failed: use the cache */
        } finally {
            clearTimeout(timer);
        }
        live.catch(() => {}); // keep refreshing the cache in the background
        console.log(`[jev] slow/failed, using the cached answer for this screen: ${cached.action.label}`);
        return fromCache;
    }

    private async ask(m: ModelInput, cands: Candidate[], signal?: AbortSignal): Promise<{ action: Action; desc: string } | null> {

        // One option per element; values for selects and fields are separate questions in the same call.
        const groups = new Map<string, Candidate[]>();
        for (const c of cands) {
            const k = c.action.op === "navigate" ? `nav:${c.action.value}` : `el:${c.action.targetId}`;
            groups.set(k, [...(groups.get(k) ?? []), c]);
        }
        const gs = [...groups.values()];
        const criteria: Record<string, string> = {};
        const questions: Record<string, unknown> = {};
        gs.forEach((g, i) => {
            criteria[`a${i}`] = g.length === 1 ? g[0].desc : g[0].groupDesc ?? g[0].desc;
            if (g.length > 1) {
                const vc: Record<string, string> = {};
                g.forEach((c, j) => (vc[`v${j}`] = c.desc));
                questions[`value_a${i}`] = { type: "choice", instructions: "If the user acts on this element next, which of these will they do? Values come from text in `OTHER_PAGES`.", criteria: vc };
            }
        });
        criteria.none = "None of these is clearly the next step";
        questions.next = { type: "choice", instructions: NEXT_INSTRUCTIONS, criteria };

        const res = await fetch(this.url, {
            method: "POST",
            headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "jev-latest", state: jevState(m), questions }),
            signal: signal ?? AbortSignal.timeout(HARD_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        type Ans = { choice: string; confidence: number; probabilities: Record<string, number> };
        const out = (await res.json()) as { answers: Record<string, Ans> };
        const next = out.answers.next;
        if (process.env.JEV_DEBUG) {
            const top = Object.entries(next.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3);
            console.log("  [jev]", top.map(([k, p]) => `${p.toFixed(2)} ${criteria[k]}`).join(" | "));
        }
        // Two independent signals agree: the code found the submit button right below the field the user just filled,
        // and it is Jev's best actual action (ignoring "none") or gets real weight (≥ 0.2). Jev alone stays unsure on busy
        // pages (GitHub PR page: Create at 0.23–0.32, often just behind "none"), so trust the agreement.
        const submitId = submitAfterFill(m);
        const si = submitId ? gs.findIndex((g) => g.length === 1 && g[0].action.targetId === submitId) : -1;
        const bestAction = Object.entries(next.probabilities).filter(([k]) => k !== "none").sort((a, b) => b[1] - a[1])[0]?.[0];
        if (si >= 0 && (bestAction === `a${si}` || (next.probabilities[`a${si}`] ?? 0) >= 0.2))
            return { action: { ...gs[si][0].action, confidence: Math.max(next.probabilities[`a${si}`], 0.7) }, desc: gs[si][0].desc };
        if (next.choice === "none") return null;
        const g = gs[Number(next.choice.slice(1))];
        if (!g) return null;
        // Jev's own pick is the page's buy/checkout button but it's cautious (Click Buy tickets at 0.53 at 16:10, after
        // 0.74 earlier): a purchase button that is Jev's top choice is shown. Paying still needs its own Tab on the pay ghost.
        if (g.length === 1 && g[0].action.op === "click" && BUY.test(g[0].action.label) && next.confidence >= 0.4)
            return { action: { ...g[0].action, confidence: Math.max(next.confidence, 0.7) }, desc: g[0].desc };
        if (g.length === 1) return { action: { ...g[0].action, confidence: next.confidence }, desc: g[0].desc };
        const v = out.answers[`value_${next.choice}`];
        const c = v && g[Number(v.choice.slice(1))];
        if (!c) return null;
        return { action: { ...c.action, confidence: Math.min(next.confidence, v.confidence) }, desc: c.desc };
    }
}

/** What's on screen, without element ids (they change on every page load): page + each control's role, label, value. */
export function screenKey(s: ScreenState): string {
    if (s.source === "native") {
        // Terminal text changes every run (object counts, speeds); what matters is the URLs it offers.
        const urls = [...new Set(s.elements.flatMap((e) => `${e.value ?? ""}`.match(/https?:\/\/[^\s'"<>]+/g) ?? []))].slice(-5);
        return createHash("sha1").update(`${s.app}\n${urls.join("\n")}`).digest("hex");
    }
    const controls = s.elements
        .filter((e) => e.role !== "text")
        .map((e) => `${e.role}|${e.label}|${e.value ?? ""}|${e.checked ?? ""}|${e.enabled}`)
        .join("\n");
    return createHash("sha1").update(`${s.app}\n${s.url ?? ""}\n${controls}`).digest("hex");
}

/** Jev's confident answers by screen, saved across runs (rehearsals warm it). `file` null = memory only. */
export class AnswerCache {
    private map = new Map<string, { desc: string; confidence: number; ts: number }>();
    constructor(private file: string | null) {
        if (!file || !existsSync(file)) return;
        try {
            this.map = new Map(Object.entries(JSON.parse(readFileSync(file, "utf8"))));
        } catch {
            /* unreadable: start empty */
        }
    }
    get(key: string) {
        return this.map.get(key);
    }
    put(key: string, desc: string, confidence: number): void {
        this.map.set(key, { desc, confidence, ts: Date.now() });
        if (!this.file) return;
        mkdirSync(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)));
        renameSync(tmp, this.file);
    }
    get size(): number {
        return this.map.size;
    }
}

const NEXT_INSTRUCTIONS =
    "The user is working in `ACTIVE`. Which single element will they act on next? Rules: (1) It continues what `RECENT_ACTIONS` shows them doing. (2) Forms are filled top to bottom: the next action is on the first element in `ACTIVE.elements` that is empty, unchecked, or not yet set to what `OTHER_PAGES` says. (3) A button that submits, buys, or creates is clicked only after every field above it is filled in. (4) Values they type or choose come from text in `OTHER_PAGES`. (5) When every field in the form is filled in, the next action is the main button that submits it.";

/** A checkbox other pages ask for: ≥ 2 of its content words appear there ("Text me when ready" ↔ "text you when it's ready"). */
const STOP = new Set(["me", "my", "you", "your", "when", "it", "is", "the", "a", "an", "to", "for", "of", "and", "or", "on", "in", "with", "this", "that", "i"]);
export function askedFor(label: string, otherText: string): boolean {
    const words = label.toLowerCase().match(/[a-z]{2,}/g)?.filter((w) => !STOP.has(w)) ?? [];
    return words.length >= 2 && words.filter((w) => new RegExp(`\\b${w}`).test(otherText)).length >= 2;
}

/** Only what the decision needs: Jev loses accuracy on irrelevant state. */
/** The nearest submit-style button below the field just filled on this page (resolves "the form is done → submit"). */
export function submitAfterFill(m: ModelInput): string | undefined {
    // Only what happened since this page was last loaded (a reload empties the form).
    let k = m.history.length - 1;
    for (; k >= 0; k--) if (m.history[k].op === "navigate" && m.history[k].value === m.active.url) break;
    const last = m.history.slice(k + 1).reverse().find((h) => h.url === m.active.url && h.op !== "navigate");
    if (!last || last.op !== "type" || !last.target) return undefined;
    const field = m.active.elements.find((e) => (last.target!.path && e.path === last.target!.path) || e.id === last.target!.id);
    if (!field || !["textfield", "textarea"].includes(field.role) || !field.value?.trim()) return undefined;
    // Same column as the field (not a sidebar "Request" reviewer button), at or below its bottom edge.
    const sameColumn = (e: El) => e.rect.x < field.rect.x + field.rect.w && e.rect.x + e.rect.w > field.rect.x;
    const below = m.active.elements
        .filter((e) => e.role === "button" && e.enabled && SUBMIT.test(e.label) && sameColumn(e) && e.rect.y >= field.rect.y + field.rect.h - 4)
        .sort((a, b) => a.rect.y - b.rect.y);
    return below[0]?.id;
}
const BUY = /^click (buy|pay|purchase|place order|check ?out)\b/i;
const SUBMIT = /^(create|submit|save|send|buy|place|request|post|publish|confirm|pay|check ?out|sign up|continue)\b/i;

function jevState(m: ModelInput) {
    const otherText = otherPagesText(m.active, m.others);
    const submitId = submitAfterFill(m);
    const fields = (s: ScreenState, max: number) =>
        s.elements.slice(0, max).map((e) => {
            const hint = e.role === "select" ? mentionedOptions(e, otherText)[0] : undefined;
            if (hint) return `${e.role}: ${e.label} = ${JSON.stringify(e.value ?? "")}, but OTHER_PAGES says ${JSON.stringify(hint)}`;
            if (e.role === "checkbox" && !e.checked && askedFor(e.label, otherText)) return `checkbox: ${e.label} [not checked], and OTHER_PAGES asks for this`;
            if (e.id === submitId) return `button: ${e.label} (submits the form the user just filled in)`;
            // A group of toggle buttons (time chips) with none pressed is an unanswered field, like an empty input.
            if (e.role === "button" && e.checked === false && e.list && !s.elements.some((o) => o.list?.key === e.list!.key && o.checked))
                return `option button: ${e.label} [not selected; nothing in this group is selected yet]`;
            const v = e.role === "checkbox" || e.checked !== undefined ? (e.checked ? " [checked]" : " [not checked]") : e.value ? ` = ${JSON.stringify(e.value.slice(-400))}` : e.role === "textfield" || e.role === "textarea" ? " = (empty)" : "";
            return `${e.role}: ${e.label}${v}`;
        });
    const page = (s: ScreenState) => s.window || s.url || s.app;
    return {
        ACTIVE: { page: page(m.active), ...(m.active.url ? { url: m.active.url } : {}), elements: fields(m.active, 80) },
        OTHER_PAGES: m.others
            .filter((s) => stateKey(s) !== stateKey(m.active))
            .slice(0, 3)
            .map((s) => ({ page: page(s), text: s.elements.filter((e) => e.label).slice(0, 40).map((e) => e.label) })),
        RECENT_ACTIONS: m.history.slice(-8).map((h) => `${h.by === "tab" ? "Tab" : "user"} ${h.op}${h.target ? ` ${JSON.stringify(h.target.label)}` : ""}${h.value ? ` ${JSON.stringify(h.value.slice(0, 80))}` : ""}`),
    };
}

/** Jev if JEV_API_KEY is set; otherwise Claude if Anthropic credentials are set (an LLM may be added later); else no model. */
export function makeDecider(): Decider | null {
    if (process.env.JEV_API_KEY) return new JevDecider(process.env.JEV_API_KEY, { cacheFile: process.env.TAB_JEV_CACHE || join(homedir(), ".tab", "jev-cache.json") });
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return new ClaudeDecider(process.env.LLM_MODEL || "claude-opus-5-5");
    return null;
}
