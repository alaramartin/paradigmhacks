// npm run reset-demo — put every flow back to its starting state.
//   tracker: all six tickets back to "In review"
//   GitHub:  close the demo PR, delete the remote fix/checkout-rounding branch, and leave the local
//            branch with its 2 unpushed commits (no upstream), so `git push -u ...` prints the PR link again.
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

config({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });
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
