// Buys 2 tickets through Node alone (no browser) and prints the tx hash.
// Needs the demo server running (npm run demo) and a funded payer.
import { explorerTx } from "../src/env.ts";
import { decodeSettle, payer } from "../src/payer.ts";
import { localFetch } from "../src/localfetch.ts";

const url = process.argv[2] || "http://tickets.localhost:4001/api/buy";
const init = { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ qty: 2 }) };

const probe = await localFetch(url, init);
console.log(`unpaid: ${probe.status}`);

const { payFetch, address } = payer();
console.log(`payer: ${address}`);
const t0 = Date.now();
const res = await payFetch(url, init);
const body = await res.text();
console.log(`paid: ${res.status} in ${Date.now() - t0} ms`);
if (!res.ok) {
    console.error(body.slice(0, 500));
    for (const [k, v] of res.headers) if (/payment/i.test(k)) console.error(`${k}: ${v.slice(0, 400)}`);
    process.exit(1);
}
const settle = decodeSettle((n) => res.headers.get(n));
console.log(`tx: ${settle.transaction}\n${explorerTx(settle.transaction)}`);
console.log(body.slice(0, 300));
