import assert from "node:assert/strict";
import { test } from "node:test";
import type { El, ScreenState } from "../../protocol/types.ts";
import { candidates, prDescription } from "../src/candidates.ts";

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
