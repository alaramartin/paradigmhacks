// Shows the payer's balance on the rail PAY_RAIL picks: mpp → pathUSD on Tempo testnet, x402 → USDC on Base Sepolia.
// Prints one line, `payer 0x…: <amount> <TOKEN> (…)`; shell/scripts/preflight.sh reads the first `<amount> <token>`.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { createClient, createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, tempoModerato } from "viem/chains";
import { Actions } from "viem/tempo";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
const rail = (process.env.PAY_RAIL || "mpp").toLowerCase(); // same default as src/rail.ts

if (rail === "mpp") {
    const PATH_USD = "0x20c0000000000000000000000000000000000000"; // mppx's default testnet currency (TIP-20, 6 decimals)
    const payer = privateKeyToAccount(process.env.TEMPO_PAYER_PRIVATE_KEY as `0x${string}`).address;
    const client = createClient({ chain: tempoModerato, transport: http() });
    const { formatted } = await Actions.token.getBalance(client, { account: payer, token: PATH_USD });
    console.log(`payer ${payer}: ${formatted} pathUSD (Tempo testnet)`);
} else {
    const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC (the asset in our 402s)
    const payer = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY as `0x${string}`).address;
    const client = createPublicClient({ chain: baseSepolia, transport: http() });
    const raw = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [payer] });
    console.log(`payer ${payer}: ${formatUnits(raw, 6)} USDC (Base Sepolia)`);
}
