// Pattern rule: "do a chore once, Tab repeats it for the next item". See PLAN.md, Agent B.
// Synchronous and model-free; must stay well under 10 ms.
import type { Action, El, ScreenState } from "../../protocol/types.ts";
import type { HistEntry } from "./history.ts";
import { CACHE_MS, CHROME, stateKey } from "./state.ts";

const MIN_UNIT = 2;
const MAX_UNIT = 12;

/** A sequence step plus hub-only resolution hints (stripped before sending). */
export interface Step extends Action {
    /** Click a list item on this page whose label contains `contains`, resolved when the step runs. */
    match?: { listKey: string; contains: string };
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

function listItem(s: ScreenState, p: Prov, index: number): El | undefined {
    return s.elements.find((e) => e.list?.key === p.listKey && e.list.index === index && e.list.field === p.field);
}

function listLength(s: ScreenState, listKey: string): number {
    let max = -1;
    for (const e of s.elements) if (e.list?.key === listKey) max = Math.max(max, e.list.index);
    return max + 1;
}

export class PatternEngine {
    private seen = new Map<string, Set<number>>(); // sig → trigger timestamps
    private accepted = new Map<string, number>();

    onAccepted(sig: string): void {
        this.accepted.set(sig, (this.accepted.get(sig) ?? 0) + 1);
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
        const provVals = unit.map((e, k) => (provs[k] ? e.value! : null));
        const template = unit.map((e, k) => {
            const contains =
                e.op === "click" && e.target?.list
                    ? provVals.find((v) => v && e.target!.label.toLowerCase().includes(v.trim().toLowerCase()))
                    : undefined;
            return { e, prov: provs[k], contains: contains ?? undefined };
        });

        const sig =
            url +
            "|" +
            template
                .map(({ e, prov, contains }) =>
                    [e.op, contains ? `list:${e.target!.list!.key}` : e.target?.path ?? "", prov ? `prov:${prov.field}` : e.value ?? ""].join(","),
                )
                .join(";");

        const unitFor = (index: number): { steps: Step[]; vals: string[] } | null => {
            const steps: Step[] = [];
            const vals: string[] = [];
            const newVal = new Map<string, string>(); // old prov value → new
            for (const { e, prov } of template) {
                if (!prov) continue;
                const el = listItem(src, prov, index);
                const v = el && (prov.attr === "label" ? el.label : el.value);
                if (!v) return null;
                newVal.set(e.value!.trim().toLowerCase(), v.trim());
                if (!vals.includes(v.trim())) vals.push(v.trim());
            }
            for (const { e, prov, contains } of template) {
                const step: Step = {
                    op: e.op,
                    app: e.app,
                    url: e.url,
                    targetId: e.target?.id,
                    targetPath: e.target?.path,
                    value: prov ? newVal.get(e.value!.trim().toLowerCase()) : e.value,
                    label: "",
                    confidence: 1,
                    source: "pattern",
                };
                if (contains) {
                    step.match = { listKey: e.target!.list!.key, contains: newVal.get(contains.trim().toLowerCase())! };
                    delete step.targetId;
                    delete step.targetPath;
                }
                steps.push(step);
            }
            return { steps, vals };
        };

        const seenSet = this.seen.get(sig) ?? new Set();
        seenSet.add(unit.at(-1)!.ts);
        this.seen.set(sig, seenSet);
        const confidence = seenSet.size >= 2 ? 0.97 : 0.85;

        const next = p0.index + 1;
        const first = unitFor(next);
        if (!first) return null;

        const base = { op: "sequence" as const, app: CHROME, url, confidence, source: "pattern" as const, sig };
        if ((this.accepted.get(sig) ?? 0) >= 2) {
            const steps: Step[] = [];
            let n = 0;
            for (let i = next; i < listLength(src, p0.listKey); i++) {
                const u = unitFor(i);
                if (!u) break;
                steps.push(...u.steps);
                n++;
            }
            return { ...base, steps, label: `Do the remaining ${n}` };
        }
        return { ...base, steps: first.steps, label: `Repeat for ${first.vals.join(" · ")}` };
    }
}
