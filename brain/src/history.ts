import type { El, Op, Role } from "../../protocol/types.ts";

export interface HistTarget {
    id: string;
    path?: string;
    role: Role;
    label: string;
    list?: El["list"];
}

export interface HistEntry {
    op: Op; // never "sequence": sequences are recorded step by step
    app: string;
    url?: string;
    target?: HistTarget;
    value?: string;
    ts: number;
    by: "user" | "tab";
}

const MAX = 50;

export class History {
    entries: HistEntry[] = [];

    push(e: HistEntry): void {
        // A committed `type` into the same field replaces the previous one (change events can fire twice).
        const last = this.entries.at(-1);
        if (
            e.op === "type" &&
            last?.op === "type" &&
            last.url === e.url &&
            last.target?.path &&
            last.target.path === e.target?.path
        ) {
            this.entries[this.entries.length - 1] = e;
            return;
        }
        this.entries.push(e);
        if (this.entries.length > MAX) this.entries.splice(0, this.entries.length - MAX);
    }

    last(n: number): HistEntry[] {
        return this.entries.slice(-n);
    }
}

export function toTarget(el: El): HistTarget {
    return { id: el.id, path: el.path, role: el.role, label: el.label, list: el.list };
}
