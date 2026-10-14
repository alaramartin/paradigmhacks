// The payer: x402 v2 fetch wrapper with the exact EVM scheme on Base Sepolia.
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { x402HTTPClient, x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { env } from "./env.ts";
import { localFetch } from "./localfetch.ts";

let cached: { payFetch: typeof fetch; address: string } | null = null;

export function payer(): { payFetch: typeof fetch; address: string } {
    if (cached) return cached;
    if (!env.payerKey) throw new Error("PAYER_PRIVATE_KEY missing in .env");
    const account = privateKeyToAccount(env.payerKey);
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
    const signer = toClientEvmSigner(account, publicClient);
    const payFetch = wrapFetchWithPaymentFromConfig(localFetch, {
        schemes: [{ network: env.network, client: new ExactEvmScheme(signer) }],
    }) as typeof fetch;
    cached = { payFetch, address: account.address };
    return cached;
}

// Decoding only; no signer needed.
const http402 = new x402HTTPClient(new x402Client());
export const decodeRequired = (getHeader: (n: string) => string | null | undefined, body?: unknown) =>
    http402.getPaymentRequiredResponse(getHeader, body);
export const decodeSettle = (getHeader: (n: string) => string | null | undefined) => http402.getPaymentSettleResponse(getHeader);
