// The intent check and list metadata on states captured from the real demo pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ScreenState } from "../../protocol/types.ts";
import { checkIntent } from "../src/intent.ts";

const fx = (n: string): ScreenState => JSON.parse(readFileSync(new URL(`../../protocol/fixtures/${n}.json`, import.meta.url), "utf8"));
const buyRect = (s: ScreenState) => s.elements.find((e) => e.label === "Buy tickets")!.rect;

test("tickets checkout: $0.30 page, $0.30 payment is ok", () => {
    const s = fx("web_state_tickets_checkout");
    assert.deepEqual(checkIntent(s, "0.30", buyRect(s)), { ok: true, pagePriceUsd: "0.30" });
});

test("resale checkout: $0.51 payment is blocked with the exact reason", () => {
    const s = fx("web_state_resale_checkout");
    assert.deepEqual(checkIntent(s, "0.51", buyRect(s)), { ok: false, reason: "page says $0.30, payment asks $0.51", pagePriceUsd: "0.30" });
});

test("pharmacy: $0.05 copay matches 'Total due today'", () => {
    assert.deepEqual(checkIntent(fx("web_state_pharmacy"), "0.05"), { ok: true, pagePriceUsd: "0.05" });
});

test("tracker: six result links share one list, indexes 0..5, stable paths", () => {
    const items = fx("web_state_tracker").elements.filter((e) => e.role === "link" && /^ENG-\d+/.test(e.label));
    assert.equal(items.length, 6);
    assert.equal(new Set(items.map((e) => e.list?.key)).size, 1);
    assert.deepEqual(items.map((e) => e.list?.index), [0, 1, 2, 3, 4, 5]);
    assert.equal(items[0].path, "#results > li:nth-of-type(1) > a");
});

test("pharmacy: fields and controls have stable paths; Request refill is not a list item", () => {
    const s = fx("web_state_pharmacy");
    const by = (l: string) => s.elements.find((e) => e.label === l)!;
    assert.equal(by("Rx number").path, "#rx");
    assert.equal(by("Pickup location").role, "select");
    assert.deepEqual(by("Pickup location").options, ["Main St", "Oak St", "Elm Ave"]);
    assert.equal(by("5:30 pm").checked, false);
    assert.equal(by("Text me when ready").role, "checkbox");
    assert.equal(by("Request refill").list, undefined);
});
