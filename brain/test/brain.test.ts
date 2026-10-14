import assert from "node:assert/strict";
import { test } from "node:test";
import type { Action, HubToShell, HubToWeb, PaymentRequired, UserEvent } from "../../protocol/types.ts";
import { Brain } from "../src/brain.ts";
import { log } from "../src/log.ts";
import { CHROME, releaseState, ROWS, TRACKER_URL, trackerState, SEARCH, STATUS, PR, SAVE, resultEl } from "./synthetic.ts";

log.enabled = false;

function harness(decide?: () => Action | null) {
    const shell: HubToShell[] = [];
    const web: HubToWeb[] = [];
    let brain!: Brain;
    brain = new Brain({
        immediate: true,
        decider: decide ? { name: "fake", decide: async () => decide() } : null,
        sendShell: (m) => {
            shell.push(m);
            if (m.type === "exec") queueMicrotask(() => brain.fromShell({ type: "exec_result", ghostId: m.ghostId, ok: true }));
        },
        sendWeb: (m) => {
            web.push(m);
            if (m.type === "exec")
                queueMicrotask(() => {
                    brain.fromWeb({ type: "exec_result", ghostId: m.ghostId, ok: true });
                    brain.fromWeb({ ...trackerState(Date.now()), seq: Date.now() });
                });
        },
    });
    const ghosts = () => shell.filter((m) => m.type === "ghost").map((m) => (m as any).ghost);
    return { brain, shell, web, ghosts };
}

const ev = (kind: UserEvent["kind"], target: any, value?: string): UserEvent => ({ type: "user_event", source: "web", app: CHROME, url: TRACKER_URL, kind, target, value, ts: Date.now() });

test("release day: hand-done ticket → two repeats → batch, counters", async () => {
    const { brain, web, ghosts } = harness();
    brain.fromShell({ type: "frontmost", app: CHROME, window: "Tracker" });
    brain.fromWeb(releaseState(Date.now()));
    brain.fromWeb(trackerState(Date.now()));

    for (const [kind, el, v] of [
        ["click", SEARCH],
        ["type", SEARCH, "ENG-142"],
        ["click", resultEl(0)],
        ["type", STATUS, "Done"],
        ["type", PR, "#12"],
        ["click", SAVE],
    ] as const)
        brain.fromWeb(ev(kind, el, v));
    await brain.predictNow();

    let g = ghosts().at(-1)!;
    assert.equal(g.label, "Repeat for ENG-150 · #13 ⇥");
    assert.equal(brain.hud.lastSource, "pattern");

    brain.fromShell({ type: "accept", ghostId: g.id });
    await new Promise((r) => setTimeout(r, 50));
    const execs = web.filter((m) => m.type === "exec").map((m) => (m as any).action);
    assert.equal(execs.length, 6);
    assert.equal(execs[2].targetId, "t1", "result click resolves to ENG-150's list item by label");
    assert.deepEqual(execs.map((a: Action) => a.value).filter(Boolean), ["ENG-150", "Done", "#13"]);
    assert.ok(execs.every((a: any) => a.match === undefined), "hub-only hints are stripped");

    await brain.predictNow();
    g = ghosts().at(-1)!;
    assert.equal(g.label, "Repeat for ENG-151 · #14 ⇥");
    brain.fromShell({ type: "accept", ghostId: g.id });
    await new Promise((r) => setTimeout(r, 50));

    await brain.predictNow();
    g = ghosts().at(-1)!;
    assert.equal(g.label, "Do the remaining 3 ⇥");
    brain.fromShell({ type: "accept", ghostId: g.id });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(web.filter((m) => m.type === "exec").length, 6 * 5);

    // Per ticket: 3 clicks (search, result, save) + select = 4 clicks; keys = len(ENG-xxx) + len(#nn) = 7 + 3.
    assert.deepEqual(brain.hud.tabDid, { clicks: 4 * 5, keys: 10 * 5 });
    assert.equal(brain.hud.youDid, 3);
    assert.equal(brain.hud.modelCalls, 0);
    assert.equal(ROWS.length, 6);
});

test("pay ghost → pay → done; blocked ghost does nothing on accept", async () => {
    const { brain, web, ghosts } = harness();
    brain.fromShell({ type: "frontmost", app: CHROME, window: "Tickets" });
    const p: PaymentRequired = {
        type: "payment_required", paymentId: "p1", url: "http://tickets.localhost:4001/api/buy", method: "POST",
        payeeDomain: "tickets.localhost", payTo: "0xabc", amountUsd: "0.30", network: "eip155:84532", asset: "0xusdc",
        verdict: { ok: true, pagePriceUsd: "0.30" }, anchorRect: { x: 10, y: 10, w: 100, h: 30 },
    };
    brain.fromWeb(p);
    let g = ghosts().at(-1)!;
    assert.equal(g.kind, "pay");
    assert.equal(g.label, "Pay $0.30 · tickets.localhost ⇥");
    brain.fromShell({ type: "accept", ghostId: g.id });
    assert.deepEqual(web.at(-1), { type: "pay", paymentId: "p1" });
    brain.fromWeb({ type: "payment_result", paymentId: "p1", ok: true, txHash: "0x1", explorerUrl: "https://sepolia.basescan.org/tx/0x1" });
    g = ghosts().at(-1)!;
    assert.equal(g.kind, "done");
    assert.equal(g.label, "Paid $0.30 ✓");
    assert.equal(brain.hud.lastTx?.hash, "0x1");

    brain.fromWeb({ ...p, paymentId: "p2", payeeDomain: "resale.localhost", amountUsd: "0.51", verdict: { ok: false, reason: "page says $0.30, payment asks $0.51" } });
    g = ghosts().at(-1)!;
    assert.equal(g.kind, "blocked");
    assert.equal(g.label, "Blocked · page says $0.30, payment asks $0.51");
    const before = web.length;
    brain.fromShell({ type: "accept", ghostId: g.id });
    assert.equal(web.length, before, "accept on blocked sends nothing");
    brain.fromShell({ type: "dismiss", ghostId: g.id });
    assert.deepEqual(web.at(-1), { type: "dismiss_payment", paymentId: "p2" });

    brain.fromShell({ type: "hud_click", item: "ledger" });
    assert.deepEqual(web.at(-1), { type: "open_url", url: "https://sepolia.basescan.org/tx/0x1" });
});

test("model ghost: text kind for empty field; dismissed action is not re-shown", async () => {
    const { brain, ghosts } = harness(() => ({ op: "type", app: CHROME, url: TRACKER_URL, targetId: "pr", targetPath: PR.path, value: "#12", label: "Type #12", confidence: 0.9, source: "model" }));
    brain.fromShell({ type: "frontmost", app: CHROME, window: "Tracker" });
    brain.fromWeb(trackerState(Date.now()));
    await brain.predictNow();
    const g = ghosts().at(-1)!;
    assert.equal(g.kind, "text");
    assert.equal(g.ghostText, "#12");
    assert.equal(brain.hud.modelCalls, 1);
    brain.fromShell({ type: "dismiss", ghostId: g.id });
    const n = ghosts().length;
    await brain.predictNow();
    assert.equal(ghosts().length, n);
});
