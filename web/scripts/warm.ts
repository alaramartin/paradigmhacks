// npm run warm — fill Jev's answer cache (~/.tab/jev-cache.json) on the network you'll present on.
// The cache replays Jev's earlier answer for the same screen when a live call is slow or fails (venue wifi), but
// only for screens Jev has answered before: so run every flow once through the real hub, on the demo network.
// Needs the hub, npm run demo, npm start and the debug Chrome running; quit TabShell first (this plays the shell).
// Creates and then closes a real PR on GITHUB_DEMO_REPO (flow 2). Ends with a full reset-demo.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../", import.meta.url));
const cacheFile = process.env.TAB_JEV_CACHE || `${homedir()}/.tab/jev-cache.json`;
const entries = () => (existsSync(cacheFile) ? Object.keys(JSON.parse(readFileSync(cacheFile, "utf8"))).length : 0);
const run = (args: string[]) => spawnSync("npx", ["tsx", ...args], { cwd: web, stdio: "inherit" }).status === 0;

const before = entries();
let ok = true;
for (const flow of ["all", "flow2"]) {
    run(["scripts/reset-demo.ts"]);
    ok = run(["scripts/try.ts", flow]) && ok;
}
run(["scripts/reset-demo.ts"]);
console.log(`\nJev cache: ${before} → ${entries()} screens (${cacheFile})${ok ? "" : "  (some checks failed: see above; payments need funds, Jev may have been slow)"}`);
