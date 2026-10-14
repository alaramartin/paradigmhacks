// STRETCH (branch stretch/calendar-native): cross-app memory into Calendar.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubToShell, HubToWeb, PaymentRequired, ScreenState } from "../../protocol/types.ts";
process.env.TAB_CALENDAR_OFFER_MS = "0"; // read when brain.ts loads, so set it before the dynamic imports
const { Brain } = await import("../src/brain.ts");
const { CALENDAR, calendarOffer, eventFrom } = await import("../src/calendar.ts");
const { log } = await import("../src/log.ts");
log.enabled = false;
const r = { x: 0, y: 0, w: 10, h: 10 };
const checkout = (window: string, texts: string[]): ScreenState => ({
    type: "state", source: "web", app: "com.google.Chrome", window, url: "http://tickets.localhost:4001/checkout?qty=2", focused: true, seq: 1, ts: Date.now(),
    elements: texts.map((label, i) => ({ id: `t${i}`, role: "text" as const, label, rect: r, enabled: true })),
});

test("event from the real checkout page text", () => {
    const ev = eventFrom(checkout("Checkout · Night Owls · Hall 9", ["Box office", "Night Owls", "Friday 9 pm, Hall 9, Dock Road", "Total", "$0.30"]));
    assert.deepEqual(ev, { title: "Night Owls", venue: "Hall 9", when: "Fri 9pm" });
    assert.equal(eventFrom(checkout("Refill · CareRx", ["Copay $0.05"])), null, "no day and time → no offer");
});

test("offer: Add Event → quick event text → Return → Tab Demo → back to Chrome", () => {
    const o = calendarOffer({ title: "Night Owls", venue: "Hall 9", when: "Fri 9pm" });
    assert.equal(o.label, "Add Night Owls · Fri 9pm to Calendar");
    assert.deepEqual(o.steps.map((s) => [s.op, s.app === CALENDAR ? "cal" : s.app, s.targetPath ?? "", s.value ?? ""]), [
        ["click", "cal", "desc:Add Event", ""],
        ["type", "cal", "id:QuickEventCell", "Night Owls at Hall 9 Fri 9pm"],
        ["key", "cal", "", "Return"],
        ["type", "cal", "id:calendar-button", "Tab Demo"],
        ["switch_app", "com.google.Chrome", "", "com.google.Chrome"],
    ]);
});

test("hub offers it after a paid order, and never asks the model about Calendar screens", async () => {
    const shell: HubToShell[] = [];
    const calls: string[] = [];
    const b = new Brain({ immediate: true, decider: { name: "fake", decide: async (m) => (calls.push(m.active.app), null) }, sendShell: (m) => shell.push(m), sendWeb: (_m: HubToWeb) => {} });
    b.fromShell({ type: "frontmost", app: "com.google.Chrome", window: "Checkout" });
    b.fromWeb(checkout("Checkout · Night Owls · Hall 9", ["Night Owls", "Friday 9 pm, Hall 9, Dock Road", "Total", "$0.30"]));
    const p: PaymentRequired = { type: "payment_required", paymentId: "p1", url: "http://tickets.localhost:4001/api/buy?qty=2", method: "POST", payeeDomain: "tickets.localhost", payTo: "0x", amountUsd: "0.30", network: "n", asset: "a", verdict: { ok: true }, anchorRect: r };
    b.fromWeb(p);
    b.fromShell({ type: "accept", ghostId: (shell.filter((m) => m.type === "ghost").at(-1) as any).ghost.id });
    b.fromWeb({ type: "payment_result", paymentId: "p1", ok: true, txHash: "0x1", explorerUrl: "https://x/tx/0x1" });
    await new Promise((res) => setTimeout(res, 20));
    const labels = shell.filter((m) => m.type === "ghost").map((m) => (m as any).ghost.label);
    assert.ok(labels.includes("Add Night Owls · Fri 9pm to Calendar ⇥"), labels.join(" | "));

    b.fromShell({ type: "frontmost", app: CALENDAR, window: "Calendar" });
    b.fromShell({ type: "state", source: "native", app: CALENDAR, window: "Calendar", focused: true, seq: 1, ts: Date.now(), elements: [{ id: "desc:Add Event", role: "button", label: "Add Event", rect: r, enabled: true, path: "desc:Add Event" }] });
    await b.predictNow();
    assert.ok(!calls.includes(CALENDAR), "model never sees Calendar");
});

test("sequence waits until QuickEventCell holds the typed text before Return", async () => {
    const TEXT = "Night Owls at Hall 9 Fri 9pm";
    const cal = (seq: number, value: string, extra: ScreenState["elements"] = []): ScreenState => ({
        type: "state", source: "native", app: CALENDAR, window: "Calendar", focused: true, seq, ts: Date.now(),
        elements: [
            { id: "desc:Add Event", role: "button", label: "Add Event", rect: r, enabled: true, path: "desc:Add Event" },
            { id: "id:QuickEventCell", role: "textfield", label: "Add Event", value, rect: r, enabled: true, path: "id:QuickEventCell" },
            ...extra,
        ],
    });
    const execs: { op: string; ts: number }[] = [];
    let typedAt = 0;
    let valueAt = 0;
    let brain!: InstanceType<typeof Brain>;
    brain = new Brain({
        immediate: true,
        decider: { name: "fake", decide: async () => null },
        sendShell: (m) => {
            if (m.type !== "exec") return;
            const op = (m as any).action.op as string;
            const value = (m as any).action.value as string | undefined;
            execs.push({ op, ts: Date.now() });
            queueMicrotask(() => brain.fromShell({ type: "exec_result", ghostId: (m as any).ghostId, ok: true }));
            if (op === "click") queueMicrotask(() => brain.fromShell(cal(2, "")));
            if (op === "type" && value === TEXT) {
                typedAt = Date.now();
                // Stale poll right after type (the live bug): field still empty. Return must not fire yet.
                queueMicrotask(() => brain.fromShell(cal(3, "")));
                setTimeout(() => {
                    valueAt = Date.now();
                    brain.fromShell(cal(4, TEXT, [{ id: "id:calendar-button", role: "select", label: "Tab Demo", rect: r, enabled: true, path: "id:calendar-button" }]));
                }, 280);
            }
        },
        sendWeb: (_m: HubToWeb) => {},
    });
    brain.fromShell({ type: "frontmost", app: CALENDAR, window: "Calendar" });
    brain.fromShell(cal(1, ""));
    const offer = calendarOffer({ title: "Night Owls", venue: "Hall 9", when: "Fri 9pm" });
    const shown: HubToShell[] = [];
    const orig = (brain as any).o.sendShell.bind((brain as any).o);
    (brain as any).o.sendShell = (m: HubToShell) => {
        shown.push(m);
        orig(m);
    };
    (brain as any).maybeShow(offer, ++(brain as any).gen, 0);
    const g = shown.find((m) => m.type === "ghost") as any;
    assert.ok(g?.ghost?.id, "offer shown");
    brain.fromShell({ type: "accept", ghostId: g.ghost.id });
    const t0 = Date.now();
    while (!execs.some((e) => e.op === "key") && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 20));
    const ret = execs.find((e) => e.op === "key");
    assert.ok(ret, "Return was sent");
    assert.ok(valueAt > 0 && typedAt > 0, "typed, then value landed");
    assert.ok(ret.ts >= valueAt - 20, `Return at ${ret.ts - typedAt}ms after type, value at ${valueAt - typedAt}ms — must wait for the field`);
});
