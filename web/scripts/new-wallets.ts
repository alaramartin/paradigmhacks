// Prints three fresh testnet wallets (payer, payee, attacker) as .env lines. Testnet only.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const payer = generatePrivateKey();
const payee = privateKeyToAccount(generatePrivateKey()).address;
const attacker = privateKeyToAccount(generatePrivateKey()).address;
console.log(`PAYER_PRIVATE_KEY=${payer}`);
console.log(`# payer address (fund this with Base Sepolia USDC): ${privateKeyToAccount(payer).address}`);
console.log(`PAYEE_ADDRESS=${payee}`);
console.log(`ATTACKER_ADDRESS=${attacker}`);
