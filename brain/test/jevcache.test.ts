// Jev answer cache: a slow or failing Jev falls back to the last confident answer for the same screen.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScreenState } from "../../protocol/types.ts";

process.env.JEV_CACHE_AFTER_MS = "100";
const { JevDecider, screenKey } = await import("../src/model.ts");

const r = { x: 0, y: 0, w: 10, h: 10 };
const page = (idSuffix: string): ScreenState => ({
    type: "state", source: "web", app: "com.google.Chrome", window: "Tickets", url: "http://tickets.localhost:4001/e/night-owls", focused: true, seq: 1, ts: Date.now(),
    elements: [
        { id: `q${idSuffix}`, role: "select", label: "Qty", value: "2", options: ["1", "2", "3", "4"], rect: r, enabled: true, path: "#qty" },
        { id: `c${idSuffix}`, role: "button", label: "Checkout", rect: r, enabled: true, path: "#checkout" },
    ],
});
// Jev's answer for this screen: the Checkout element (group a1: the select's options come first as group a0).
const answer = { answers: { next: { type: "choice", choice: "a1", confidence: 0.91, probabilities: { a1: 0.91 } } } };
const realFetch = globalThis.fetch;
function fakeJev(mode: "fast" | "slow" | "fail") {
    globalThis.fetch = (async (_u: unknown, init?: { signal?: AbortSignal }) => {
        if (mode === "fail") throw new Error("Jev down");
        if (mode === "slow") await new Promise((res, rej) => { const t = setTimeout(res, 2000); init?.signal?.addEventListener("abort", () => (clearTimeout(t), rej(new Error("aborted")))); });
        return new Response(JSON.stringify(answer), { status: 200 });
    }) as typeof fetch;
}

test("screen key ignores element ids (they change per page load)", () => {
    assert.equal(screenKey(page("1")), screenKey(page("2")));
    const other = page("1");
    other.elements[0].value = "3";
    assert.notEqual(screenKey(page("1")), screenKey(other));
});

test("fast Jev answers and is cached; slow or failing Jev → the cached answer for the same screen", async () => {
    const d = new JevDecider("k", { cacheFile: null });
    const m = (sfx: string) => ({ active: page(sfx), others: [], history: [] });
    try {
        fakeJev("fast");
        assert.equal((await d.decide(m("1")))?.label, "Click Checkout");
        assert.equal(d.cache.size, 1);

        fakeJev("slow");
        const t = performance.now();
        const a = await d.decide(m("2")); // new page load: new ids, same screen
        assert.equal(a?.label, "Click Checkout");
        assert.equal(a?.targetId, "c2", "cached answer resolves to this load's element");
        assert.ok(performance.now() - t < 1000, "didn't wait for slow Jev");

        fakeJev("fail");
        assert.equal((await d.decide(m("3")))?.label, "Click Checkout");

        fakeJev("fail");
        const fresh = new JevDecider("k", { cacheFile: null });
        await assert.rejects(fresh.decide(m("4")), /Jev down/, "no cache → the error surfaces");
    } finally {
        globalThis.fetch = realFetch;
    }
});
