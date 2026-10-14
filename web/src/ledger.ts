import { appendFileSync, mkdirSync } from "node:fs";

const DIR = new URL("../data/", import.meta.url);
mkdirSync(DIR, { recursive: true });
const FILE = new URL("payments.jsonl", DIR);

export function record(p: { domain: string; payTo: string; amountUsd: string; url: string; txHash?: string; ok: boolean }): void {
    appendFileSync(FILE, JSON.stringify({ ts: Date.now(), ...p }) + "\n");
}
