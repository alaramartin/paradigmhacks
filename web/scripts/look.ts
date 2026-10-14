// Look-and-try helper over CDP (no gstack on this machine). Acts like the user: trusted mouse/keys.
//   npm run look -- open <url>                       open a tab
//   npm run look -- shot <urlPart> <file.png> [WxH]  screenshot the tab whose URL contains urlPart
//   npm run look -- click <urlPart> <css>            real mouse click at the element center
//   npm run look -- select <urlPart> <css> <label>   choose an option like a user (focus + change)
//   npm run look -- type <urlPart> <css> <text>      focus, type, blur
//   npm run look -- eval <urlPart> <js>              evaluate and print
//   npm run look -- tabs                             list tabs
import CDP from "chrome-remote-interface";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../src/env.ts";

const [cmd, a1, a2, a3] = process.argv.slice(2);
const port = env.cdpPort;

async function tab(part: string) {
    const ts = (await CDP.List({ port })).filter((t) => t.type === "page" && t.url.includes(part));
    if (!ts[0]) throw new Error(`no tab matching ${part}`);
    return CDP({ port, target: ts[0].id });
}
async function center(c: CDP.Client, css: string) {
    const { result } = await c.Runtime.evaluate({
        expression: `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return null; el.scrollIntoView({block:"nearest"}); const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`,
        returnByValue: true,
    });
    if (!result.value) throw new Error(`no element ${css}`);
    return result.value as { x: number; y: number };
}
async function mouse(c: CDP.Client, x: number, y: number) {
    await c.Input.dispatchMouseEvent({ type: "mouseMoved", x, y });
    await c.Input.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await c.Input.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

if (cmd === "open") {
    const t = await CDP.New({ port, url: a1 });
    console.log(t.id);
} else if (cmd === "tabs") {
    for (const t of await CDP.List({ port })) if (t.type === "page") console.log(t.id.slice(0, 8), t.url);
} else {
    const c = await tab(a1);
    try {
        if (cmd === "shot") {
            if (a3) {
                const [w, h] = a3.split("x").map(Number);
                await c.Emulation.setDeviceMetricsOverride({ width: w, height: h, deviceScaleFactor: 1, mobile: false });
                await new Promise((r) => setTimeout(r, 400));
            }
            const { data } = await c.Page.captureScreenshot({ format: "png" });
            mkdirSync(dirname(a2), { recursive: true });
            writeFileSync(a2, Buffer.from(data, "base64"));
            console.log(a2);
        } else if (cmd === "click") {
            const p = await center(c, a2);
            await mouse(c, p.x, p.y);
        } else if (cmd === "select") {
            await c.Runtime.evaluate({
                expression: `(() => { const s = document.querySelector(${JSON.stringify(a2)}); s.focus(); const o = [...s.options].find(o => o.label.trim() === ${JSON.stringify(a3)}); s.value = o.value; s.dispatchEvent(new Event("input", {bubbles:true})); s.dispatchEvent(new Event("change", {bubbles:true})); })()`,
            });
        } else if (cmd === "type") {
            const p = await center(c, a2);
            await mouse(c, p.x, p.y);
            await c.Input.insertText({ text: a3 });
            await c.Runtime.evaluate({ expression: `document.activeElement.blur()` });
        } else if (cmd === "eval") {
            const { result, exceptionDetails } = await c.Runtime.evaluate({ expression: a2, returnByValue: true, awaitPromise: true });
            console.log(exceptionDetails ? exceptionDetails.exception?.description : JSON.stringify(result.value, null, 1));
        } else throw new Error(`unknown command ${cmd}`);
    } finally {
        await c.close();
    }
}
