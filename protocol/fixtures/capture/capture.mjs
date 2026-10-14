#!/usr/bin/env node
// Capture a real page in the debug Chrome as a protocol `ScreenState` fixture (web), following PLAN.md's
// perception rules: visible interactive elements first, then visible text, ≤ 200; labels; screen-point rects;
// CSS paths; select options; checked; and `list` metadata for repeated structures (ul/ol > li, tbody > tr, …).
//
// Standalone and dependency-free (Node 22+ global WebSocket). Read-only on the page (only --navigate/--scroll move it).
// It is a fixture tool for B and a reference for C, not C's perception code.
//
//   node protocol/fixtures/capture/capture.mjs --list                       list open tabs
//   node protocol/fixtures/capture/capture.mjs <url-substring> [out.json]   capture the matching tab
//   flags: --port 9222, --focused (force focused: true), --navigate <url> (load first, wait for idle; with no
//          matching tab it opens a new tab rather than taking over one of yours), --target <id> (that exact tab),
//          --scroll <css selector> (scroll that element to the top of the viewport first)
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const port = flag("--port") ?? process.env.CDP_PORT ?? "9222";
const navigate = flag("--navigate");
const scrollTo = flag("--scroll");
const targetId = flag("--target");
const forceFocused = args.includes("--focused") && args.splice(args.indexOf("--focused"), 1);
const listOnly = args.includes("--list");
const [match, out] = args.filter((a) => !a.startsWith("--"));

const tabs = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === "page");
if (listOnly || !match) {
    for (const t of tabs) console.log(`${t.id}  ${t.url}  ${t.title}`);
    if (!match) process.exit(listOnly ? 0 : 1);
}
let tab = targetId ? tabs.find((t) => t.id === targetId) : tabs.find((t) => t.url.includes(match));
if (!tab && navigate && !targetId) tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
if (!tab) {
    console.error(`no tab whose url contains "${match}"`);
    process.exit(1);
}

const ws = new WebSocket(tab.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method) events.push(m);
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
    new Promise((res, rej) => {
        const id = ++nextId;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
    });

if (navigate) {
    await send("Page.enable");
    await send("Page.navigate", { url: navigate });
    const t0 = Date.now();
    while (!events.some((e) => e.method === "Page.loadEventFired") && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 800)); // late layout (fonts, lazy markdown tables)
}

if (scrollTo) {
    await send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(scrollTo)})?.scrollIntoView({block: "start", behavior: "instant"})` });
    await new Promise((r) => setTimeout(r, 400));
}

// Runs in the page. Keep it self-contained.
function collect() {
    const MAX = 200;
    const INLINE = new Set(["A", "SPAN", "CODE", "STRONG", "EM", "B", "I", "SMALL", "KBD", "IMG", "SVG", "LABEL"]);
    const ITEM_PARENT = new Set(["UL", "OL", "TBODY", "DL"]);
    const okId = (id) => /^[A-Za-z][\w-]*$/.test(id) && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1;

    const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0;
    };
    const top = outerHeight - innerHeight; // toolbar height; assumes 100% zoom and no bottom chrome
    const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(screenX + r.left), y: Math.round(screenY + top + r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const seg = (el) => {
        const tag = el.tagName.toLowerCase();
        if (el.id && okId(el.id)) return `${tag}#${CSS.escape(el.id)}`;
        const p = el.parentElement;
        if (!p) return tag;
        const same = [...p.children].filter((c) => c.tagName === el.tagName);
        return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(el) + 1})` : tag;
    };
    // Absolute path stops at the nearest unique id; relative path stops at `stop`.
    const path = (el, stop) => {
        const parts = [];
        for (let e = el; e && e.nodeType === 1 && e !== stop; e = e.parentElement) {
            parts.unshift(seg(e));
            if (!stop && ((e.id && okId(e.id)) || e === document.body)) break;
        }
        return parts.join(" > ");
    };
    const sig = (el) => `${el.tagName}.${[...el.classList].sort().join(".")}`;
    const isItem = (el) => {
        const p = el.parentElement;
        if (!p || INLINE.has(el.tagName) || el.tagName === "TD" || el.tagName === "TH") return false;
        const role = el.getAttribute("role");
        const itemish = ["LI", "TR", "DT", "DD"].includes(el.tagName) || ["listitem", "row", "option"].includes(role) ||
            ITEM_PARENT.has(p.tagName) || ["list", "listbox", "grid", "table", "rowgroup"].includes(p.getAttribute("role"));
        if (!itemish) return false;
        return [...p.children].filter((c) => sig(c) === sig(el)).length >= 2;
    };
    const listOf = (el) => {
        for (let a = el; a && a !== document.body; a = a.parentElement) {
            if (!isItem(a)) continue;
            const p = a.parentElement;
            const sibs = [...p.children].filter((c) => sig(c) === sig(a));
            const l = { key: path(p), index: sibs.indexOf(a) };
            if (a !== el) l.field = path(el, a);
            return l;
        }
        return undefined;
    };
    const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const role = (el) => {
        const t = el.tagName;
        const type = (el.getAttribute("type") || "").toLowerCase();
        const r = el.getAttribute("role");
        if (t === "SELECT") return "select";
        if (t === "TEXTAREA") return "textarea";
        if (t === "INPUT") {
            if (type === "checkbox" || type === "radio") return "checkbox";
            if (["submit", "button", "reset", "image"].includes(type)) return "button";
            return "textfield";
        }
        if (r === "checkbox" || r === "switch") return "checkbox";
        if (t === "BUTTON" || r === "button" || t === "SUMMARY") return "button";
        if (t === "A" || r === "link") return "link";
        if (el.isContentEditable) return "textarea";
        return "text";
    };
    const label = (el) =>
        clean(el.getAttribute("aria-label")) || clean(el.labels?.[0]?.innerText) || clean(el.innerText) || clean(el.getAttribute("placeholder")) ||
        clean(el.getAttribute("name")) || clean(el.getAttribute("title")) || clean(el.value);

    const out = [];
    const seen = new Set();
    let n = 0;
    const add = (el, r) => {
        if (out.length >= MAX || seen.has(el)) return;
        seen.add(el);
        const e = { id: `t${++n}`, role: r, label: label(el), rect: rect(el), enabled: !el.disabled && el.getAttribute("aria-disabled") !== "true", path: path(el) };
        const br = el.getBoundingClientRect(), cr = getComputedStyle(el).borderTopLeftRadius; // same as web/src/inject.js radiusOf
        const px = cr.endsWith("%") ? (parseFloat(cr) / 100) * Math.min(br.width, br.height) : parseFloat(cr) || 0;
        const rad = Math.round(Math.min(px, br.width / 2, br.height / 2) * 10) / 10;
        e.radius = rad; // 0 too: square, not "unknown"
        if (r === "textfield" || r === "textarea") e.value = el.isContentEditable ? clean(el.innerText) : el.value ?? "";
        if (r === "select") {
            e.options = [...el.options].map((o) => clean(o.label || o.text));
            e.value = clean(el.selectedOptions[0]?.label ?? "");
        }
        if (r === "checkbox") e.checked = el.checked ?? el.getAttribute("aria-checked") === "true";
        if (r === "button" && el.hasAttribute("aria-pressed")) e.checked = el.getAttribute("aria-pressed") === "true";
        const l = listOf(el);
        if (l) e.list = l;
        out.push(e);
    };

    const interactive = "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=switch], summary, [contenteditable=true]";
    for (const el of document.querySelectorAll(interactive)) if (visible(el)) add(el, role(el));

    // Visible text in main content: elements with their own (direct) text, not inside something already taken.
    const main = document.querySelector("main, [role=main]") ?? document.body;
    const inTaken = (el) => { for (let a = el; a; a = a.parentElement) if (seen.has(a)) return true; return false; };
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el && out.length < MAX; el = walker.nextNode()) {
        if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "TEMPLATE"].includes(el.tagName)) continue;
        const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        if (own && visible(el) && !inTaken(el)) add(el, "text");
    }

    return {
        type: "state",
        source: "web",
        app: "com.google.Chrome",
        window: document.title,
        url: location.href,
        focused: document.hasFocus(),
        elements: out,
        seq: 1,
        ts: Date.now(),
        _capture: { screenX, screenY, outerHeight, innerHeight, innerWidth, devicePixelRatio, toolbar: top },
    };
}

const r = await send("Runtime.evaluate", { expression: `(${collect.toString()})()`, returnByValue: true });
if (r.exceptionDetails) {
    console.error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    process.exit(1);
}
const state = r.result.value;
if (forceFocused) state.focused = true;
const json = JSON.stringify(state, null, 2);
if (out) {
    writeFileSync(out, json + "\n");
    const lists = new Map();
    for (const e of state.elements) if (e.list) lists.set(e.list.key, (lists.get(e.list.key) ?? 0) + 1);
    console.log(`wrote ${out}: ${state.elements.length} elements, ${lists.size} lists (${[...lists.values()].join(", ")} members), ${state.url}`);
} else {
    console.log(json);
}
ws.close();
