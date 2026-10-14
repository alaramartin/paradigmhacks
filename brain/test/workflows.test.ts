// Remembered workflows: save a learned repeat unit, offer it again (after a restart) by context.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { El, ScreenState } from "../../protocol/types.ts";
import { toTarget, type HistEntry } from "../src/history.ts";
import { PatternEngine, type Workflow } from "../src/pattern.ts";

const fx = (name: string): ScreenState => JSON.parse(readFileSync(new URL(`../../protocol/fixtures/${name}.json`, import.meta.url), "utf8"));
const now = Date.now();
const release = { ...fx("web_state_github_release"), ts: now - 30_000 };
const panel = { ...fx("web_state_tracker_panel"), ts: now };
const tracker = { ...fx("web_state_tracker"), ts: now };
const el = (s: ScreenState, pred: (e: El) => boolean) => s.elements.find(pred)!;

function teach(file: string): PatternEngine {
    const eng = new PatternEngine({ file });
    const h: HistEntry[] = [
        [el(panel, (e) => e.path === "#search"), "type", "ENG-142"],
        [el(panel, (e) => e.role === "button" && e.label.startsWith("ENG-142")), "click"],
        [el(panel, (e) => e.label === "Status"), "type", "Done"],
        [el(panel, (e) => e.label === "Linked PR"), "type", "#12"],
        [el(panel, (e) => e.label === "Save"), "click"],
    ].map(([e, op, value], k) => ({ op: op as HistEntry["op"], app: panel.app, url: panel.url, target: toTarget(e as El), value: value as string | undefined, ts: now + k, by: "user" as const }));
    assert.equal(eng.predict(h, [release, panel], now + 10)?.label, "Repeat for ENG-150 · #13");
    return eng;
}
const tmpFile = () => join(mkdtempSync(join(tmpdir(), "tab-wf-")), "workflows.json");

test("a learned unit is saved and round-trips through JSON", () => {
    const file = tmpFile();
    teach(file);
    const saved = JSON.parse(readFileSync(file, "utf8")) as Workflow[];
    assert.equal(saved.length, 1);
    const w = saved[0];
    assert.equal(w.url, panel.url);
    assert.equal(w.srcHost, "github.com");
    assert.ok(w.template.some((t) => t.prov) && w.template.some((t) => t.contains), "prov and contains steps kept");
    const again = new PatternEngine({ file });
    assert.deepEqual(again.workflows.all(), saved);
});

test("recall after a restart: empty history, tracker + release open → one sequence for all 6 rows", () => {
    const file = tmpFile();
    const taught = teach(file);
    const sig = taught.workflows.all()[0].sig;
    taught.onAccepted(sig);
    const fresh = new PatternEngine({ file }); // the hub restarted
    const a = fresh.recall(tracker, [release, tracker], now, [])!;
    assert.ok(a, "recall offered");
    assert.match(a.label, /^Do all 6 from v1\.4\.0 · learned \d{1,2}:\d{2} (am|pm)$/);
    assert.equal(a.source, "pattern");
    assert.equal(a.confidence, 0.9);
    assert.equal(a.sig, sig);
    const prs = a.steps.filter((s) => s.op === "type" && s.value?.startsWith("#")).map((s) => s.value);
    assert.deepEqual(prs, ["#12", "#13", "#14", "#15", "#16", "#17"]);
    assert.equal(a.steps.filter((s) => s.match).map((s) => s.match!.contains).join(","), "ENG-142,ENG-150,ENG-151,ENG-155,ENG-157,ENG-160");
    assert.equal(fresh.workflows.get(sig)!.accepted, 1, "accept count persisted");
});

test("recall stays quiet: wrong page, no matching list, unit in progress, after forget", () => {
    const file = tmpFile();
    teach(file);
    const eng = new PatternEngine({ file });
    const inbox = { ...fx("web_state_inbox"), ts: now };
    assert.equal(eng.recall(inbox, [release, inbox], now, []), null, "wrong page");
    assert.equal(eng.recall(tracker, [tracker, inbox], now, []), null, "no source list open");
    const typing: HistEntry = { op: "type", app: tracker.app, url: tracker.url, target: { id: "s", role: "textfield", label: "Search" }, value: "ENG", ts: now, by: "user" };
    assert.equal(eng.recall(tracker, [release, tracker], now, [typing]), null, "unit in progress");
    const arrived: HistEntry = { op: "navigate", app: tracker.app, url: "http://inbox.localhost:4004/", value: tracker.url, ts: now + 1, by: "user" };
    assert.ok(eng.recall(tracker, [release, tracker], now, [typing, arrived]), "fresh visit after navigating back");
    eng.forgetWorkflows();
    assert.equal(new PatternEngine({ file }).recall(tracker, [release, tracker], now, []), null, "forgotten");
});
