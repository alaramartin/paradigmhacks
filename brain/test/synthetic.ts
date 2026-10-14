// Synthetic stand-ins for C's fixtures (web_state_github_release.json, web_state_tracker.json)
// until the real captures land in protocol/fixtures/.
import type { El, ScreenState } from "../../protocol/types.ts";
import type { HistEntry } from "../src/history.ts";
import { toTarget } from "../src/history.ts";

export const CHROME = "com.google.Chrome";
export const RELEASE_URL = "https://github.com/acme/shop/releases/tag/v1.4.0";
export const TRACKER_URL = "http://tracker.localhost:4003/";

export const ROWS: [string, string, string][] = [
    ["ENG-142", "Fix checkout rounding", "#12"],
    ["ENG-150", "Retry failed webhooks", "#13"],
    ["ENG-151", "Cache product images", "#14"],
    ["ENG-155", "Dark mode toggle", "#15"],
    ["ENG-157", "Faster search", "#16"],
    ["ENG-160", "Fix cart badge", "#17"],
];

const r = (y: number) => ({ x: 100, y, w: 200, h: 20 });
const TBODY = "div.markdown-body > table > tbody";

export function releaseState(ts: number): ScreenState {
    const elements: El[] = [];
    ROWS.forEach(([t, c, pr], i) => {
        const row = `${TBODY} > tr:nth-child(${i + 1})`;
        const list = (field: string) => ({ key: TBODY, index: i, field });
        elements.push({ id: `rt${i}`, role: "text", label: t, rect: r(200 + i * 30), enabled: true, path: `${row} > td:nth-child(1)`, list: list("td:nth-child(1)") });
        elements.push({ id: `rc${i}`, role: "text", label: c, rect: r(200 + i * 30), enabled: true, path: `${row} > td:nth-child(2)`, list: list("td:nth-child(2)") });
        elements.push({ id: `rp${i}`, role: "link", label: pr, rect: r(200 + i * 30), enabled: true, path: `${row} > td:nth-child(3) > a`, list: list("td:nth-child(3) > a") });
    });
    return { type: "state", source: "web", app: CHROME, window: "Release v1.4.0", url: RELEASE_URL, focused: false, elements, seq: 1, ts };
}

export const SEARCH: El = { id: "s", role: "textfield", label: "Search tickets", value: "", rect: r(50), enabled: true, path: "#search" };
export const STATUS: El = { id: "st", role: "select", label: "Status", options: ["Backlog", "In review", "Done"], rect: r(400), enabled: true, path: "#panel select[name=status]" };
export const PR: El = { id: "pr", role: "textfield", label: "Linked PR", rect: r(440), enabled: true, path: "#panel input[name=pr]" };
export const SAVE: El = { id: "save", role: "button", label: "Save", rect: r(480), enabled: true, path: "#panel button.save" };

export function resultEl(i: number): El {
    // Filtering hides items, so a result's path depends on what's visible; the label is what's stable.
    return { id: `t${i}`, role: "button", label: `${ROWS[i][0]} ${ROWS[i][1]}`, rect: r(100 + i * 30), enabled: true, path: `ul.tickets > li:nth-child(${i + 1}) > button`, list: { key: "ul.tickets", index: i, field: "button" } };
}

export function trackerState(ts: number): ScreenState {
    return { type: "state", source: "web", app: CHROME, window: "Tracker", url: TRACKER_URL, focused: true, elements: [SEARCH, ...ROWS.map((_, i) => resultEl(i)), STATUS, PR, SAVE], seq: 1, ts };
}

/** The user does ticket i by hand. */
export function ticketByHand(i: number, t0: number): HistEntry[] {
    const e = (op: HistEntry["op"], el: El, value: string | undefined, dt: number): HistEntry => ({ op, app: CHROME, url: TRACKER_URL, target: toTarget(el), value, ts: t0 + dt, by: "user" });
    return [
        e("click", SEARCH, undefined, 0),
        e("type", SEARCH, ROWS[i][0], 1000),
        e("click", resultEl(i), undefined, 2000),
        e("type", STATUS, "Done", 3000),
        e("type", PR, ROWS[i][2], 4000),
        e("click", SAVE, undefined, 5000),
    ];
}
