import { appendFileSync, mkdirSync } from "node:fs";

const DIR = new URL("../logs/", import.meta.url);
mkdirSync(DIR, { recursive: true });

const predictions = new URL("predictions.jsonl", DIR);
const session = new URL(`session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`, DIR);

export interface PredLog {
    ts: number;
    gen: number;
    source: "pattern" | "model";
    latencyMs: number;
    action: unknown;
    shown: boolean;
    accepted?: boolean;
}

export const log = {
    enabled: true,
    prediction(p: PredLog): void {
        if (this.enabled) appendFileSync(predictions, JSON.stringify(p) + "\n");
    },
    /** Every incoming message, for `npm run replay`. */
    incoming(from: string, msg: unknown): void {
        if (this.enabled) appendFileSync(session, JSON.stringify({ ts: Date.now(), from, msg }) + "\n");
    },
};
