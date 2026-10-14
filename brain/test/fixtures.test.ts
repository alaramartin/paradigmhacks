// The pattern rule on real captures from C's pages (protocol/fixtures), not synthetic stand-ins.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { El, ScreenState } from "../../protocol/types.ts";
import { toTarget, type HistEntry } from "../src/history.ts";
import { PatternEngine } from "../src/pattern.ts";

const fx = (name: string): ScreenState => JSON.parse(readFileSync(new URL(`../../protocol/fixtures/${name}.json`, import.meta.url), "utf8"));
const release = fx("web_state_github_release");
const tracker = fx("web_state_tracker_panel");
const el = (pred: (e: El) => boolean) => {
    const e = tracker.elements.find(pred);
    assert.ok(e, "element missing from fixture");
    return e!;
};

test("real fixtures: ticket 1 by hand → Repeat for ENG-150 · #13, then the batch reaches ENG-160 (#17)", () => {
    const now = Date.now();
    release.ts = now - 30_000;
    tracker.ts = now;
    const search = el((e) => e.path === "#search");
    const result = el((e) => e.role === "button" && e.label.startsWith("ENG-142"));
    const status = el((e) => e.label === "Status");
    const pr = el((e) => e.label === "Linked PR");
    const save = el((e) => e.label === "Save");
    assert.equal(save.list, undefined, "Save must not be a list item, or it won't end a unit");
    const h: HistEntry[] = [
        [search, "type", "ENG-142"],
        [result, "click"],
        [status, "type", "Done"],
        [pr, "type", "#12"],
        [save, "click"],
    ].map(([e, op, value], k) => ({ op: op as HistEntry["op"], app: tracker.app, url: tracker.url, target: toTarget(e as El), value: value as string | undefined, ts: now + k, by: "user" as const }));

    const eng = new PatternEngine();
    const a = eng.predict(h, [release, tracker], now + 10)!;
    assert.ok(a, "no pattern prediction on real fixtures");
    assert.equal(a.label, "Repeat for ENG-150 · #13");
    assert.equal(a.steps[1].match?.contains, "ENG-150");

    eng.onAccepted(a.sig);
    eng.onAccepted(a.sig);
    const b = eng.predict(h, [release, tracker], now + 20)!;
    assert.equal(b.label, "Do the remaining 5"); // from ENG-150 on, since history here only has ticket 1
    assert.deepEqual(b.steps.filter((s) => s.op === "type" && s.value?.startsWith("#")).map((s) => s.value), ["#13", "#14", "#15", "#16", "#17"]);
});
