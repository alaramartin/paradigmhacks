// npm run pay-test — buys 2 tickets through Node alone (no browser) on the rail PAY_RAIL selects
// (mpp: Tempo testnet, x402: Base Sepolia) and prints the tx and its explorer link.
// Needs the demo server running (npm run demo) on the same PAY_RAIL, and a funded payer for that rail.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
const { makeRail } = await import("../src/rail.ts");
const rail = makeRail();
console.log(`rail: ${rail.name}${rail.ready ? "" : " (no payer key set)"}`);

const t = performance.now();
const r = await rail.pay("http://tickets.localhost:4001/api/buy?qty=2", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
console.log(`HTTP ${r.res?.status ?? "-"} in ${(performance.now() - t).toFixed(0)} ms`);
if (r.ok) console.log(`settled · tx ${r.txHash}\n${r.explorerUrl}`);
else console.log(`not paid: ${r.error}`);
if (r.res) console.log((await r.res.text()).slice(0, 300));
process.exitCode = r.ok ? 0 : 1;
