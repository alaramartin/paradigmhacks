// Agent C process: Chrome (CDP) ⇄ hub (ws://127.0.0.1:7800), plus 402 payments.
import WebSocket from "ws";
import type { HubToWeb, WebToHub } from "../../protocol/types.ts";
import { Chrome } from "./cdp.ts";
import { env } from "./env.ts";
import { execute } from "./exec.ts";
import { Payments } from "./pay402.ts";

const verbose = process.argv.includes("--verbose");
let ws: WebSocket | null = null;
let open = false;

function send(m: WebToHub): void {
    if (verbose || m.type !== "state") console.log(`→ hub ${summary(m)}`);
    if (ws && open) ws.send(JSON.stringify(m));
}

const chrome = new Chrome(env.cdpPort, {
    state: (s) => send(s),
    userEvent: (e) => send(e),
    attached: (tab) => {
        payments.hook(tab).catch((e) => console.warn(`[pay402] Fetch.enable failed on ${tab.url}: ${e.message}`));
    },
    detached: (tab) => payments.forget(tab),
});
const payments = new Payments(chrome, send);

async function onHub(m: HubToWeb): Promise<void> {
    switch (m.type) {
        case "exec": {
            const t0 = Date.now();
            try {
                await execute(chrome, m.action);
                send({ type: "exec_result", ghostId: m.ghostId, ok: true });
                console.log(`[exec] ${m.action.op} ${m.action.label} ok (${Date.now() - t0} ms)`);
            } catch (e) {
                const error = (e as Error).message;
                console.warn(`[exec] ${m.action.op} ${m.action.label} failed: ${error}`);
                send({ type: "exec_result", ghostId: m.ghostId, ok: false, error });
            }
            break;
        }
        case "pay":
            await payments.pay(m.paymentId);
            break;
        case "dismiss_payment":
            await payments.dismiss(m.paymentId);
            break;
        case "open_url": {
            const tab = await chrome.openTab(m.url).catch((e) => (console.warn(`[open_url] ${e.message}`), null));
            if (tab) chrome.echo(tab, 1500);
            break;
        }
    }
}

function connect(): void {
    ws = new WebSocket(env.hubUrl);
    ws.on("open", () => {
        open = true;
        console.log(`[hub] connected ${env.hubUrl}`);
        ws!.send(JSON.stringify({ type: "hello", role: "web" }));
        chrome.resendAll();
        for (const p of payments.pending()) send(p);
    });
    ws.on("message", (data) => {
        let m: HubToWeb;
        try {
            m = JSON.parse(String(data));
        } catch {
            return;
        }
        console.log(`← hub ${summary(m)}`);
        onHub(m).catch((e) => console.error(`[hub] ${m.type}:`, e));
    });
    ws.on("close", () => {
        if (open) console.log("[hub] disconnected; retrying");
        open = false;
        setTimeout(connect, 1000);
    });
    ws.on("error", () => {});
}

function summary(m: any): string {
    switch (m.type) {
        case "state":
            return `state ${m.focused ? "*" : " "} ${m.url} (${m.elements.length} els)`;
        case "user_event":
            return `user_event ${m.kind} ${m.target ? `${m.target.role} "${m.target.label}"` : ""}${m.value !== undefined ? ` = ${JSON.stringify(m.value).slice(0, 60)}` : ""}`;
        case "exec":
            return `exec ${m.ghostId} ${m.action.op} ${m.action.targetPath ?? m.action.targetId ?? ""} ${m.action.value !== undefined ? JSON.stringify(m.action.value).slice(0, 60) : ""}`;
        default:
            return JSON.stringify(m).slice(0, 220);
    }
}

chrome.start();
connect();
console.log(`[web] CDP :${env.cdpPort} · hub ${env.hubUrl} · payer ${env.payerKey ? "set" : "MISSING"}`);
process.on("unhandledRejection", (e) => console.error("[web] unhandled:", e));
process.on("SIGINT", () => {
    chrome.stop();
    process.exit(0);
});
