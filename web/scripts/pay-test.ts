// npm run pay-test — buys 2 tickets through Node alone (no browser) and prints the tx hash.
// Needs the demo server running (npm run demo) and a funded payer.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
const account = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY as `0x${string}`);
const network = (process.env.NETWORK ?? "eip155:84532") as `${string}:${string}`;
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network, client: new ExactEvmScheme(account) }] });

const t = performance.now();
const res = await fetchWithPayment("http://tickets.localhost:4001/api/buy?qty=2", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
console.log(`HTTP ${res.status} in ${(performance.now() - t).toFixed(0)} ms`);
const pr = res.headers.get("PAYMENT-RESPONSE");
if (pr) {
    const s = decodePaymentResponseHeader(pr);
    console.log(`settled: ${s.success} · tx ${s.transaction}\nhttps://sepolia.basescan.org/tx/${s.transaction}`);
}
const again = res.headers.get("PAYMENT-REQUIRED");
if (again) console.log(`not paid: ${decodePaymentRequiredHeader(again).error}`);
console.log(JSON.stringify(await res.json()).slice(0, 300));
