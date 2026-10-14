// Prints three fresh testnet keys: payer, payee, attacker. Paste into the repo-root .env.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const mk = () => {
    const key = generatePrivateKey();
    return { key, address: privateKeyToAccount(key).address };
};
const payer = mk(), payee = mk(), attacker = mk();
console.log(`PAYER_PRIVATE_KEY=${payer.key}
# payer address: ${payer.address}  ← fund this with Base Sepolia USDC (https://faucet.circle.com)
PAYEE_ADDRESS=${payee.address}
ATTACKER_ADDRESS=${attacker.address}`);
