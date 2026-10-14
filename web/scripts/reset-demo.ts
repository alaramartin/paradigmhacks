// One command back to the starting state of the demo:
//   1. the demo sites (the tracker's tickets back to "In review"),
//   2. flow 2's GitHub state: close the demo PR, delete the remote branch, and leave the local
//      branch with its 2 unpushed commits and no upstream.
//   npm run reset-demo [-- --dry-run] [--repo-dir <path to local clone>]
// Needs `gh auth login` and GITHUB_DEMO_REPO (owner/name) in .env for step 2; DEMO_REPO_DIR or
// --repo-dir points at the local clone (default ~/tab-demo).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { env } from "../src/env.ts";
import { localFetch } from "../src/localfetch.ts";

const BRANCH = "fix/checkout-rounding";
const dry = process.argv.includes("--dry-run");
const argAt = process.argv.indexOf("--repo-dir");
const repoDir = argAt > 0 ? process.argv[argAt + 1] : process.env.DEMO_REPO_DIR || join(homedir(), "tab-demo");
let problems = 0;

function run(cmd: string, args: string[], cwd?: string, mutates = true): string | null {
    const shown = `${cmd} ${args.join(" ")}`;
    if (dry && mutates) {
        console.log(`  (dry run) ${shown}`);
        return "";
    }
    try {
        return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (e: any) {
        console.log(`  ✗ ${shown}: ${String(e.stderr || e.message).trim().split("\n")[0]}`);
        return null;
    }
}

console.log("Demo sites");
for (const [name, port] of [["tickets", 4001], ["resale", 4002], ["tracker", 4003], ["inbox", 4004], ["pharmacy", 4005]] as const) {
    if (dry) {
        console.log(`  (dry run) POST ${name}.localhost:${port}/api/reset`);
        continue;
    }
    try {
        const r = await localFetch(`http://${name}.localhost:${port}/api/reset`, { method: "POST" });
        console.log(`  ${r.ok ? "✓" : "✗"} ${name} reset`);
        if (!r.ok) problems++;
    } catch {
        console.log(`  ✗ ${name}: demo server not running (npm run demo)`);
        problems++;
    }
}

console.log(`GitHub (${env.demoRepo || "GITHUB_DEMO_REPO not set"})`);
if (!env.demoRepo) {
    console.log("  skipped: set GITHUB_DEMO_REPO=owner/name in .env");
    problems++;
} else {
    const prs = run("gh", ["pr", "list", "-R", env.demoRepo, "--head", BRANCH, "--state", "open", "--json", "number", "-q", ".[].number"], undefined, false);
    if (prs === null) problems++;
    for (const n of (prs ?? "").split(/\s+/).filter(Boolean)) {
        if (run("gh", ["pr", "close", n, "-R", env.demoRepo]) !== null) console.log(`  ✓ closed PR #${n}`);
        else problems++;
    }
    if (!prs) console.log("  ✓ no open PR");
    const remote = run("gh", ["api", `repos/${env.demoRepo}/branches/${BRANCH}`, "-q", ".name"], undefined, false);
    if (remote) {
        if (run("gh", ["api", "-X", "DELETE", `repos/${env.demoRepo}/git/refs/heads/${BRANCH}`]) !== null) console.log(`  ✓ deleted remote ${BRANCH}`);
        else problems++;
    } else console.log(`  ✓ no remote ${BRANCH}`);
}

console.log(`Local clone (${repoDir})`);
if (!existsSync(join(repoDir, ".git"))) {
    console.log("  skipped: no clone there (set DEMO_REPO_DIR or pass --repo-dir)");
    problems++;
} else {
    const git = (...a: string[]) => run("git", a, repoDir);
    const gitRead = (...a: string[]) => run("git", a, repoDir, false);
    if (gitRead("status", "--porcelain")) console.log("  ! working tree has changes; leaving them alone");
    git("checkout", "-q", BRANCH);
    git("fetch", "-q", "--prune", "origin");
    run("git", ["branch", "--unset-upstream", BRANCH], repoDir); // fails harmlessly when none is set
    const ahead = gitRead("rev-list", "--count", `origin/main..${BRANCH}`);
    if (ahead === "2") console.log(`  ✓ ${BRANCH} has 2 unpushed commits, no upstream`);
    else {
        console.log(`  ✗ ${BRANCH} is ${ahead ?? "?"} commits ahead of origin/main (expected 2)`);
        problems++;
    }
}

console.log(problems ? `\n${problems} step(s) need attention.` : "\nReady for the demo.");
process.exitCode = problems ? 1 : 0;
