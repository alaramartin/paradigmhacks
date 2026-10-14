// Demo world: one Express app on five ports. Paid routes charge on the rail PAY_RAIL picks:
//   mpp (demo) → Tempo testnet via mppx · x402 (fallback) → Base Sepolia via @x402/express. Restart after switching.
//   tickets :4001 · resale :4002 · tracker :4003 · inbox :4004 · pharmacy :4005
// Every paid action is a fetch POST from page JS (no paid document loads), so Tab can hold the 402.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { Mppx, tempo } from "mppx/express";
import { createClient, custom, http, HttpRequestError, keccak256, type Hex } from "viem";
import { tempoModerato } from "viem/chains";
import { inboxPage, pharmacyPage, trackerPage, ticketsCheckout, ticketsEvent } from "./pages.ts";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const RAIL = (process.env.PAY_RAIL || "mpp").toLowerCase(); // same default as src/rail.ts
if (RAIL !== "mpp" && RAIL !== "x402") throw new Error(`PAY_RAIL must be mpp or x402 (got "${RAIL}")`);
const NETWORK = (process.env.NETWORK ?? "eip155:84532") as `${string}:${string}`;
const PAYEE = process.env.PAYEE_ADDRESS!;
const ATTACKER = process.env.ATTACKER_ADDRESS!;
if (RAIL === "x402" && (!PAYEE || !ATTACKER)) throw new Error("PAYEE_ADDRESS and ATTACKER_ADDRESS must be set in .env (run web/scripts/new-wallets.ts)");
const T_PAYEE = process.env.TEMPO_PAYEE_ADDRESS as `0x${string}`;
const T_ATTACKER = process.env.TEMPO_ATTACKER_ADDRESS as `0x${string}`;
if (RAIL === "mpp" && (!T_PAYEE || !T_ATTACKER || !process.env.MPP_SECRET_KEY))
    throw new Error("TEMPO_PAYEE_ADDRESS, TEMPO_ATTACKER_ADDRESS and MPP_SECRET_KEY must be set in .env (npm run tempo-wallets)");

const GA = 0.15; // General admission, per ticket
const RESALE_GA = 0.255; // what the resale site actually charges (page still shows $0.15)
const COPAY = 0.05;

const facilitator = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL ?? "https://x402.org/facilitator" });
const x402 = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());

// MPP: one mppx per recipient, pathUSD on Tempo testnet (Moderato). Amounts are decimal strings in token units.
const PATH_USD = "0x20c0000000000000000000000000000000000000";
// Tempo's RPC (behind Cloudflare) sometimes answers mppx's eth_sendRawTransactionSync with an HTTP 502 while plain
// calls work (3 of 5 payments on venue wifi, 11:00 PT). On an HTTP failure, send the same signed tx with
// eth_sendRawTransaction and poll for its receipt; RPC errors (revert, low balance) still pass straight through.
const rpc = http()({ chain: tempoModerato }); // viem's default retries for every other call
const rpcOnce = http(undefined, { retryCount: 0 })({ chain: tempoModerato }); // the Sync broadcast: fall back below instead of re-sending it
const tempoClient = createClient({
    chain: tempoModerato,
    transport: custom({
        async request({ method, params }) {
            if (method !== "eth_sendRawTransactionSync") return rpc.request({ method, params });
            try {
                return await rpcOnce.request({ method, params });
            } catch (e) {
                if (!(e instanceof HttpRequestError)) throw e;
                const raw = (params as [Hex])[0];
                const hash = keccak256(raw);
                console.log(`mpp: eth_sendRawTransactionSync failed (HTTP ${e.status ?? "?"}), resending ${hash} without Sync`);
                await rpc.request({ method: "eth_sendRawTransaction", params: [raw] }).catch((e2: Error) => console.log(`mpp: resend: ${e2.message.split("\n")[0]}`));
                for (const t = Date.now(); Date.now() - t < 20_000; await new Promise((r) => setTimeout(r, 500))) {
                    const receipt = await rpc.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null);
                    if (receipt) return receipt;
                }
                throw e;
            }
        },
    }),
});
const mppFor = (recipient: `0x${string}`) =>
    Mppx.create({
        methods: [tempo.charge({ currency: PATH_USD, recipient, testnet: true, getClient: () => tempoClient })],
        secretKey: process.env.MPP_SECRET_KEY,
    });
const mpp = RAIL === "mpp" ? { payee: mppFor(T_PAYEE), attacker: mppFor(T_ATTACKER) } : null;
// Express middleware charging `amount(req)` per request (prices depend on qty); x402 keeps its own middleware below.
const charge = (who: "payee" | "attacker", amount: (q: express.Request) => number, description: string): express.RequestHandler =>
    (q, r, next) => mpp![who].charge({ amount: String(Number(amount(q).toFixed(6))), description: description.replace(/·/g, "-") })(q, r, next);
const qty = (q: express.Request) => {
    const n = Number(q.query.qty ?? 1);
    return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 1;
};

const qtyOf = (ctx: { adapter: { getQueryParam?(n: string): string | string[] | undefined } }) => {
    const q = Number(ctx.adapter.getQueryParam?.("qty") ?? 1);
    return Number.isInteger(q) && q >= 1 && q <= 4 ? q : 1;
};
const usd = (n: number) => `$${Number(n.toFixed(3))}`;

function app(): Express {
    const a = express();
    a.use(express.json());
    a.use("/static", express.static(fileURLToPath(new URL("./static/", import.meta.url))));
    return a;
}

// ---- tickets.localhost:4001 ----
const tickets = app();
if (mpp) tickets.post("/api/buy", charge("payee", (q) => qty(q) * GA, "Night Owls · General admission"));
else tickets.use(
    paymentMiddleware(
        {
            "POST /api/buy": {
                accepts: { scheme: "exact", network: NETWORK, payTo: PAYEE, price: (ctx) => usd(qtyOf(ctx) * GA) },
                description: "Night Owls · General admission",
            },
        },
        x402,
    ),
);
tickets.get("/", (_q, r) => r.redirect("/e/night-owls"));
tickets.get("/e/night-owls", (_q, r) => r.send(ticketsEvent("tickets", GA)));
tickets.get("/checkout", (q, r) => r.send(ticketsCheckout("tickets", GA, Number(q.query.qty ?? 1))));
tickets.post("/api/buy", (q, r) => r.json(ticketCards(Number(q.query.qty ?? 1))));

// ---- resale.localhost:4002: same show, page says $0.15 each, the 402 asks $0.255 each to a different address ----
const resale = app();
if (mpp) resale.post("/api/buy", charge("attacker", (q) => qty(q) * RESALE_GA, "Night Owls · resale"));
else resale.use(
    paymentMiddleware(
        {
            "POST /api/buy": {
                accepts: { scheme: "exact", network: NETWORK, payTo: ATTACKER, price: (ctx) => usd(qtyOf(ctx) * RESALE_GA) },
                description: "Night Owls · resale",
            },
        },
        x402,
    ),
);
resale.get("/", (_q, r) => r.redirect("/e/night-owls"));
resale.get("/e/night-owls", (_q, r) => r.send(ticketsEvent("resale", GA)));
resale.get("/checkout", (q, r) => r.send(ticketsCheckout("resale", GA, Number(q.query.qty ?? 1))));
resale.post("/api/buy", (q, r) => r.json(ticketCards(Number(q.query.qty ?? 1))));

function ticketCards(n: number) {
    return { tickets: Array.from({ length: Math.min(Math.max(n, 1), 4) }, (_, i) => ({ show: "Night Owls", venue: "Hall 9", when: "Fri 9pm", seat: "GA", code: `NO-${Date.now().toString(36).slice(-5).toUpperCase()}-${i + 1}` })) };
}

// ---- tracker.localhost:4003: single page, in-memory state, POST /api/reset ----
const SEED = [
    ["ENG-142", "Fix checkout rounding"],
    ["ENG-150", "Retry failed webhooks"],
    ["ENG-151", "Cache product images"],
    ["ENG-155", "Dark mode toggle"],
    ["ENG-157", "Faster search"],
    ["ENG-160", "Fix cart badge"],
] as const;
type Ticket = { id: string; title: string; status: "Backlog" | "In review" | "Done"; pr: string };
let tracker: Ticket[] = [];
const resetTracker = () => (tracker = SEED.map(([id, title]) => ({ id, title, status: "In review", pr: "" })));
resetTracker();
const trackerApp = app();
trackerApp.get("/", (_q, r) => r.send(trackerPage()));
trackerApp.get("/api/tickets", (_q, r) => r.json(tracker));
trackerApp.post("/api/tickets/:id", (q, r) => {
    const t = tracker.find((t) => t.id === q.params.id);
    if (!t) return r.status(404).json({ error: "no such ticket" });
    if (q.body.status) t.status = q.body.status;
    if (typeof q.body.pr === "string") t.pr = q.body.pr;
    r.json(t);
});
trackerApp.post("/api/reset", (_q, r) => (resetTracker(), r.json({ ok: true })));

// ---- inbox.localhost:4004 ----
const inbox = app();
inbox.get("/", (_q, r) => r.send(inboxPage()));

// ---- pharmacy.localhost:4005 ----
const pharmacy = app();
if (mpp) pharmacy.post("/api/refill", charge("payee", () => COPAY, "Prescription refill copay"));
else pharmacy.use(
    paymentMiddleware(
        { "POST /api/refill": { accepts: { scheme: "exact", network: NETWORK, payTo: PAYEE, price: usd(COPAY) }, description: "Prescription refill copay" } },
        x402,
    ),
);
pharmacy.get("/", (_q, r) => r.redirect("/refill"));
pharmacy.get("/refill", (_q, r) => r.send(pharmacyPage(COPAY)));
pharmacy.post("/api/refill", (q, r) => r.json({ ok: true, rx: q.body?.rx, location: q.body?.location, time: q.body?.time }));

const sites: [string, Express, number][] = [
    ["tickets", tickets, 4001],
    ["resale", resale, 4002],
    ["tracker", trackerApp, 4003],
    ["inbox", inbox, 4004],
    ["pharmacy", pharmacy, 4005],
];
console.log(`paid routes charge on ${RAIL === "mpp" ? "Tempo testnet (MPP, pathUSD)" : `x402 (${NETWORK})`}  [PAY_RAIL=${RAIL}]`);
for (const [name, a, port] of sites) a.listen(port, "127.0.0.1", () => console.log(`${name.padEnd(8)} http://${name}.localhost:${port}/`));
