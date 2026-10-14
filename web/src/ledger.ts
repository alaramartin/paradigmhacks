// Append-only payment ledger: web/data/payments.jsonl
import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../data/", import.meta.url));
const file = dir + "payments.jsonl";

export interface LedgerEntry {
    ts: number;
    domain: string;
    payTo: string;
    amountUsd: string;
    url: string;
    txHash?: string;
    ok: boolean;
    error?: string;
}

export function record(e: LedgerEntry): void {
    mkdirSync(dir, { recursive: true });
    appendFileSync(file, JSON.stringify(e) + "\n");
}
