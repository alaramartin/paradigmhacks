// Websocket hub on 127.0.0.1:7800. A (role 'shell') and C (role 'web') connect and say hello.
import { config } from "dotenv";
import { WebSocketServer, type WebSocket } from "ws";
import type { HubToShell, HubToWeb } from "../../protocol/types.ts";
import { Brain } from "./brain.ts";
import { makeDecider } from "./model.ts";
import { DEFAULT_WORKFLOWS_FILE } from "./pattern.ts";

config({ path: new URL("../../.env", import.meta.url).pathname });

const PORT = Number(process.env.HUB_PORT ?? 7800);
let shell: WebSocket | null = null;
let web: WebSocket | null = null;
const tools = new Set<WebSocket>(); // tools/send.ts and other observers see all outbound traffic

function out(to: "shell" | "web", m: HubToShell | HubToWeb): void {
    const s = JSON.stringify(m);
    const ws = to === "shell" ? shell : web;
    if (ws && ws.readyState === ws.OPEN) ws.send(s);
    for (const t of tools) if (t.readyState === t.OPEN) t.send(JSON.stringify({ to, msg: m }));
    if (m.type !== "hud") console.log(`→ ${to} ${s.length > 200 ? s.slice(0, 200) + "…" : s}`);
}

const decider = makeDecider();
const brain = new Brain({
    sendShell: (m) => out("shell", m),
    sendWeb: (m) => out("web", m),
    decider,
    workflowsFile: process.env.TAB_WORKFLOWS_FILE || DEFAULT_WORKFLOWS_FILE,
    onPredict: ({ source, latencyMs, action }) =>
        console.log(`[predict] ${source} ${latencyMs.toFixed(1)} ms → ${action ? `${action.label} (${action.confidence})` : "none"}`),
});

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
wss.on("connection", (ws) => {
    let role: "shell" | "web" | "tool" | null = null;
    ws.on("message", (data) => {
        let m: any;
        try {
            m = JSON.parse(String(data));
        } catch {
            return console.error("bad json:", String(data).slice(0, 100));
        }
        if (m.type === "hello") {
            role = m.role === "shell" ? "shell" : m.role === "web" ? "web" : "tool";
            if (role === "shell") shell = ws;
            else if (role === "web") web = ws;
            else tools.add(ws);
            console.log(`hello from ${role}`);
        }
        if (role === "tool" && (m.to === "shell" || m.to === "web") && m.msg) return out(m.to, m.msg);
        if (role === "tool" && m.type === "reset") {
            brain.reset(!!m.keepWorkflows); // web/scripts/reset-demo.ts: history, units, counters; saved workflows unless kept
            return console.log(`hub: reset${m.keepWorkflows ? " (kept workflows)" : ""}`);
        }
        // Tools can impersonate either side: {"as":"shell"|"web", ...msg}
        const from = role === "tool" ? m.as ?? "web" : role;
        if (m.type !== "state") console.log(`← ${from} ${String(data).slice(0, 200)}`);
        try {
            if (from === "shell") brain.fromShell(m);
            else if (from === "web") brain.fromWeb(m);
        } catch (err) {
            console.error(`[hub] error handling ${m.type}:`, err);
        }
    });
    ws.on("close", () => {
        if (ws === shell) shell = null;
        if (ws === web) web = null;
        tools.delete(ws);
        console.log(`${role ?? "client"} disconnected`);
    });
});

console.log(`hub listening on ws://127.0.0.1:${PORT} · model: ${decider?.name ?? "none"}`);
process.on("unhandledRejection", (err) => console.error("[hub] unhandled:", err));
