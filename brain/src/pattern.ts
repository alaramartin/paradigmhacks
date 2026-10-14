// Pattern rule: "do a chore once, Tab repeats it for the next item". See PLAN.md, Agent B.
// Synchronous and model-free; must stay well under 10 ms.
import type { Action, El, ScreenState } from "../../protocol/types.ts";
import type { HistEntry } from "./history.ts";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CACHE_MS, CHROME, stateKey } from "./state.ts";

const MIN_UNIT = 2;
const MAX_UNIT = 12;

/** A sequence step plus hub-only resolution hints (stripped before sending). */
export interface Step extends Action {
    /** Click a list item on this page whose label contains `contains`, resolved when the step runs. */
    match?: { listKey: string; contains: string };
    /** STRETCH: skip this step when its target doesn't show up (~2 s) instead of failing the sequence. */
    optional?: boolean;
    /** STRETCH: run this step only after an earlier one failed (switching back to where the user was). */
    onFail?: boolean;
    /** STRETCH: skip this step while the element at this path is still on screen (waits ~3 s for it to go). */
    unlessPresent?: string;
}

export interface PatternAction extends Action {
    steps: Step[];
    sig: string; // unit shape, used to count repeats
}

interface Prov {
    stateKey: string;
    listKey: string;
    index: number;
    field?: string;
    attr: "label" | "value";
}

export function norm(v: string): string {
    const t = v.trim().toLowerCase();
    const m = t.match(/^\$?\s*(\d*\.?\d+)$/);
    return m ? Number(m[1]).toFixed(2) : t;
}

function isTrigger(e: HistEntry | undefined): boolean {
    // A click on a page button that isn't itself a list item (clicking a search result doesn't end a unit).
    return !!e && e.op === "click" && e.app === CHROME && e.target?.role === "button" && !e.target.list;
}

/** Steps on the trigger's URL since the previous trigger on that URL (exclusive), through the trigger. */
export function unitOf(h: HistEntry[]): HistEntry[] | null {
    const trig = h.at(-1);
    if (!isTrigger(trig)) return null;
    const unit: HistEntry[] = [trig!];
    for (let k = h.length - 2; k >= 0; k--) {
        const e = h[k];
        if (e.url !== trig!.url) continue;
        if (isTrigger(e)) break;
        if (e.op === "navigate") continue; // page loads aren't part of the chore (and replaying one leaves the page)
        unit.unshift(e);
    }
    const u = unit.slice(-MAX_UNIT);
    return u.length >= MIN_UNIT ? u : null;
}

function provCandidates(v: string, others: ScreenState[]): Prov[] {
    const n = norm(v);
    if (n.length < 2) return [];
    const out: Prov[] = [];
    for (const s of others) {
        const seen = new Set<string>();
        for (const el of s.elements) {
            if (!el.list) continue;
            const attr = norm(el.label) === n ? "label" : el.value !== undefined && norm(el.value) === n ? "value" : null;
            if (!attr) continue;
            const k = `${el.list.key}#${el.list.index}`;
            if (seen.has(k)) continue; // first matching field per row wins (td vs its link)
            seen.add(k);
            out.push({ stateKey: stateKey(s), listKey: el.list.key, index: el.list.index, field: el.list.field, attr });
        }
    }
    return out;
}

function listLength(s: ScreenState, listKey: string): number {
    let max = -1;
    for (const e of s.elements) if (e.list?.key === listKey) max = Math.max(max, e.list.index);
    return max + 1;
}

/** One step of a saved workflow: a literal value, a value from a field of the source row, or a list-item click. */
export interface TemplateStep {
    op: Action["op"];
    app: string;
    url?: string;
    targetId?: string;
    targetPath?: string;
    value?: string; // literal (e.g. "Done")
    prov?: { field?: string; attr: "label" | "value" }; // typed value comes from this field of the source row
    contains?: { listKey: string; field?: string; attr: "label" | "value" }; // click the item on this page whose label contains that row value
}

/** A learned repeat unit, saved to disk so it can be offered again after a restart. */
export interface Workflow {
    sig: string; // unit signature (same as the live rule's)
    url: string; // page the steps run on (the tracker)
    srcHost: string; // host of the source list page (github.com)
    srcTitle?: string; // window title of the source page when learned
    listKey: string; // source list path
    fields: string[]; // prov fields used, e.g. td:nth-child(1), td:nth-child(3)
    template: TemplateStep[];
    learnedAt: number;
    accepted: number;
}

function itemValue(s: ScreenState, listKey: string, field: string | undefined, attr: "label" | "value", index: number): string | undefined {
    const el = s.elements.find((e) => e.list?.key === listKey && e.list.index === index && e.list.field === field);
    const v = el && (attr === "label" ? el.label : el.value);
    return v?.trim() || undefined;
}

/** Steps for row `index` of the source list. Shared by the live rule and recall. */
export function unitFor(wf: Workflow, src: ScreenState, index: number, listKey = wf.listKey): { steps: Step[]; vals: string[] } | null {
    const steps: Step[] = [];
    const vals: string[] = [];
    for (const t of wf.template) {
        const step: Step = { op: t.op, app: t.app, url: t.url, targetId: t.targetId, targetPath: t.targetPath, value: t.value, label: "", confidence: 1, source: "pattern" };
        if (t.prov) {
            const v = itemValue(src, listKey, t.prov.field, t.prov.attr, index);
            if (!v) return null;
            step.value = v;
            if (!vals.includes(v)) vals.push(v);
        }
        if (t.contains) {
            const v = itemValue(src, listKey, t.contains.field, t.contains.attr, index);
            if (!v) return null;
            step.match = { listKey: t.contains.listKey, contains: v };
            delete step.targetId;
            delete step.targetPath;
        }
        steps.push(step);
    }
    return { steps, vals };
}

/** Saved workflows. `file` null = memory only (tests). Writes are atomic (temp file + rename). */
export class WorkflowStore {
    private map = new Map<string, Workflow>();
    constructor(private file: string | null) {
        if (!file || !existsSync(file)) return;
        try {
            for (const w of JSON.parse(readFileSync(file, "utf8")) as Workflow[]) this.map.set(w.sig, w);
        } catch (e) {
            console.error(`[pattern] ignoring unreadable ${file}: ${(e as Error).message}`);
        }
    }
    all(): Workflow[] {
        return [...this.map.values()];
    }
    get(sig: string): Workflow | undefined {
        return this.map.get(sig);
    }
    upsert(w: Workflow): void {
        const old = this.map.get(w.sig);
        this.map.set(w.sig, old ? { ...w, learnedAt: old.learnedAt, accepted: Math.max(old.accepted, w.accepted) } : w);
        this.flush();
    }
    clear(): void {
        this.map.clear();
        if (this.file && existsSync(this.file)) rmSync(this.file);
    }
    private flush(): void {
        if (!this.file) return;
        mkdirSync(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(this.all(), null, 2));
        renameSync(tmp, this.file);
    }
}

export const DEFAULT_WORKFLOWS_FILE = join(homedir(), ".tab", "workflows.json");

const hostOf = (u?: string) => {
    try {
        return u ? new URL(u).host : "";
    } catch {
        return "";
    }
};

/** "v1.4.0" from "Release v1.4.0 · alaramartin/tab-demo · GitHub", else the title's first part. */
function shortName(s: ScreenState): string {
    const v = `${s.window} ${s.url ?? ""}`.match(/\bv\d+(?:\.\d+)+\b/);
    if (v) return v[0];
    const head = (s.window || hostOf(s.url)).split(" · ")[0].trim();
    return head.length > 24 ? head.slice(0, 23) + "…" : head;
}

function clock(ts: number): string {
    const d = new Date(ts);
    const h = d.getHours();
    return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export class PatternEngine {
    private seen = new Map<string, Set<number>>(); // sig → trigger timestamps
    private accepted = new Map<string, number>();
    readonly workflows: WorkflowStore;

    constructor(opts: { file?: string | null } = {}) {
        this.workflows = new WorkflowStore(opts.file ?? null);
    }

    onAccepted(sig: string): void {
        this.accepted.set(sig, (this.accepted.get(sig) ?? 0) + 1);
        const w = this.workflows.get(sig);
        if (w) this.workflows.upsert({ ...w, accepted: w.accepted + 1 });
    }

    /** Forget saved workflows (full reset-demo). */
    forgetWorkflows(): void {
        this.workflows.clear();
    }

    predict(h: HistEntry[], states: ScreenState[], now: number): PatternAction | null {
        const unit = unitOf(h);
        if (!unit) return null;
        const url = unit.at(-1)!.url!;
        const others = states.filter((s) => now - s.ts <= CACHE_MS && stateKey(s) !== url);

        // Provenance: pick the (state, list, row) that explains the most typed values.
        const cands = unit.map((e) => (e.op === "type" && e.value ? provCandidates(e.value, others) : []));
        const votes = new Map<string, number>();
        for (const cs of cands)
            for (const c of new Set(cs.map((c) => `${c.stateKey}\n${c.listKey}\n${c.index}`)))
                votes.set(c, (votes.get(c) ?? 0) + 1);
        if (votes.size === 0) return null;
        const best = [...votes].sort((a, b) => b[1] - a[1])[0][0];
        const provs: (Prov | null)[] = cands.map(
            (cs) => cs.find((c) => `${c.stateKey}\n${c.listKey}\n${c.index}` === best) ?? null,
        );
        const p0 = provs.find((p) => p)!;
        const src = states.find((s) => stateKey(s) === p0.stateKey)!;

        // Clicks on list items on this page whose label mentions a provenance value become label matches.
        const template: TemplateStep[] = unit.map((e, k) => {
            const t: TemplateStep = { op: e.op, app: e.app, url: e.url, targetId: e.target?.id, targetPath: e.target?.path, value: e.value };
            const p = provs[k];
            if (p) {
                t.prov = { field: p.field, attr: p.attr };
                delete t.value;
            } else if (e.op === "click" && e.target?.list) {
                const label = e.target.label.toLowerCase();
                const j = unit.findIndex((u, i) => provs[i] && label.includes(u.value!.trim().toLowerCase()));
                if (j >= 0) t.contains = { listKey: e.target.list.key, field: provs[j]!.field, attr: provs[j]!.attr };
            }
            return t;
        });

        const sig =
            url +
            "|" +
            template
                .map((t) => [t.op, t.contains ? `list:${t.contains.listKey}` : t.targetPath ?? "", t.prov ? `prov:${t.prov.field}` : t.value ?? ""].join(","))
                .join(";");

        const wf: Workflow = {
            sig,
            url,
            srcHost: hostOf(src.url),
            srcTitle: src.window,
            listKey: p0.listKey,
            fields: [...new Set(template.flatMap((t) => [t.prov, t.contains].filter(Boolean).map((x) => x!.field ?? "")))],
            template,
            learnedAt: now,
            accepted: this.accepted.get(sig) ?? 0,
        };

        const seenSet = this.seen.get(sig) ?? new Set();
        seenSet.add(unit.at(-1)!.ts);
        this.seen.set(sig, seenSet);
        const confidence = seenSet.size >= 2 ? 0.97 : 0.85;

        const next = p0.index + 1;
        const first = unitFor(wf, src, next);
        if (!first) return null;
        if (unitFor(wf, src, p0.index)) this.workflows.upsert(wf); // full provenance: worth remembering

        const base = { op: "sequence" as const, app: CHROME, url, confidence, source: "pattern" as const, sig };
        if ((this.accepted.get(sig) ?? 0) >= 2) {
            const steps: Step[] = [];
            let n = 0;
            for (let i = next; i < listLength(src, p0.listKey); i++) {
                const u = unitFor(wf, src, i);
                if (!u) break;
                steps.push(...u.steps);
                n++;
            }
            return { ...base, steps, label: `Do the remaining ${n}` };
        }
        return { ...base, steps: first.steps, label: `Repeat for ${first.vals.join(" · ")}` };
    }

    /**
     * Offer a saved workflow for the whole list, before the user does anything (recognised by context: this page plus a
     * source page with a list of the same shape). Rows already done are redone; the steps are idempotent.
     */
    recall(active: ScreenState, states: ScreenState[], now: number, h: HistEntry[]): PatternAction | null {
        const wfs = this.workflows.all().filter((w) => w.url === stateKey(active));
        if (!wfs.length || active.source !== "web") return null;
        // Only on a fresh visit: nothing done on this page since the last navigation to it.
        let k = h.length - 1;
        for (; k >= 0; k--) if (h[k].op === "navigate" && h[k].value === active.url) break;
        if (h.slice(k + 1).some((e) => e.url === active.url && e.op !== "navigate")) return null;

        const others = states.filter((s) => now - s.ts <= CACHE_MS && stateKey(s) !== stateKey(active));
        for (const wf of wfs.sort((a, b) => b.learnedAt - a.learnedAt)) {
            for (const s of others) {
                let key: string | undefined;
                if (hostOf(s.url) === wf.srcHost && s.elements.some((e) => e.list?.key === wf.listKey)) key = wf.listKey;
                else {
                    // Fallback: any list whose items have all the fields the workflow reads.
                    const byKey = new Map<string, Set<string>>();
                    for (const e of s.elements) if (e.list) byKey.set(e.list.key, (byKey.get(e.list.key) ?? new Set()).add(e.list.field ?? ""));
                    key = [...byKey].find(([, f]) => wf.fields.every((x) => f.has(x)))?.[0];
                }
                if (!key) continue;
                const steps: Step[] = [];
                let n = 0;
                for (let i = 0; i < listLength(s, key); i++) {
                    const u = unitFor(wf, s, i, key);
                    if (!u) break;
                    steps.push(...u.steps);
                    n++;
                }
                if (!n) continue;
                return {
                    op: "sequence",
                    app: CHROME,
                    url: wf.url,
                    steps,
                    label: `Do all ${n} from ${shortName(s)} · learned ${clock(wf.learnedAt)}`,
                    confidence: 0.9,
                    source: "pattern",
                    sig: wf.sig,
                };
            }
        }
        return null;
    }
}
