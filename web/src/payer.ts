// The payer: x402 v2 fetch wrapper with the exact EVM scheme on Base Sepolia.
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { x402HTTPClient, x402Client } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner, type ClientEvmSigner } from "@x402/evm";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { env } from "./env.ts";
import { localFetch } from "./localfetch.ts";

let signer: ClientEvmSigner | null = null;
function getSigner(): ClientEvmSigner {
    if (signer) return signer;
    if (!env.payerKey) throw new Error("PAYER_PRIVATE_KEY missing in .env");
    const account = privateKeyToAccount(env.payerKey);
    signer = toClientEvmSigner(account, createPublicClient({ chain: baseSepolia, transport: http() }));
    return signer;
}

export type Pin = Pick<PaymentRequirements, "payTo" | "amount" | "asset" | "network">;

/**
 * A paying fetch. With `pin`, it will only pay requirements that match what the user approved
 * exactly (payee, amount, asset, network), so a server can't change the price between the 402
 * the user saw and the replay.
 */
export function payer(pin?: Pin): { payFetch: typeof fetch; address: string } {
    const s = getSigner();
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    const payFetch = wrapFetchWithPaymentFromConfig(localFetch, {
        schemes: [{ network: env.network, client: new ExactEvmScheme(s) }],
        policies: pin
            ? [(_v, reqs) => reqs.filter((r) => same(r.payTo, pin.payTo) && r.amount === pin.amount && same(r.asset, pin.asset) && r.network === pin.network)]
            : undefined,
    }) as typeof fetch;
    return { payFetch, address: s.address };
}

// Decoding only; no signer needed.
const http402 = new x402HTTPClient(new x402Client());
export const decodeRequired = (getHeader: (n: string) => string | null | undefined, body?: unknown) =>
    http402.getPaymentRequiredResponse(getHeader, body);
export const decodeSettle = (getHeader: (n: string) => string | null | undefined) => http402.getPaymentSettleResponse(getHeader);

/** Atomic units → dollars string with 2 decimals (more only if needed). */
export function atomicToUsd(amount: string, decimals = 6): string {
    const n = Number(amount) / 10 ** decimals;
    const s = n.toFixed(decimals).replace(/0+$/, "");
    const [, frac = ""] = s.split(".");
    return frac.length <= 2 ? n.toFixed(2) : s;
}
