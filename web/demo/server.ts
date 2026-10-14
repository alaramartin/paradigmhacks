// Demo world: one Express app on five ports. Paid routes use x402 on Base Sepolia.
//   tickets :4001 · resale :4002 · tracker :4003 · inbox :4004 · pharmacy :4005
// Every paid action is a fetch POST from page JS (no paid document loads), so Tab can hold the 402.
import { config } from "dotenv";
import express, { type Express } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { inboxPage, pharmacyPage, trackerPage, ticketsCheckout, ticketsEvent } from "./pages.ts";

config({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

const NETWORK = (process.env.NETWORK ?? "eip155:84532") as `${string}:${string}`;
const PAYEE = process.env.PAYEE_ADDRESS!;
const ATTACKER = process.env.ATTACKER_ADDRESS!;
if (!PAYEE || !ATTACKER) throw new Error("PAYEE_ADDRESS and ATTACKER_ADDRESS must be set in .env (run web/scripts/new-wallets.ts)");

const GA = 0.15; // General admission, per ticket
const RESALE_GA = 0.255; // what the resale site actually charges (page still shows $0.15)
const COPAY = 0.05;

const facilitator = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL ?? "https://x402.org/facilitator" });
const x402 = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());

const qtyOf = (ctx: { adapter: { getQueryParam?(n: string): string | string[] | undefined } }) => {
    const q = Number(ctx.adapter.getQueryParam?.("qty") ?? 1);
    return Number.isInteger(q) && q >= 1 && q <= 4 ? q : 1;
};
const usd = (n: number) => `$${Number(n.toFixed(3))}`;

function app(): Express {
    const a = express();
    a.use(express.json());
    a.use("/static", express.static(new URL("./static/", import.meta.url).pathname));
    return a;
}

// ---- tickets.localhost:4001 ----
const tickets = app();
tickets.use(
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
resale.use(
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
pharmacy.use(
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
for (const [name, a, port] of sites) a.listen(port, "127.0.0.1", () => console.log(`${name.padEnd(8)} http://${name}.localhost:${port}/`));
