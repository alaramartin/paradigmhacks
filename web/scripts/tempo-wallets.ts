// Creates three Tempo testnet (Moderato) wallets (payer, payee, attacker), funds each from the
// testnet faucet, and prints the .env lines for PAY_RAIL=mpp. Same faucet as `mppx account fund`
// (viem/tempo Actions.faucet), but the keys come out as .env lines instead of going to the keychain.
// If .env already has TEMPO_PAYER_PRIVATE_KEY, nothing is regenerated: it tops up the payer and prints the addresses.
// `npm run tempo-wallets -- --fund 0x…` only funds an existing address.
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { waitForTransactionReceipt } from "viem/actions";
import { tempoModerato } from "viem/chains";
import { Actions } from "viem/tempo";

const PATH_USD = "0x20c0000000000000000000000000000000000000"; // mppx's default testnet currency (6 decimals)
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
const client = createClient({ chain: tempoModerato, transport: http() });

async function fund(address: `0x${string}`) {
    const hashes = await Actions.faucet.fund(client, { account: address });
    await Promise.all(hashes.map((hash) => waitForTransactionReceipt(client, { hash })));
    const { formatted } = await balanceOf(address);
    return { hashes, formatted };
}

async function balanceOf(address: `0x${string}`) {
    return Actions.token.getBalance(client, { account: address, token: PATH_USD }); // { amount, decimals, formatted }
}

const i = process.argv.indexOf("--fund");
if (i >= 0) {
    const address = process.argv[i + 1] as `0x${string}`;
    if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) throw new Error("usage: npm run tempo-wallets -- --fund 0x<address>");
    const { formatted } = await fund(address);
    console.log(`funded ${address}: ${formatted} pathUSD (Tempo testnet)`);
    process.exit(0);
}

if (process.env.TEMPO_PAYER_PRIVATE_KEY) {
    const payer = privateKeyToAccount(process.env.TEMPO_PAYER_PRIVATE_KEY as `0x${string}`).address;
    const { formatted } = await fund(payer);
    console.log(`.env already has Tempo wallets (not regenerated). Topped up the payer.
payer    ${payer}: ${formatted} pathUSD (Tempo testnet)
payee    ${process.env.TEMPO_PAYEE_ADDRESS}
attacker ${process.env.TEMPO_ATTACKER_ADDRESS}
${tempoModerato.blockExplorers.default.url}/address/${payer}`);
    process.exit(0);
}

const roles = ["payer", "payee", "attacker"] as const;
const keys = Object.fromEntries(roles.map((r) => [r, generatePrivateKey()])) as Record<(typeof roles)[number], `0x${string}`>;
const addr = (r: (typeof roles)[number]) => privateKeyToAccount(keys[r]).address;

for (const r of roles) {
    try {
        const { formatted } = await fund(addr(r));
        console.error(`${r.padEnd(8)} ${addr(r)}: ${formatted} pathUSD`);
    } catch (e) {
        console.error(`${r.padEnd(8)} ${addr(r)}: faucet failed (${(e as Error).message.split("\n")[0]}); fund later with --fund`);
    }
}

console.log(`
# Tempo testnet (Moderato, chain 42431). Explorer: ${tempoModerato.blockExplorers.default.url}/address/${addr("payer")}
PAY_RAIL=mpp
MPP_SECRET_KEY=${randomBytes(32).toString("base64")}
TEMPO_PAYER_PRIVATE_KEY=${keys.payer}
TEMPO_PAYEE_ADDRESS=${addr("payee")}
TEMPO_ATTACKER_ADDRESS=${addr("attacker")}`);
