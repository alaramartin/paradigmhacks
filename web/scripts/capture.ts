// Captures a protocol fixture from a live page: the exact ScreenState the hub would receive.
//   npm run capture -- <url> <protocol/fixtures/name.json> [--setup "<js run first>"] [--wait ms]
import CDP from "chrome-remote-interface";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScreenState } from "../../protocol/types.ts";
import { env } from "../src/env.ts";

const [url, out] = process.argv.slice(2);
const arg = (k: string) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : undefined;
};
if (!url || !out) throw new Error("usage: capture <url> <out.json> [--setup js] [--wait ms]");
const INJECT = readFileSync(fileURLToPath(new URL("../src/inject.js", import.meta.url)), "utf8");

const t = await CDP.New({ port: env.cdpPort, url: "about:blank" });
const c = await CDP({ port: env.cdpPort, target: t.id });
try {
    await c.Page.enable();
    await c.Page.bringToFront();
    await c.Emulation.setDeviceMetricsOverride({ width: 960, height: 1000, deviceScaleFactor: 1, mobile: false });
    const loaded = c.Page.loadEventFired();
    await c.Page.navigate({ url });
    await loaded;
    await new Promise((r) => setTimeout(r, Number(arg("--wait") ?? 1500)));
    await c.Runtime.evaluate({ expression: INJECT });
    const setup = arg("--setup");
    if (setup) {
        await c.Runtime.evaluate({ expression: setup, awaitPromise: true });
        await new Promise((r) => setTimeout(r, 600));
    }
    const { result } = await c.Runtime.evaluate({ expression: "window.__tabCollect()", returnByValue: true });
    const v = result.value as { url: string; title: string; elements: ScreenState["elements"] };
    const state: ScreenState = { type: "state", source: "web", app: "com.google.Chrome", window: v.title, url: v.url, focused: true, elements: v.elements, seq: 1, ts: Date.now() };
    const file = resolve(out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
    console.log(`${file}: ${v.elements.length} elements, ${v.elements.filter((e) => e.list).length} with list`);
} finally {
    await c.close();
    await CDP.Close({ port: env.cdpPort, id: t.id });
}
