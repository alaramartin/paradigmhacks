// npm run reset-demo — put every flow back to its starting state.
//   hub:     pattern history, learned units, HUD counters (Tab did / You did) back to zero,
//            and saved workflows (~/.tab/workflows.json) unless `-- --keep-workflows`
//   tracker: all six tickets back to "In review"
//   GitHub:  close the demo PR, delete the remote fix/checkout-rounding branch, and leave the local
//            branch with its 2 unpushed commits (no upstream), so `git push -u ...` prints the PR link again.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import WebSocket from "ws";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
const REPO = process.env.GITHUB_DEMO_REPO;
const CLONE = (process.env.GITHUB_DEMO_CLONE || "~/Projects/tab-demo").replace(/^~/, homedir());
const BRANCH = "fix/checkout-rounding";

const run = (cmd: string, args: string[], cwd?: string) => {
    try {
        return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (e) {
        return `ERR ${(e as { stderr?: string }).stderr?.trim() || (e as Error).message}`;
    }
};

// Hub: pattern history, learned units and HUD counters (else a second rehearsal starts at "Do the remaining 5").
// A full reset also forgets saved workflows, so flow 3 starts with "teach once"; --keep-workflows keeps them
// for the recall beat ("Do all 6 from v1.4.0").
const keepWorkflows = process.argv.includes("--keep-workflows");
const hubReset = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${process.env.HUB_PORT ?? 7800}`);
    const t = setTimeout(() => (ws.terminate(), resolve(false)), 2000);
    ws.on("open", () => {
        ws.send(JSON.stringify({ type: "hello", role: "tool" }));
        ws.send(JSON.stringify({ type: "reset", keepWorkflows }));
        setTimeout(() => (clearTimeout(t), ws.close(), resolve(true)), 200);
    });
    ws.on("error", () => (clearTimeout(t), resolve(false)));
});
// If the hub isn't running, forget saved workflows on disk ourselves.
const wfFile = process.env.TAB_WORKFLOWS_FILE || `${homedir()}/.tab/workflows.json`;
if (!hubReset && !keepWorkflows && existsSync(wfFile)) rmSync(wfFile);
console.log(`hub: ${hubReset ? "reset" : "not running"}${keepWorkflows ? ", saved workflows kept" : ", saved workflows forgotten"}`);

// Tracker
const r = await fetch("http://tracker.localhost:4003/api/reset", { method: "POST" }).catch(() => null);
console.log(`tracker: ${r?.ok ? "reset" : "not running (start it with npm run demo)"}`);

if (!REPO) {
    console.log("GitHub: GITHUB_DEMO_REPO not set, skipped");
    process.exit(0);
}
// Open PRs from the demo branch
const prs = run("gh", ["pr", "list", "--repo", REPO, "--head", BRANCH, "--state", "open", "--json", "number", "--jq", ".[].number"]);
for (const n of prs.split("\n").filter((x) => /^\d+$/.test(x))) console.log(`PR #${n}: ${run("gh", ["pr", "close", n, "--repo", REPO]) || "closed"}`);
// Remote branch
const del = run("gh", ["api", "-X", "DELETE", `repos/${REPO}/git/refs/heads/${BRANCH}`]);
console.log(`remote ${BRANCH}: ${del.startsWith("ERR") ? (del.includes("Reference does not exist") ? "already gone" : del) : "deleted"}`);
// Local clone
if (!existsSync(CLONE)) {
    console.log(`local clone ${CLONE}: missing (set GITHUB_DEMO_CLONE)`);
    process.exit(0);
}
run("git", ["checkout", "-q", BRANCH], CLONE);
run("git", ["branch", "--unset-upstream"], CLONE);
run("git", ["fetch", "-q", "--prune", "origin"], CLONE);
const ahead = run("git", ["rev-list", "--count", `origin/main..${BRANCH}`], CLONE);
console.log(`local ${BRANCH}: ${ahead} commits ahead of main, no upstream${ahead === "2" ? "" : " (expected 2!)"}`);
