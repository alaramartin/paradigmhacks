// One Express process, five demo sites on five ports. Paid endpoints are x402 v2 on Base Sepolia.
//   tickets :4001 · resale :4002 · tracker :4003 · inbox :4004 · pharmacy :4005
import express, { type Express } from "express";
import { fileURLToPath } from "node:url";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { HTTPRequestContext } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { env } from "../src/env.ts";
import { resetTracker, trackerRoutes } from "./tracker.ts";

const site = (name: string) => fileURLToPath(new URL(`./sites/${name}/`, import.meta.url));
const shared = fileURLToPath(new URL("./sites/shared/", import.meta.url));

// Prices are in thousandths of a dollar so N × $0.255 stays exact.
const TICKET_MILLS = 150;
const RESALE_MILLS = 255;
export const usd = (mills: number) => `$${(Math.round(mills / 10) / 100).toFixed(2)}`;
const qtyOf = (ctx: HTTPRequestContext) => {
    const q = Number((ctx.adapter.getBody?.() as { qty?: unknown } | undefined)?.qty);
    return Number.isInteger(q) && q >= 1 && q <= 4 ? q : 1;
};

const facilitator = new HTTPFacilitatorClient({ url: env.facilitator });
const resourceServer = new x402ResourceServer(facilitator).register(env.network, new ExactEvmScheme());

function base(name: string): Express {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json());
    app.use((req, res, next) => {
        res.setHeader("Cache-Control", "no-store");
        next();
    });
    app.use("/shared", express.static(shared));
    app.use(express.static(site(name), { extensions: ["html"] }));
    return app;
}

function requirePayee(addr: string, name: string): string {
    if (!addr) console.warn(`[demo] ${name} is empty in .env; paid endpoints will fail (run npm run wallets)`);
    return addr || "0x0000000000000000000000000000000000000000";
}

function ticketSite(name: string, mills: number, payTo: string, prefix: string): Express {
    const app = base(name);
    app.use(
        paymentMiddleware(
            {
                "POST /api/buy": {
                    accepts: { scheme: "exact", network: env.network, payTo, price: (ctx) => usd(qtyOf(ctx) * mills) },
                    description: "Night Owls · General admission",
                    mimeType: "application/json",
                },
            },
            resourceServer,
        ),
    );
    app.get("/e/:slug", (_req, res) => res.sendFile("event.html", { root: site(name) }));
    app.get("/checkout", (_req, res) => res.sendFile("checkout.html", { root: site(name) }));
    app.post("/api/buy", (req, res) => {
        const qty = Number(req.body?.qty) || 1;
        const order = `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
        res.json({
            order,
            event: "Night Owls",
            venue: "Hall 9",
            when: "Fri 9:00 pm",
            tickets: Array.from({ length: qty }, (_, i) => ({
                id: `${order}-${i + 1}`,
                section: "General admission",
                admit: 1,
                code: Math.random().toString(36).slice(2, 10).toUpperCase(),
            })),
        });
    });
    return app;
}

const tickets = ticketSite("tickets", TICKET_MILLS, requirePayee(env.payee, "PAYEE_ADDRESS"), "NO");
const resale = ticketSite("resale", RESALE_MILLS, requirePayee(env.attacker, "ATTACKER_ADDRESS"), "TX");

const tracker = base("tracker");
trackerRoutes(tracker);

const inbox = base("inbox");
inbox.get("/", (_req, res) => res.sendFile("index.html", { root: site("inbox") }));

const pharmacy = base("pharmacy");
pharmacy.use(
    paymentMiddleware(
        {
            "POST /api/refill": {
                accepts: { scheme: "exact", network: env.network, payTo: requirePayee(env.payee, "PAYEE_ADDRESS"), price: "$0.05" },
                description: "Prescription refill · copay",
                mimeType: "application/json",
            },
        },
        resourceServer,
    ),
);
pharmacy.get("/", (_req, res) => res.redirect("/refill"));
pharmacy.post("/api/refill", (req, res) => {
    const { rx, location, time, notify } = req.body ?? {};
    res.json({ ok: true, ref: `RF-${Math.floor(10000 + Math.random() * 90000)}`, rx, location, time, notify: !!notify });
});

// Demo reset for every site (only the tracker holds state).
for (const app of [tickets, resale, inbox, pharmacy]) app.post("/api/reset", (_req, res) => res.json({ ok: true }));
tracker.post("/api/reset", (_req, res) => {
    resetTracker();
    res.json({ ok: true });
});

const sites: [string, Express, number][] = [
    ["tickets", tickets, 4001],
    ["resale", resale, 4002],
    ["tracker", tracker, 4003],
    ["inbox", inbox, 4004],
    ["pharmacy", pharmacy, 4005],
];
for (const [name, app, port] of sites) {
    app.listen(port, "127.0.0.1", () => console.log(`[demo] ${name} → http://${name}.localhost:${port}`));
}
