// 402 hold → pay → fulfill. Every fetch/XHR to *.localhost is paused at the Response stage.
// A 402 stays paused (the page's own pending fetch is the "waiting" state) until the user
// accepts the pay ghost (we replay it with payment and fulfill) or dismisses it (the 402 goes through).
import type { PaymentRequired, PaymentResult } from "../../protocol/types.ts";
import type { PaymentRequirements } from "@x402/core/types";
import type { Chrome, Tab } from "./cdp.ts";
import { env, explorerTx } from "./env.ts";
import { checkIntent } from "./intent.ts";
import { record } from "./ledger.ts";
import { atomicToUsd, decodeRequired, decodeSettle, payer } from "./payer.ts";

type Header = { name: string; value: string };
type Paused = {
    requestId: string;
    request: { url: string; method: string; headers: Record<string, string>; postData?: string; postDataEntries?: { bytes?: string }[] };
    resourceType: string;
    responseStatusCode?: number;
    responseStatusText?: string;
    responseHeaders?: Header[];
    responseErrorReason?: string;
};

interface Held {
    msg: PaymentRequired;
    tab: Tab;
    paused: Paused;
    body: string; // original 402 body, base64
    accepted: PaymentRequirements;
    timer: NodeJS.Timeout;
    busy: boolean;
}

const HOLD_MAX_MS = 10 * 60_000;
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate", "host", "content-length", "accept-encoding"]);
const PATTERNS = ["Fetch", "XHR"].map((resourceType) => ({ urlPattern: "http://*.localhost:*/*", resourceType, requestStage: "Response" as const }));

export class Payments {
    private held = new Map<string, Held>();
    private n = 0;

    constructor(
        private chrome: Chrome,
        private send: (m: PaymentRequired | PaymentResult) => void,
    ) {}

    async hook(tab: Tab): Promise<void> {
        tab.client.on("Fetch.requestPaused", (p: Paused) => this.paused(tab, p).catch((e) => console.error("[pay402] paused:", e)));
        await tab.client.Fetch.enable({ patterns: PATTERNS as any });
    }

    /** Drop holds for a tab that went away. */
    forget(tab: Tab): void {
        for (const [id, h] of this.held) if (h.tab === tab) this.release(id);
    }

    private async paused(tab: Tab, p: Paused): Promise<void> {
        const F = tab.client.Fetch;
        if (p.responseStatusCode !== 402) {
            await F.continueResponse({ requestId: p.requestId }).catch(() => F.continueRequest({ requestId: p.requestId }).catch(() => {}));
            return;
        }
        const headers = p.responseHeaders ?? [];
        const getHeader = (n: string) => headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value;
        const { body: rawBody, base64Encoded } = await F.getResponseBody({ requestId: p.requestId });
        const body = base64Encoded ? rawBody : Buffer.from(rawBody).toString("base64");
        let required;
        try {
            let json: unknown;
            try {
                json = JSON.parse(Buffer.from(body, "base64").toString("utf8"));
            } catch {}
            required = decodeRequired(getHeader, json);
        } catch (e) {
            console.warn(`[pay402] 402 without x402 requirements on ${p.request.url}: ${(e as Error).message}`);
            await this.fulfillOriginal(tab, p, body);
            return;
        }
        const accepted = required.accepts.find((a) => a.network === env.network && a.scheme === "exact") ?? required.accepts[0];
        const amountUsd = atomicToUsd(accepted.amount, Number((accepted.extra as any)?.decimals ?? 6));
        // The click that triggered the fetch usually arrives just before the 402; give it a beat.
        if (!tab.lastClick || Date.now() - tab.lastClick.ts > 5000) await new Promise((r) => setTimeout(r, 120));
        const anchorRect = tab.lastClick && Date.now() - tab.lastClick.ts < 15000 ? tab.lastClick.rect : undefined;
        const verdict = checkIntent(tab.state, amountUsd, anchorRect);
        const paymentId = `pay-${Date.now().toString(36)}-${++this.n}`;
        const msg: PaymentRequired = {
            type: "payment_required",
            paymentId,
            url: p.request.url,
            method: p.request.method,
            payeeDomain: new URL(p.request.url).hostname,
            payTo: accepted.payTo,
            amountUsd,
            network: accepted.network,
            asset: accepted.asset,
            verdict,
            anchorRect,
        };
        const timer = setTimeout(() => this.release(paymentId), HOLD_MAX_MS);
        this.held.set(paymentId, { msg, tab, paused: p, body, accepted, timer, busy: false });
        console.log(`[pay402] holding ${p.request.method} ${p.request.url} · $${amountUsd} → ${accepted.payTo} · ${verdict.ok ? "ok" : "BLOCKED: " + verdict.reason}`);
        this.send(msg);
    }

    /** User accepted the pay ghost. */
    async pay(paymentId: string): Promise<void> {
        const h = this.held.get(paymentId);
        if (!h) return this.send({ type: "payment_result", paymentId, ok: false, error: "payment expired" });
        if (h.busy) return;
        if (!h.msg.verdict.ok) return this.send({ type: "payment_result", paymentId, ok: false, error: `blocked · ${h.msg.verdict.reason}` });
        h.busy = true;
        const { paused: p, tab, msg } = h;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(p.request.headers)) if (!HOP.has(k.toLowerCase())) headers[k] = v;
        const body = p.request.postData ?? (p.request.postDataEntries ? Buffer.concat(p.request.postDataEntries.map((e) => Buffer.from(e.bytes ?? "", "base64"))).toString("utf8") : undefined);
        const t0 = Date.now();
        let result: PaymentResult;
        try {
            const { payFetch } = payer({ payTo: h.accepted.payTo, amount: h.accepted.amount, asset: h.accepted.asset, network: h.accepted.network });
            const res = await payFetch(p.request.url, { method: p.request.method, headers, body: p.request.method === "GET" || p.request.method === "HEAD" ? undefined : body });
            const buf = Buffer.from(await res.arrayBuffer());
            const responseHeaders: Header[] = [];
            res.headers.forEach((value, name) => {
                if (!["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"].includes(name)) responseHeaders.push({ name, value });
            });
            let txHash: string | undefined;
            let error: string | undefined;
            if (res.ok) {
                try {
                    txHash = decodeSettle((n) => res.headers.get(n)).transaction;
                } catch (e) {
                    error = `paid but no settlement header: ${(e as Error).message}`;
                }
            } else {
                error = describeFailure(res, buf);
            }
            await tab.client.Fetch.fulfillRequest({ requestId: p.requestId, responseCode: res.status, responseHeaders, body: buf.toString("base64") });
            result = res.ok && txHash ? { type: "payment_result", paymentId, ok: true, txHash, explorerUrl: explorerTx(txHash) } : { type: "payment_result", paymentId, ok: false, error: error ?? `HTTP ${res.status}` };
        } catch (e) {
            const err = (e as Error).message;
            console.error(`[pay402] pay failed: ${err}`);
            await this.fulfillOriginal(tab, p, h.body).catch(() => {});
            result = { type: "payment_result", paymentId, ok: false, error: shortError(err) };
        }
        clearTimeout(h.timer);
        this.held.delete(paymentId);
        record({ ts: Date.now(), domain: msg.payeeDomain, payTo: msg.payTo, amountUsd: msg.amountUsd, url: msg.url, txHash: result.txHash, ok: result.ok, error: result.error });
        console.log(`[pay402] ${result.ok ? `paid $${msg.amountUsd} tx ${result.txHash}` : `failed: ${result.error}`} (${Date.now() - t0} ms)`);
        this.send(result);
    }

    /** User dismissed: let the original 402 through to the page and forget the payment. */
    async dismiss(paymentId: string): Promise<void> {
        await this.release(paymentId);
    }

    private async release(paymentId: string): Promise<void> {
        const h = this.held.get(paymentId);
        if (!h || h.busy) return;
        clearTimeout(h.timer);
        this.held.delete(paymentId);
        if (!h.tab.closed) await this.fulfillOriginal(h.tab, h.paused, h.body).catch(() => {});
        console.log(`[pay402] released ${paymentId} (402 passed to the page)`);
    }

    private async fulfillOriginal(tab: Tab, p: Paused, body: string): Promise<void> {
        await tab.client.Fetch.fulfillRequest({
            requestId: p.requestId,
            responseCode: p.responseStatusCode ?? 402,
            responseHeaders: (p.responseHeaders ?? []).filter((h) => !["content-length", "content-encoding", "transfer-encoding"].includes(h.name.toLowerCase())),
            body,
        });
    }

    pending(): PaymentRequired[] {
        return [...this.held.values()].map((h) => h.msg);
    }
}

function describeFailure(res: Response, buf: Buffer): string {
    const hdr = res.headers.get("payment-required");
    if (hdr) {
        try {
            const r = decodeRequired((n) => res.headers.get(n));
            if (r.error) return shortError(r.error);
        } catch {}
    }
    const text = buf.toString("utf8").slice(0, 200);
    return `HTTP ${res.status}${text && text !== "{}" ? ` · ${text}` : ""}`;
}

function shortError(s: string): string {
    if (/insufficient_balance/i.test(s)) return "payer has insufficient USDC";
    if (/no.*(match|requirements)|policy/i.test(s)) return "payment terms changed since you approved them";
    return s.length > 120 ? s.slice(0, 119) + "…" : s;
}
