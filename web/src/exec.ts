// Single-step execution in Chrome: click, type, key, navigate. Sequences are the hub's job.
import type { Action } from "../../protocol/types.ts";
import type { Chrome, Tab } from "./cdp.ts";

export class ExecError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolve the target element to a remote object id: targetPath first, then targetId. */
async function resolve(tab: Tab, a: Action): Promise<string> {
    const expr = `(() => {
        const path = ${JSON.stringify(a.targetPath ?? "")}, id = ${JSON.stringify(a.targetId ?? "")};
        let el = null;
        try { if (path) el = document.querySelector(path); } catch {}
        if (!el && id) el = document.querySelector('[data-tab-id="' + id.replace(/"/g, '') + '"]');
        return el;
    })()`;
    const { result } = await tab.client.Runtime.evaluate({ expression: expr });
    if (!result.objectId) throw new ExecError(`target not found (${a.targetPath ?? a.targetId ?? "no target"})`);
    return result.objectId;
}

async function call(tab: Tab, objectId: string, fn: string, args: unknown[] = []): Promise<any> {
    const { result, exceptionDetails } = await tab.client.Runtime.callFunctionOn({
        objectId,
        functionDeclaration: fn,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: true,
    });
    if (exceptionDetails) throw new ExecError(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
}

// Bring the element into view only if it isn't already (no needless scrolling), then report
// (a hidden tab drops synthetic mouse input, so it falls back to el.click())
// its viewport-center and whether a click there actually lands on it.
const PREPARE = `function () {
    const r0 = this.getBoundingClientRect();
    if (r0.top < 0 || r0.left < 0 || r0.bottom > innerHeight || r0.right > innerWidth) this.scrollIntoView({ block: "center", inline: "nearest" });
    const r = this.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hits: document.visibilityState === "visible" && !!hit && (hit === this || this.contains(hit) || (this.labels && [...this.labels].some(l => l.contains(hit)))) };
}`;

async function click(tab: Tab, a: Action): Promise<void> {
    const id = await resolve(tab, a);
    const p: { x: number; y: number; hits: boolean } = await call(tab, id, PREPARE);
    if (!p.hits) {
        await call(tab, id, "function () { this.focus && this.focus(); this.click(); }");
        return;
    }
    const I = tab.client.Input;
    await I.dispatchMouseEvent({ type: "mouseMoved", x: p.x, y: p.y });
    await I.dispatchMouseEvent({ type: "mousePressed", x: p.x, y: p.y, button: "left", buttons: 1, clickCount: 1 });
    await I.dispatchMouseEvent({ type: "mouseReleased", x: p.x, y: p.y, button: "left", buttons: 0, clickCount: 1 });
}

const SET_SELECT = `function (label) {
    const norm = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const want = norm(label);
    const opts = [...this.options];
    const o = opts.find((o) => norm(o.label || o.text) === want) || opts.find((o) => norm(o.value) === want) || opts.find((o) => norm(o.label || o.text).startsWith(want));
    if (!o) throw new Error("no option " + JSON.stringify(label) + " in " + JSON.stringify(opts.map((o) => o.label || o.text)));
    this.focus();
    this.value = o.value;
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
}`;

// Focus and select everything, so the typed text replaces the current value.
const FOCUS_SELECT_ALL = `function () {
    this.scrollIntoView({ block: "nearest" });
    this.focus();
    if (this.isContentEditable) {
        const r = document.createRange(); r.selectNodeContents(this);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    } else if (typeof this.select === "function") this.select();
    return this.tagName === "SELECT" ? "select" : (this.type === "checkbox" || this.type === "radio") ? "check" : "text";
}`;

async function type(tab: Tab, a: Action): Promise<void> {
    const id = await resolve(tab, a);
    const value = a.value ?? "";
    const kind: string = await call(tab, id, FOCUS_SELECT_ALL);
    if (kind === "select") return void (await call(tab, id, SET_SELECT, [value]));
    if (kind === "check") throw new ExecError("type on a checkbox; use click");
    if (value === "") await tab.client.Input.dispatchKeyEvent({ type: "keyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 }).then(() => tab.client.Input.dispatchKeyEvent({ type: "keyUp", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 }));
    else await tab.client.Input.insertText({ text: value });
}

const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
    Enter: { code: "Enter", vk: 13, text: "\r" },
    Tab: { code: "Tab", vk: 9 },
    Escape: { code: "Escape", vk: 27 },
    Backspace: { code: "Backspace", vk: 8 },
    Delete: { code: "Delete", vk: 46 },
    ArrowDown: { code: "ArrowDown", vk: 40 },
    ArrowUp: { code: "ArrowUp", vk: 38 },
    ArrowLeft: { code: "ArrowLeft", vk: 37 },
    ArrowRight: { code: "ArrowRight", vk: 39 },
    " ": { code: "Space", vk: 32, text: " " },
};

async function key(tab: Tab, a: Action): Promise<void> {
    const name = a.value === "Return" ? "Enter" : a.value === "Esc" ? "Escape" : a.value === "Space" ? " " : (a.value ?? "Enter");
    if (a.targetPath || a.targetId) await call(tab, await resolve(tab, a), "function () { this.focus(); }");
    const k = KEYS[name] ?? { code: name.length === 1 ? `Key${name.toUpperCase()}` : name, vk: name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0, text: name.length === 1 ? name : undefined };
    await tab.client.Input.dispatchKeyEvent({ type: k.text ? "keyDown" : "rawKeyDown", key: name, code: k.code, windowsVirtualKeyCode: k.vk, text: k.text });
    await tab.client.Input.dispatchKeyEvent({ type: "keyUp", key: name, code: k.code, windowsVirtualKeyCode: k.vk });
}

export async function execute(chrome: Chrome, a: Action): Promise<void> {
    if (a.op === "sequence") throw new ExecError("sequences run in the hub");
    if (a.op === "switch_app") throw new ExecError("switch_app runs in the shell");
    if (a.op === "navigate") {
        const url = a.value;
        if (!url) throw new ExecError("navigate without a url");
        const tab = chrome.pick(a.url) ?? (await chrome.openTab(url));
        if (!tab) throw new ExecError("no Chrome tab");
        chrome.echo(tab, 1500);
        if (tab.url !== url) await tab.client.Page.navigate({ url });
        await tab.client.Page.bringToFront().catch(() => {});
        return;
    }
    const tab = chrome.pick(a.url);
    if (!tab) throw new ExecError(`no tab for ${a.url ?? "focused window"}`);
    chrome.echo(tab, 5000);
    try {
        if (a.op === "click") {
            // Remember the clicked element, so a 402 it triggers is anchored to it.
            const el = tab.elements.find((e) => (a.targetPath && e.path === a.targetPath) || (a.targetId && e.id === a.targetId));
            if (el) tab.lastClick = { rect: el.rect, ts: Date.now() };
            await click(tab, a);
        }
        else if (a.op === "type") await type(tab, a);
        else if (a.op === "key") await key(tab, a);
        else throw new ExecError(`unknown op ${a.op}`);
        await sleep(30);
    } finally {
        tab.echoUntil = 0;
        chrome.echo(tab);
        chrome.refresh(tab);
    }
}
