// Loads the repo-root .env (shared by all agents) and exposes typed config.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const e = process.env;
export const env = {
    payerKey: (e.PAYER_PRIVATE_KEY || "") as `0x${string}` | "",
    payee: e.PAYEE_ADDRESS || "",
    attacker: e.ATTACKER_ADDRESS || "",
    network: (e.NETWORK || "eip155:84532") as `${string}:${string}`,
    facilitator: e.FACILITATOR_URL || "https://x402.org/facilitator",
    hubUrl: `ws://127.0.0.1:${e.HUB_PORT || 7800}`,
    cdpPort: Number(e.CDP_PORT || 9222),
    demoRepo: e.GITHUB_DEMO_REPO || "",
};

export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const explorerTx = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
