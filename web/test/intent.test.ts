import { test } from "node:test";
import assert from "node:assert/strict";
import type { El, ScreenState } from "../../protocol/types.ts";
import { checkIntent, moneyIn, pagePrice } from "../src/intent.ts";

let n = 0;
const el = (label: string, y: number, x = 100, role: El["role"] = "text"): El => ({ id: `e${n++}`, role, label, rect: { x, y, w: 120, h: 20 }, enabled: true });
const state = (elements: El[]): ScreenState => ({ type: "state", source: "web", app: "com.google.Chrome", window: "w", url: "http://tickets.localhost:4001/checkout?qty=2", focused: true, elements, seq: 1, ts: 0 });

test("moneyIn normalizes", () => {
    assert.equal(moneyIn("Total $0.30"), 0.3);
    assert.equal(moneyIn("$ 1,204.50"), 1204.5);
    assert.equal(moneyIn("0.51 USDC"), 0.51);
    assert.equal(moneyIn("$.34"), 0.34);
    assert.equal(moneyIn("Qty 2"), null);
});

test("total label with amount in the same element", () => {
    assert.equal(pagePrice(state([el("Buy tickets", 400, 100, "button"), el("Subtotal $0.30", 300), el("Total $0.30", 330)])), 0.3);
});

test("total label followed by its amount", () => {
    assert.equal(pagePrice(state([el("Fees $0.00", 280), el("Total", 330), el("$0.30", 330, 300)])), 0.3);
});

test("total label with its amount on the same row, out of order", () => {
    assert.equal(pagePrice(state([el("$0.30", 330, 300), el("Fees", 280), el("$0.00", 280, 300), el("Total", 330)])), 0.3);
});

test("falls back to the amount nearest the anchor", () => {
    const s = state([el("General admission $0.15", 100), el("$0.05 copay", 500)]);
    assert.equal(pagePrice(s, { x: 100, y: 520, w: 100, h: 30 }), 0.05);
});

test("resale mismatch is blocked with the exact reason", () => {
    const v = checkIntent(state([el("Total", 330), el("$0.30", 330, 300)]), "0.51");
    assert.deepEqual(v, { ok: false, reason: "page says $0.30, payment asks $0.51", pagePriceUsd: "0.30" });
});

test("matching amount passes", () => {
    assert.deepEqual(checkIntent(state([el("Total $0.30", 330)]), "0.30"), { ok: true, pagePriceUsd: "0.30" });
    assert.deepEqual(checkIntent(state([el("Total $0.30", 330)]), "0.31"), { ok: true, pagePriceUsd: "0.30" });
});

test("no price on the page is ok without pagePriceUsd", () => {
    assert.deepEqual(checkIntent(state([el("Hello", 1)]), "0.05"), { ok: true });
});
