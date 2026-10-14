// One model client behind decide(). Jev if docs/jev.md and JEV_API_KEY exist, else Claude.
import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import type { Action, El, ScreenState } from "../../protocol/types.ts";
import type { HistEntry } from "./history.ts";
import { EXAMPLES, OUTPUT_SCHEMA, SYSTEM } from "./prompt.ts";
import { stateKey } from "./state.ts";

const HARD_TIMEOUT_MS = 3000;

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

class JevDecider implements Decider {
    name = "jev";
    async decide(): Promise<Action | null> {
        // TODO(B): implement from docs/jev.md once the humans paste the API docs.
        throw new Error("Jev client not implemented yet");
    }
}

export function makeDecider(): Decider {
    if (existsSync(new URL("../../docs/jev.md", import.meta.url)) && process.env.JEV_API_KEY) return new JevDecider();
    return new ClaudeDecider(process.env.LLM_MODEL || "claude-opus-5-5");
}
