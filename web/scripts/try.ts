// Headless rehearsal of the web flows against the real hub, web process and demo sites.
// Plays the user (real CDP mouse/keys in Chrome) and plays the shell toward the hub (frontmost, accept,
// dismiss), then checks every ghost and every outcome. Screenshots go to design/shots/try-*.png.
//   npm run try -- [flow1|flow3|flow4|all]
// Needs: npm run demo, the hub (brain: npm start), npm start (this package), Chrome on :9222.
import CDP from "chrome-remote-interface";
import WebSocket from "ws";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Ghost } from "../../protocol/types.ts";
const env = { cdpPort: Number(process.env.CDP_PORT ?? 9222), hubUrl: `ws://127.0.0.1:${process.env.HUB_PORT ?? 7800}` };
// Node cannot resolve *.localhost everywhere; talk to 127.0.0.1 with the right Host instead.
const localFetch = (url: string, init?: RequestInit) => { const u = new URL(url); const host = u.host; u.hostname = "127.0.0.1"; return fetch(u, { ...init, headers: { ...(init?.headers as object), host } }); };

const which = process.argv[2] ?? "all";
const shots = fileURLToPath(new URL("../../design/shots/", import.meta.url));
mkdirSync(shots, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond: boolean, what: string) => {
    console.log(`  ${cond ? "✓" : "✗"} ${what}`);
    if (!cond) failures++;
    return cond;
};

// ---------- hub, as the shell ----------
const ghosts: Ghost[] = [];
const hub = new WebSocket(env.hubUrl);
await new Promise<void>((res, rej) => (hub.once("open", () => res()), hub.once("error", rej)));
hub.send(JSON.stringify({ type: "hello", role: "tool" }));
hub.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.to === "shell" && m.msg.type === "ghost") ghosts.push(m.msg.ghost);
    if (m.to === "shell" && m.msg.type === "ghost_hide") ghosts.push({ id: "", kind: "done", label: "(hidden)" });
});
const asShell = (m: object) => hub.send(JSON.stringify({ as: "shell", ...m }));
const frontmost = () => asShell({ type: "frontmost", app: "com.google.Chrome", window: "Chrome" });

async function waitGhost(pred: (g: Ghost) => boolean, ms = 4000): Promise<Ghost | null> {
    const t0 = Date.now();
    const from = ghosts.length;
    for (;;) {
        // The newest visible ghost counts, including one already showing.
        const live = [...ghosts].reverse().find((g) => g.id);
        const lastIsHide = ghosts.length && !ghosts[ghosts.length - 1].id;
        if (live && !lastIsHide && pred(live)) return live;
        for (const g of ghosts.slice(from)) if (g.id && pred(g)) return g;
        if (Date.now() - t0 > ms) return null;
        await sleep(50);
    }
}
async function accept(pred: (g: Ghost) => boolean, what: string, ms?: number): Promise<Ghost | null> {
    const t0 = Date.now();
    const g = await waitGhost(pred, ms);
    if (!ok(!!g, `ghost: ${what}${g ? ` (${Date.now() - t0} ms)` : ` — last: ${ghosts.filter((x) => x.id).at(-1)?.label ?? "none"}`}`)) return null;
    asShell({ type: "accept", ghostId: g!.id });
    return g;
}

// ---------- Chrome, as the user ----------
async function tabFor(url: string): Promise<CDP.Client> {
    const host = new URL(url).host;
    let t = (await CDP.List({ port: env.cdpPort })).find((x) => x.type === "page" && x.url.includes(host));
    if (!t) t = await CDP.New({ port: env.cdpPort, url });
    const c = await CDP({ port: env.cdpPort, target: t.id });
    await c.Page.enable();
    await c.Page.bringToFront();
    await c.Emulation.setDeviceMetricsOverride({ width: 960, height: 1000, deviceScaleFactor: 1, mobile: false });
    const loaded = c.Page.loadEventFired();
    await c.Page.navigate({ url });
    await loaded;
    await sleep(800);
    return c;
}
async function evalIn(c: CDP.Client, expr: string): Promise<any> {
    const { result, exceptionDetails } = await c.Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
}
async function click(c: CDP.Client, css: string) {
    const p = await evalIn(c, `(() => { const el = document.querySelector(${JSON.stringify(css)}); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const)
        await c.Input.dispatchMouseEvent({ type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
    await sleep(250);
}
async function typeInto(c: CDP.Client, css: string, text: string) {
    await click(c, css);
    await c.Input.insertText({ text });
    await evalIn(c, "document.activeElement.blur()");
    await sleep(250);
}
async function choose(c: CDP.Client, css: string, label: string) {
    await evalIn(c, `(() => { const s = document.querySelector(${JSON.stringify(css)}); s.focus(); s.value = [...s.options].find(o => o.label.trim() === ${JSON.stringify(label)}).value; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); s.blur(); })()`);
    await sleep(250);
}
async function shot(c: CDP.Client, name: string) {
    const { data } = await c.Page.captureScreenshot({ format: "png" });
    writeFileSync(shots + `try-${name}.png`, Buffer.from(data, "base64"));
}
async function until(c: CDP.Client, expr: string, ms = 8000): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        if (await evalIn(c, expr).catch(() => false)) return true;
        await sleep(100);
    }
    return false;
}

// ---------- flows ----------
async function flow1() {
    console.log("Flow 1: tickets, then resale");
    const c = await tabFor("http://tickets.localhost:4001/e/night-owls");
    frontmost();
    await choose(c, "#qty", "2");
    if (await accept((g) => g.label.startsWith("Click Checkout"), "Click Checkout ⇥", 6000)) ok(await until(c, `location.pathname === "/checkout"`), "checkout page opened");
    else await click(c, "#checkout");
    await until(c, `location.pathname === "/checkout"`);
    await sleep(600);
    if (!(await accept((g) => g.label.startsWith("Click Buy tickets"), "Click Buy tickets ⇥", 6000))) await click(c, "#buy");
    const pay = await accept((g) => g.kind === "pay", "Pay $0.30 · tickets.localhost ⇥");
    if (pay) ok(pay.label === "Pay $0.30 · tickets.localhost ⇥", `pay label exact: "${pay.label}"`);
    const after = await waitGhost((g) => g.kind === "done" || g.kind === "blocked", 20000);
    ok(after?.kind === "done", `after paying: ${after?.label ?? "nothing"}`);
    if (after?.kind === "done") ok(await until(c, `document.querySelectorAll(".ticket").length === 2`), "two ticket cards rendered");
    await shot(c, "flow1-tickets");
    await c.close();

    const r = await tabFor("http://resale.localhost:4002/checkout?qty=2");
    frontmost();
    await sleep(400);
    await click(r, "#buy");
    const b = await waitGhost((g) => g.kind === "blocked", 6000);
    ok(b?.label === "Blocked · page says $0.30, payment asks $0.51", `resale: ${b?.label ?? "no blocked ghost"}`);
    if (b) {
        asShell({ type: "accept", ghostId: b.id });
        await sleep(500);
        ok(await evalIn(r, `document.querySelectorAll(".ticket").length === 0`), "Tab on blocked does nothing");
        asShell({ type: "dismiss", ghostId: b.id });
        ok(await until(r, `/Payment required/.test(document.getElementById("status").textContent)`), "Esc lets the 402 through to the page");
    }
    await shot(r, "flow1-resale");
    await r.close();
}

async function flow3() {
    console.log("Flow 3: release notes → tracker, teach once then repeat");
    await localFetch("http://tracker.localhost:4003/api/reset", { method: "POST" });
    const rel = await tabFor(process.env.RELEASE_URL ?? "https://github.com/alaramartin/tab-demo/releases/tag/v1.4.0");
    await sleep(1500);
    await rel.close();
    const c = await tabFor("http://tracker.localhost:4003/");
    frontmost();
    await typeInto(c, "#search", "ENG-142");
    await click(c, "#list li:nth-child(1) button");
    await choose(c, "#p-status", "Done");
    await typeInto(c, "#p-pr", "#12");
    await click(c, "#save");
    const done = (id: string, pr: string) => until(c, `fetch("/api/tickets").then(r => r.json()).then(ts => ts.find(t => t.id === "${id}")?.status === "Done" && ts.find(t => t.id === "${id}")?.pr === "${pr}")`, 10000);
    if (await accept((g) => g.label.startsWith("Repeat for ENG-150"), "Repeat for ENG-150 · #13 ⇥")) ok(await done("ENG-150", "#13"), "ENG-150 Done #13");
    if (await accept((g) => g.label.startsWith("Repeat for ENG-151"), "Repeat for ENG-151 · #14 ⇥", 6000)) ok(await done("ENG-151", "#14"), "ENG-151 Done #14");
    if (await accept((g) => g.label.startsWith("Do the remaining"), "Do the remaining 3 ⇥", 6000)) {
        ok(await done("ENG-160", "#17"), "ENG-160 Done #17");
        ok(await until(c, `fetch("/api/tickets").then(r => r.json()).then(ts => ts.every(t => t.status === "Done"))`), "all six Done");
    }
    await evalIn(c, `(() => { const s = document.getElementById("search"); s.value = ""; s.dispatchEvent(new Event("input")); })()`);
    await sleep(300);
    await shot(c, "flow3-tracker");
    await c.close();
}

async function flow4() {
    console.log("Flow 4: inbox → pharmacy, one button");
    const inbox = await tabFor("http://inbox.localhost:4004/");
    await inbox.close();
    const c = await tabFor("http://pharmacy.localhost:4005/refill");
    frontmost();
    const steps: [string, string, string][] = [
        ["4471-209", "Rx 4471-209", `document.getElementById("rx").value === "4471-209"`],
        ["Oak St", "Select Oak St", `document.getElementById("loc").value === "Oak St"`],
        ["5:30", "Click 5:30 pm", `document.querySelectorAll(".chips button")[1].getAttribute("aria-pressed") === "true"`],
        ["Text me", "Check \"Text me when ready\"", `document.getElementById("sms").checked`],
        ["Request refill", "Click Request refill", `false`],
    ];
    for (const [needle, what, check] of steps) {
        const g = await accept((g) => (g.label + " " + (g.ghostText ?? "")).includes(needle), what, 6000);
        if (!g) break;
        if (check !== "false") ok(await until(c, check, 4000), `${what} landed`);
    }
    const pay = await accept((g) => g.kind === "pay", "Pay $0.05 · pharmacy.localhost ⇥");
    if (pay) ok(pay.label === "Pay $0.05 · pharmacy.localhost ⇥", `pay label exact: "${pay.label}"`);
    const after = await waitGhost((g) => g.kind === "done" || g.kind === "blocked", 20000);
    ok(after?.kind === "done", `after paying: ${after?.label ?? "nothing"}`);
    if (after?.kind === "done") ok(await until(c, `/Refill requested/.test(document.getElementById("done").textContent)`), "Refill requested ✓ shown");
    await shot(c, "flow4-pharmacy");
    await c.close();
}

try {
    if (which === "flow1" || which === "all") await flow1();
    if (which === "flow3" || which === "all") await flow3();
    if (which === "flow4" || which === "all") await flow4();
} finally {
    hub.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exitCode = failures ? 1 : 0;
