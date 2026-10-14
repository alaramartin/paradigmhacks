// Candidate next actions, built in code. Jev doesn't generate; it picks one of these.
import type { Action, El, ScreenState } from "../../protocol/types.ts";
import type { HistEntry } from "./history.ts";
import { CHROME, stateKey } from "./state.ts";

export interface Candidate {
    desc: string; // what Jev reads, e.g. `Type "4471-209" into "Rx number"`
    groupDesc?: string; // the element as a whole, when it has several candidate values
    action: Action;
}

const MAX = 120; // Jev allows 255 options; fewer distractors is more accurate
const MAX_VALUES_PER_FIELD = 8;

// Values worth copying between pages: ticket/Rx codes, PR numbers, money, emails, times, short place names.
const VALUE_RES = [
    /\b[A-Z]{2,6}-\d{1,6}\b/g, // ENG-142
    /\b\d{3,}-\d{2,}\b/g, // 4471-209
    /#\d{1,6}\b/g, // #12
    /\$\d+(?:\.\d{2})?/g,
    /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g,
    /\b\d{1,2}(?::\d{2})?\s?[ap]m\b/gi,
];

function q(s: string, max = 60): string {
    const t = s.replace(/\s+/g, " ").trim();
    return `"${t.length > max ? t.slice(0, max) + "…" : t}"`;
}

function action(op: Action["op"], active: ScreenState, el: El | undefined, label: string, value?: string): Action {
    return {
        op,
        app: active.app,
        url: active.url,
        targetId: el?.id,
        targetPath: el?.path,
        ...(value !== undefined ? { value } : {}),
        label,
        confidence: 0,
        source: "model",
    };
}

/** Values found on other recent pages/apps, plus option labels on this page, for filling empty fields. */
function copyableValues(others: ScreenState[], active: ScreenState): string[] {
    const out = new Set<string>();
    for (const s of others) {
        if (stateKey(s) === stateKey(active)) continue;
        for (const e of s.elements) {
            const text = `${e.label} ${e.value ?? ""}`;
            for (const re of VALUE_RES) for (const m of text.matchAll(re)) out.add(m[0]);
        }
    }
    return [...out];
}

/** GitHub "Open a pull request": a description from the commit titles on the page. */
export function prDescription(active: ScreenState): string | null {
    if (!active.url || !/github\.com\/.+\/(compare|pull\/new)\//.test(active.url)) return null;
    // Commit list items: links in a repeated list whose path or key mentions "commit". GitHub splits a title that
    // references a PR into several links ("Fix … (", "#22424", ")") inside the message <p>; author and hash links are
    // separate. So: per item, join the links in its message paragraph; else take the first non-hash, non-empty link.
    const items = new Map<number, El[]>();
    for (const e of active.elements) {
        if (e.role !== "link" || !e.list || !/commit/i.test(`${e.path ?? ""} ${e.list.key}`)) continue;
        items.set(e.list.index, [...(items.get(e.list.index) ?? []), e]);
    }
    const isHash = (t: string) => /^[0-9a-f]{7,40}$/.test(t);
    const commits: string[] = [];
    for (const [, links] of [...items].sort((x, y) => x[0] - y[0])) {
        const msg = links.filter((e) => /(^|> )p > a/.test(e.list?.field ?? "") || /(^|> )p > a/.test(e.path ?? ""));
        const title = msg.length
            ? msg.map((e) => e.label.trim()).join(" ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim()
            : links.map((e) => e.label.trim()).find((t) => t && !isHash(t));
        if (title && !commits.includes(title)) commits.push(title);
    }
    if (commits.length === 0) return null;
    const summary = commits.length === 1 ? commits[0] : `${commits[0]}, and ${commits.length - 1} more change${commits.length > 2 ? "s" : ""}.`;
    return `${summary}\n\n## Changes\n${commits.map((c) => `- ${c}`).join("\n")}`;
}

/** Lowercased text of every recent page except the active one. */
export function otherPagesText(active: ScreenState, others: ScreenState[]): string {
    return others
        .filter((s) => stateKey(s) !== stateKey(active))
        .flatMap((s) => s.elements.map((e) => `${e.label} ${e.value ?? ""}`))
        .join("\n")
        .toLowerCase();
}

/** For a select: options (other than the current one) that other pages mention. */
export function mentionedOptions(el: El, otherText: string): string[] {
    // Whole words only, and not bare short numbers: "1" is in every page.
    const esc = (o: string) => o.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (el.options ?? []).filter(
        (o) => o !== el.value && !/^\d{1,2}$/.test(o.trim()) && new RegExp(`(^|[^\\w])${esc(o)}($|[^\\w])`).test(otherText),
    );
}

export function candidates(active: ScreenState, others: ScreenState[], _history: HistEntry[]): Candidate[] {
    const out: Candidate[] = [];

    if (active.source === "native") {
        // Terminal: offer to open URLs it printed, newest first (e.g. GitHub's "Create a pull request" link).
        const text = active.elements[0]?.value ?? "";
        const urls = [...new Set([...text.matchAll(/https?:\/\/[^\s'"<>]+/g)].map((m) => m[0]))].reverse();
        for (const u of urls.slice(0, 5)) {
            const isPr = /\/pull\/new\//.test(u);
            out.push({
                desc: `Open ${q(u, 120)} in Chrome${isPr ? " (the pull request link git just printed)" : ""}`,
                action: { op: "navigate", app: CHROME, value: u, label: isPr ? "Open pull request" : `Open ${new URL(u).host}`, confidence: 0, source: "model" },
            });
        }
        return out;
    }

    const values = copyableValues(others, active);
    const otherText = otherPagesText(active, others);
    const pr = prDescription(active);
    for (const el of active.elements) {
        if (!el.enabled) continue;
        const name = el.label || "(unlabeled)";
        switch (el.role) {
            case "button":
                if (el.list && el.checked !== undefined) out.push({ desc: `Click ${q(name)}${el.checked ? " (already selected)" : ""}`, action: action("click", active, el, `Click ${name}`) });
                else out.push({ desc: `Click ${q(name)}`, action: action("click", active, el, `Click ${name}`) });
                break;
            case "checkbox":
                if (!el.checked) out.push({ desc: `Check ${q(name)}`, action: action("click", active, el, `Check "${name}"`) });
                break;
            case "select": {
                // Resolve the indirection in code: options that other pages mention are the likely ones.
                const opts = (el.options ?? []).filter((o) => o !== el.value);
                const mentioned = mentionedOptions(el, otherText);
                const use = mentioned.length ? mentioned : opts;
                const groupDesc = mentioned.length
                    ? `Change ${q(name)} from ${q(el.value ?? "")} to ${q(mentioned[0])}, which another page mentions`
                    : `Change ${q(name)} (now ${q(el.value ?? "")})`;
                for (const opt of use) out.push({ desc: `Choose ${q(opt)} in ${q(name)}`, groupDesc, action: action("type", active, el, `Select ${opt}`, opt) });
                break;
            }
            case "textfield":
                if (el.value) break;
                for (const v of values.slice(0, MAX_VALUES_PER_FIELD))
                    out.push({ desc: `Type ${q(v)} into ${q(name)}`, groupDesc: `Fill in the empty ${q(name)} field`, action: action("type", active, el, `Type ${v}`, v) });
                break;
            case "textarea":
                if (!el.value && pr && /description|comment|body|write/i.test(name + " " + (el.path ?? "")))
                    out.push({ desc: `Write the pull request description (from the commits) into ${q(name)}`, action: action("type", active, el, "Write description", pr) });
                break;
            case "link":
                out.push({ desc: `Click link ${q(name)}`, action: action("click", active, el, `Click ${name}`) });
                break;
        }
    }
    // Links are the noisiest; keep everything else first when trimming.
    const nonLinks = out.filter((c) => !c.desc.startsWith("Click link"));
    const links = out.filter((c) => c.desc.startsWith("Click link"));
    return [...nonLinks, ...links].slice(0, MAX);
}
