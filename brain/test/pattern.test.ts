import assert from "node:assert/strict";
import { test } from "node:test";
import type { HistEntry } from "../src/history.ts";
import { norm, PatternEngine, type Step } from "../src/pattern.ts";
import { CHROME, releaseState, ticketByHand, TRACKER_URL, trackerState } from "./synthetic.ts";

const T0 = 1_000_000;
const states = () => [releaseState(T0 - 30_000), trackerState(T0 + 6000)];

/** What the hub appends to history when a pattern sequence runs. */
function executed(steps: Step[], t0: number): HistEntry[] {
    return steps.map((s, k) => {
        const target = s.match
            ? { id: "x", role: "button" as const, label: s.match.contains, list: { key: s.match.listKey, index: 0, field: "button" } }
            : { id: s.targetId!, path: s.targetPath, role: (s.targetPath?.includes("button.save") ? "button" : "textfield") as "button" | "textfield", label: "" };
        return { op: s.op, app: s.app, url: s.url, target, value: s.value, ts: t0 + k, by: "tab" as const };
    });
}

const strip = (steps: Step[]) => steps.map(({ op, targetPath, value, match }) => ({ op, targetPath, value, match }));

test("norm treats currency forms as equal", () => {
    assert.equal(norm("$0.30"), norm("0.30"));
    assert.equal(norm(".30"), norm("0.3"));
    assert.equal(norm(" ENG-142 "), "eng-142");
});

test("ticket 1 by hand → Repeat for ENG-150 · #13 with exact steps", () => {
    const eng = new PatternEngine();
    const h = ticketByHand(0, T0);
    const t = performance.now();
    const a = eng.predict(h, states(), T0 + 6000)!;
    const ms = performance.now() - t;
    assert.ok(a, "expected a prediction");
    assert.ok(ms < 10, `took ${ms} ms`);
    assert.equal(a.label, "Repeat for ENG-150 · #13");
    assert.equal(a.op, "sequence");
    assert.equal(a.source, "pattern");
    assert.equal(a.confidence, 0.85);
    assert.deepEqual(strip(a.steps), [
        { op: "click", targetPath: "#search", value: undefined, match: undefined },
        { op: "type", targetPath: "#search", value: "ENG-150", match: undefined },
        { op: "click", targetPath: undefined, value: undefined, match: { listKey: "ul.tickets", contains: "ENG-150" } },
        { op: "type", targetPath: "#panel select[name=status]", value: "Done", match: undefined },
        { op: "type", targetPath: "#panel input[name=pr]", value: "#13", match: undefined },
        { op: "click", targetPath: "#panel button.save", value: undefined, match: undefined },
    ]);
    for (const s of a.steps) assert.equal(s.url, TRACKER_URL);
});

test("clicking a search result mid-ticket does not trigger", () => {
    const eng = new PatternEngine();
    const h = ticketByHand(0, T0).slice(0, 3);
    assert.equal(eng.predict(h, states(), T0 + 3000), null);
});

test("two accepted repeats → Do the remaining 3", () => {
    const eng = new PatternEngine();
    const h = ticketByHand(0, T0);
    const a1 = eng.predict(h, states(), T0 + 6000)!;
    eng.onAccepted(a1.sig);
    h.push(...executed(a1.steps, T0 + 10_000));

    const a2 = eng.predict(h, states(), T0 + 11_000)!;
    assert.equal(a2.label, "Repeat for ENG-151 · #14");
    assert.equal(a2.sig, a1.sig, "tab-run unit must have the same shape as the hand-done one");
    assert.equal(a2.confidence, 0.97);
    eng.onAccepted(a2.sig);
    h.push(...executed(a2.steps, T0 + 20_000));

    const a3 = eng.predict(h, states(), T0 + 21_000)!;
    assert.equal(a3.label, "Do the remaining 3");
    assert.equal(a3.steps.length, 18);
    const typed = a3.steps.filter((s) => s.op === "type").map((s) => s.value);
    assert.deepEqual(typed, ["ENG-155", "Done", "#15", "ENG-157", "Done", "#16", "ENG-160", "Done", "#17"]);

    h.push(...executed(a3.steps.slice(-6), T0 + 30_000));
    assert.equal(eng.predict(h, states(), T0 + 31_000), null, "no row after ENG-160");
});

test("no provenance → no prediction (tickets checkout)", () => {
    const eng = new PatternEngine();
    const url = "http://tickets.localhost:4001/e/night-owls";
    const h: HistEntry[] = [
        { op: "type", app: CHROME, url, target: { id: "q", path: "#qty", role: "select", label: "Qty" }, value: "2", ts: T0, by: "user" },
        { op: "click", app: CHROME, url, target: { id: "c", path: "#checkout", role: "button", label: "Checkout" }, ts: T0 + 1, by: "user" },
    ];
    assert.equal(eng.predict(h, states(), T0 + 2), null);
});

test("navigations in history are never replayed as part of a unit", () => {
    const eng = new PatternEngine();
    const h = ticketByHand(0, T0);
    h.unshift({ op: "navigate", app: CHROME, url: TRACKER_URL, value: "http://pharmacy.localhost:4005/refill", ts: T0 - 10, by: "user" });
    h.splice(2, 0, { op: "navigate", app: CHROME, url: TRACKER_URL, value: TRACKER_URL, ts: T0 + 500, by: "user" });
    const a = eng.predict(h, states(), T0 + 6000)!;
    assert.equal(a.label, "Repeat for ENG-150 · #13");
    assert.ok(a.steps.every((s) => s.op !== "navigate"));
});
