import assert from "node:assert/strict";
import { test } from "node:test";
import type { El, ScreenState } from "../../protocol/types.ts";
import { candidates, mentionedOptions, otherPagesText, prDescription } from "../src/candidates.ts";

const r = { x: 0, y: 0, w: 1, h: 1 };
const C = "com.google.Chrome";
const st = (url: string, elements: El[], source: "web" | "native" = "web", app = C): ScreenState => ({ type: "state", source, app, window: "w", url, focused: true, elements, seq: 1, ts: 0 });

test("terminal: newest URL first, PR link labelled 'Open pull request'", () => {
    const term = st("", [{ id: "term", role: "textarea", label: "Terminal", rect: r, enabled: true, value: "remote:      https://github.com/a/b/pull/new/fix/x\nTo https://github.com/a/b.git" }], "native", "com.apple.Terminal");
    const cs = candidates(term, [], []);
    assert.equal(cs.length, 2);
    const pr = cs.find((c) => c.action.label === "Open pull request")!;
    assert.equal(pr.action.op, "navigate");
    assert.equal(pr.action.app, C);
    assert.equal(pr.action.value, "https://github.com/a/b/pull/new/fix/x");
});

test("empty field gets values copied from other pages; select prefers mentioned options", () => {
    const inbox = st("http://inbox.localhost:4004/", [{ id: "m", role: "text", label: "Rx 4471-209 is ready at Oak St.", rect: r, enabled: true }]);
    const form = st("http://pharmacy.localhost:4005/refill", [
        { id: "rx", role: "textfield", label: "Rx number", value: "", rect: r, enabled: true },
        { id: "loc", role: "select", label: "Pickup location", value: "Main St", options: ["Main St", "Oak St", "Elm Ave"], rect: r, enabled: true },
    ]);
    const cs = candidates(form, [form, inbox], []);
    assert.deepEqual(cs.map((c) => c.action.label), ["Type 4471-209", "Select Oak St"]);
});

test("PR description from commit titles, hashes skipped", () => {
    const page = st("https://github.com/a/b/compare/main...fix/x?expand=1", [
        { id: "1", role: "link", label: "Round checkout totals to cents", rect: r, enabled: true, path: "ol.commits a.commit-message", list: { key: "ol.commits", index: 0 } },
        { id: "2", role: "link", label: "a1b2c3d", rect: r, enabled: true, path: "ol.commits a.sha", list: { key: "ol.commits", index: 0 } },
        { id: "3", role: "link", label: "Add rounding test", rect: r, enabled: true, path: "ol.commits a.commit-message", list: { key: "ol.commits", index: 1 } },
    ]);
    assert.equal(prDescription(page), "Round checkout totals to cents, and 1 more change.\n\n## Changes\n- Round checkout totals to cents\n- Add rounding test");
    assert.equal(prDescription({ ...page, url: "http://tickets.localhost:4001/" }), null);
});

test("a select isn't 'mentioned' by stray digits on other pages", () => {
    const other = st("http://x/", [{ id: "t", role: "text", label: "1 × General admission · Total $0.15", rect: r, enabled: true }]);
    const page = st("http://tickets.localhost:4001/e/night-owls", [
        { id: "q", role: "select", label: "Qty", value: "2", options: ["1", "2", "3", "4"], rect: r, enabled: true },
        { id: "loc", role: "select", label: "Pickup", value: "Main St", options: ["Main St", "Oak St"], rect: r, enabled: true },
    ]);
    assert.deepEqual(mentionedOptions(page.elements[0], otherPagesText(page, [other])), []);
    const inbox = st("http://inbox/", [{ id: "m", role: "text", label: "Ready at Oak St. today", rect: r, enabled: true }]);
    assert.deepEqual(mentionedOptions(page.elements[1], otherPagesText(page, [inbox])), ["Oak St"]);
});

test("A's real Terminal capture (protocol/fixtures/native_state_terminal_push.json) → one Open pull request candidate", async () => {
    const { readFileSync } = await import("node:fs");
    const s = JSON.parse(readFileSync(new URL("../../protocol/fixtures/native_state_terminal_push.json", import.meta.url), "utf8"));
    const cs = candidates(s, [s], []);
    assert.equal(cs.length, 1);
    assert.equal(cs[0].action.label, "Open pull request");
    assert.match(cs[0].action.value!, /\/pull\/new\/fix\/checkout-rounding$/);
});

test("PR description on A's real GitHub compare capture: titles rejoined, no authors or hashes", async () => {
    const { readFileSync } = await import("node:fs");
    const s = JSON.parse(readFileSync(new URL("../../protocol/fixtures/reference/real_github_compare_commits_uv.json", import.meta.url), "utf8"));
    const d = prDescription({ ...s, url: "https://github.com/astral-sh/uv/compare/0.13.0...0.13.1?expand=1" })!;
    const lines = d.split("\n").filter((l) => l.startsWith("- "));
    assert.equal(lines[0], "- Document native Python preference on Windows ARM64 (#22424)");
    assert.equal(lines.length, 6);
    assert.ok(!/zanieb|\[bot\]|0e23f06/.test(d), d);
});

test("askedFor: a checkbox the other page asks for", async () => {
    const { askedFor } = await import("../src/model.ts");
    assert.equal(askedFor("Text me when ready", "want a heads-up? ask us to text you when it's ready."), true);
    assert.equal(askedFor("Text me when ready", "rx 4471-209 is ready to refill at oak st."), false);
    assert.equal(askedFor("Subscribe to newsletter", "rx 4471-209 is ready"), false);
});
