// Shows the payer's Base Sepolia USDC balance.
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { env, USDC_BASE_SEPOLIA } from "../src/env.ts";

if (!env.payerKey) throw new Error("PAYER_PRIVATE_KEY missing in .env (run npm run wallets)");
const who = (process.argv[2] as `0x${string}`) || privateKeyToAccount(env.payerKey).address;
const client = createPublicClient({ chain: baseSepolia, transport: http() });
const raw = await client.readContract({ address: USDC_BASE_SEPOLIA, abi: erc20Abi, functionName: "balanceOf", args: [who] });
console.log(`${who}: ${formatUnits(raw, 6)} USDC (Base Sepolia)`);
