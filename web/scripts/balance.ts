// Shows the payer's Base Sepolia USDC balance.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC (the asset in our 402s)
const payer = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY as `0x${string}`).address;
const client = createPublicClient({ chain: baseSepolia, transport: http() });
const raw = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [payer] });
console.log(`payer ${payer}: ${formatUnits(raw, 6)} USDC (Base Sepolia)`);
