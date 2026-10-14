// Intent check: does the payment ask for what the page shows? Runs before every payment.
import type { El, Rect, ScreenState } from "../../protocol/types.ts";

const MONEY = /(?:US)?\$\s*(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?|\.\d{1,2})|(\d{1,6}(?:\.\d{1,2})?)\s*(?:USDC|USD)\b/i;

/** First currency amount in a string, as a number of dollars. */
export function moneyIn(s: string | undefined): number | null {
    const m = s ? MONEY.exec(s) : null;
    if (!m) return null;
    const n = Number((m[1] ?? m[2]).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
}

export const fmtUsd = (n: number) => n.toFixed(2);

const textOf = (e: El) => [e.label, e.value].filter(Boolean).join(" ");
const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The price the page shows: the "Total" element (or the amount right after it), else the amount nearest the anchor. */
export function pagePrice(state: ScreenState | undefined, anchor?: Rect): number | null {
    if (!state) return null;
    const els = state.elements;
    // Prefer the last "total" (grand total sits below subtotals), in document order.
    for (let i = els.length - 1; i >= 0; i--) {
        const e = els[i];
        if (!/\btotal\b/i.test(textOf(e)) || /\bsub-?total\b/i.test(textOf(e))) continue;
        const own = moneyIn(textOf(e));
        if (own !== null) return own;
        for (let j = i + 1; j < Math.min(els.length, i + 4); j++) {
            const next = moneyIn(textOf(els[j]));
            if (next !== null) return next;
        }
        // Text elements come after interactive ones, so also look for the nearest amount on the same row.
        const c = center(e.rect);
        const row = els
            .filter((x) => x !== e && moneyIn(textOf(x)) !== null && Math.abs(center(x.rect).y - c.y) < Math.max(12, e.rect.h))
            .sort((a, b) => Math.abs(center(a.rect).x - c.x) - Math.abs(center(b.rect).x - c.x));
        if (row[0]) return moneyIn(textOf(row[0]));
    }
    if (!anchor) return null;
    const a = center(anchor);
    let best: { d: number; v: number } | null = null;
    for (const e of els) {
        const v = moneyIn(textOf(e));
        if (v === null) continue;
        const c = center(e.rect);
        const d = Math.hypot(c.x - a.x, c.y - a.y);
        if (!best || d < best.d) best = { d, v };
    }
    return best ? best.v : null;
}

export interface Verdict {
    ok: boolean;
    reason?: string;
    pagePriceUsd?: string;
}

export function checkIntent(state: ScreenState | undefined, amountUsd: string, anchor?: Rect): Verdict {
    const amount = Number(amountUsd);
    const price = pagePrice(state, anchor);
    if (price === null) return { ok: true };
    const pagePriceUsd = fmtUsd(price);
    if (Math.abs(amount - price) > 0.01 + 1e-9) return { ok: false, reason: `page says $${pagePriceUsd}, payment asks $${fmtUsd(amount)}`, pagePriceUsd };
    return { ok: true, pagePriceUsd };
}
