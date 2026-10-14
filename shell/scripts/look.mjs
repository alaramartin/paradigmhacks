#!/usr/bin/env node
// Look at a ghost on a real page without Screen Recording: open the page in its own window of the debug Chrome, read
// real element rects (protocol/fixtures/capture/capture.mjs), screenshot the viewport over CDP, then draw the ghosts
// with TabShell's own AppKit code (`TabShell --render --ghosts`). The result is what the overlay draws over that page.
// It never navigates or resizes your existing tabs (C's demo tabs stay as they are), and closes its window afterwards.
//
//   node shell/scripts/look.mjs [--window WxH] <url> <out.png> '<ghosts json>'
//   ghosts: [{"kind":"action","label":"Click Checkout ⇥","target":"Checkout","place":"inside","hc":false,"ghostText":"…"}]
//   target = case-insensitive substring of an element label in the captured state (first interactive match wins).
//   --window WxH  the window size (default 720x875, a half-screen window on a 1440×900 display, as in the demo).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const wi = argv.indexOf("--window");
const [winW, winH] = (wi >= 0 ? argv.splice(wi, 2)[1] : "720x875").split("x").map(Number);
const [url, out, spec] = argv;
if (!url || !out || !spec) {
    console.error("usage: look.mjs [--window WxH] <url> <out.png> '<ghosts json>'");
    process.exit(2);
}
const port = process.env.CDP_PORT ?? "9222";
const tmp = mkdtempSync(join(tmpdir(), "tab-look-"));

// One CDP call over a fresh websocket.
async function cdp(wsUrl, method, params = {}) {
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));
    const res = await new Promise((resolve, reject) => {
        ws.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if (m.id === 1) m.error ? reject(new Error(m.error.message)) : resolve(m.result);
        };
        ws.send(JSON.stringify({ id: 1, method, params }));
    });
    ws.close();
    return res;
}

const browser = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
const { targetId } = await cdp(browser, "Target.createTarget", { url: "about:blank", newWindow: true });
try {
    const { windowId } = await cdp(browser, "Browser.getWindowForTarget", { targetId });
    await cdp(browser, "Browser.setWindowBounds", { windowId, bounds: { left: 0, top: 25, width: winW, height: winH } });

    // Load and capture the state with real screen rects.
    const statePath = join(tmp, "state.json");
    execFileSync("node", [join(root, "protocol/fixtures/capture/capture.mjs"), "-", statePath, "--target", targetId, "--navigate", url, "--focused"], { stdio: "inherit" });
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const cap = state._capture;

    // Screenshot the viewport of the same tab.
    const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.id === targetId);
    const shot = (await cdp(page.webSocketDebuggerUrl, "Page.captureScreenshot", { format: "png" }))?.data;
    if (!shot) throw new Error("screenshot failed");
    const bg = join(tmp, "bg.png");
    writeFileSync(bg, Buffer.from(shot, "base64"));

    // Map each ghost's target to viewport points (the screenshot's coordinate space).
    const toView = (r) => ({ x: r.x - cap.screenX, y: r.y - cap.screenY - cap.toolbar, w: r.w, h: r.h });
    const items = JSON.parse(spec).map((g, i) => {
        const want = (g.target ?? "").toLowerCase();
        const el = state.elements.find((e) => e.role !== "text" && e.label.toLowerCase().includes(want)) ??
            state.elements.find((e) => e.label.toLowerCase().includes(want));
        if (g.target && !el) throw new Error(`no element whose label contains "${g.target}"`);
        const ghost = { id: `look${i}`, kind: g.kind ?? "action", label: g.label };
        if (el) {
            ghost.rect = toView(el.rect);
            if ((g.kind ?? "action") === "action") ghost.cursor = { x: ghost.rect.x + ghost.rect.w / 2, y: ghost.rect.y + ghost.rect.h / 2 };
        }
        for (const k of ["ghostText", "place", "pillAt", "ttlMs"]) if (g[k] !== undefined) ghost[k] = g[k];
        return { ghost, hc: !!g.hc, hold: g.hold };
    });
    const ghosts = join(tmp, "ghosts.json");
    writeFileSync(ghosts, JSON.stringify(items));

    const bin = join(root, "shell/.build/release/TabShell");
    execFileSync(bin, ["--render", resolve(out), "--bg", bg, "--size", `${cap.innerWidth}x${cap.innerHeight}`, "--ghosts", ghosts], { stdio: "inherit" });
} finally {
    await cdp(browser, "Target.closeTarget", { targetId }).catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
}
