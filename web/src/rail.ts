// Payment rails behind one interface, chosen by PAY_RAIL in .env: `mpp` (Tempo testnet, the demo) or `x402`
// (Base Sepolia, the fallback). main.ts keeps the hold → intent check → pay → fulfill flow; only parsing the 402
// challenge and paying live here. See PLAN.md "Change (10:45 PT Wed)".
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { Challenge, Receipt } from "mppx";
import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";

export interface ParsedChallenge {
    amountUsd: number;
    payTo: string;
    network: string;
    asset: string;
}

export interface PayResult {
    /** The paid (or failed) response, to fulfill the held request with. Absent if the request never completed. */
    res?: Response;
    ok: boolean;
    txHash?: string;
    explorerUrl?: string;
    error?: string;
}

export interface Rail {
    name: "x402" | "mpp";
    /** The 402 challenge in these response headers, or null if this rail doesn't recognise one. */
    parseChallenge(headers: Headers): ParsedChallenge | null;
    /** Replay the request through the rail's paying client. */
    pay(url: string, init: RequestInit): Promise<PayResult>;
    /** Configured to pay at all (payer key present). */
    ready: boolean;
}

// ---------------- x402 (Base Sepolia), moved verbatim from main.ts ----------------

function x402Rail(): Rail {
    const NETWORK = (process.env.NETWORK ?? "eip155:84532") as `${string}:${string}`;
    const account = process.env.PAYER_PRIVATE_KEY ? privateKeyToAccount(process.env.PAYER_PRIVATE_KEY as `0x${string}`) : null;
    const fetchWithPayment = account ? wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }] }) : null;
    return {
        name: "x402",
        ready: !!fetchWithPayment,
        parseChallenge(headers) {
            const header = headers.get("payment-required");
            if (!header) return null;
            const required = decodePaymentRequiredHeader(header);
            const accept = required.accepts.find((x) => x.network === NETWORK) ?? required.accepts[0];
            const amount = Number(accept.amount) / 1e6; // USDC has 6 decimals
            return { amountUsd: amount, payTo: accept.payTo, network: accept.network, asset: accept.asset };
        },
        async pay(url, init) {
            if (!fetchWithPayment) return { ok: false, error: "no PAYER_PRIVATE_KEY" };
            const res = await fetchWithPayment(url, init);
            const settle = res.headers.get("payment-response");
            const tx = settle ? decodePaymentResponseHeader(settle) : null;
            if (!res.ok || !tx?.success) {
                // A second 402 carries the reason (e.g. insufficient funds) in its PAYMENT-REQUIRED header.
                const again = res.headers.get("payment-required");
                let reason = tx?.errorReason;
                if (!reason && again) reason = (() => { try { return decodePaymentRequiredHeader(again).error; } catch { return undefined; } })();
                return { res, ok: false, error: reason?.includes("insufficient_balance") ? "not enough USDC in the wallet" : (reason ?? `HTTP ${res.status}`).replace(/_/g, " ") };
            }
            return { res, ok: true, txHash: tx.transaction, explorerUrl: `https://sepolia.basescan.org/tx/${tx.transaction}` };
        },
    };
}

// ---------------- MPP (Tempo testnet, Moderato) ----------------

/** Tempo stablecoins (TIP-20) have 6 decimals; the wire challenge carries the amount in base units. */
const TEMPO_DECIMALS = 6;
const TEMPO_TOKEN_NAME = process.env.TEMPO_TOKEN_NAME || "testnet USD";

function mppRail(): Rail {
    const account = process.env.TEMPO_PAYER_PRIVATE_KEY ? privateKeyToAccount(process.env.TEMPO_PAYER_PRIVATE_KEY as `0x${string}`) : null;
    const mppx = account ? Mppx.create({ methods: [tempo({ account, expectedChainId: tempoModerato.id })], polyfill: false }) : null;
    return {
        name: "mpp",
        ready: !!mppx,
        parseChallenge(headers) {
            if (!/^\s*Payment\b/i.test(headers.get("www-authenticate") ?? "")) return null;
            const c = Challenge.fromHeaders(headers) as { method: string; intent: string; request: Record<string, any> };
            if (c.method !== "tempo" || c.intent !== "charge") return null;
            const r = c.request;
            const chainId = r.methodDetails?.chainId ?? r.chainId;
            return {
                amountUsd: Number(r.amount) / 10 ** TEMPO_DECIMALS,
                payTo: String(r.recipient ?? ""),
                network: `tempo:${chainId ?? tempoModerato.id}`,
                asset: String(r.currency),
            };
        },
        async pay(url, init) {
            if (!mppx) return { ok: false, error: "no TEMPO_PAYER_PRIVATE_KEY" };
            let res: Response;
            try {
                res = await mppx.fetch(url, init);
            } catch (e) {
                const msg = (e as Error).message ?? String(e);
                return { ok: false, error: /insufficient|exceeds balance|transfer amount exceeds/i.test(msg) ? `not enough ${TEMPO_TOKEN_NAME} in the wallet` : msg.split("\n")[0].slice(0, 160) };
            }
            if (!res.ok) return { res, ok: false, error: `HTTP ${res.status}` };
            let receipt: { status?: string; reference?: string } | null = null;
            try {
                receipt = Receipt.fromResponse(res) as { status?: string; reference?: string };
            } catch {
                /* no receipt header */
            }
            if (!receipt?.reference) return { res, ok: false, error: "paid response had no Payment-Receipt" };
            return { res, ok: true, txHash: receipt.reference, explorerUrl: `${tempoModerato.blockExplorers.default.url}/tx/${receipt.reference}` };
        },
    };
}

export function makeRail(): Rail {
    const which = (process.env.PAY_RAIL || "mpp").toLowerCase();
    if (which !== "mpp" && which !== "x402") throw new Error(`PAY_RAIL must be "mpp" or "x402", got "${which}"`);
    return which === "x402" ? x402Rail() : mppRail();
}
