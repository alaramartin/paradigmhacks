// Launches Chrome with remote debugging on a separate profile (Chrome refuses it on the default one).
//   macOS: open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/tab-chrome
//   --headless runs it headless (agents' look-and-try without a display); extra args pass through.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "../src/env.ts";

const headless = process.argv.includes("--headless");
const extra = process.argv.slice(2).filter((a) => a !== "--headless");
const profile = process.platform === "darwin" ? "/tmp/tab-chrome" : join(tmpdir(), headless ? "tab-chrome-headless" : "tab-chrome");
const args = [`--remote-debugging-port=${env.cdpPort}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", ...(headless ? ["--headless=new", "--window-size=960,1000"] : []), ...extra];

const bin =
    process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : process.platform === "win32"
          ? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync)!
          : "google-chrome";
if (process.platform === "darwin" && !headless) spawn("open", ["-na", "Google Chrome", "--args", ...args], { stdio: "inherit" });
else spawn(bin, args, { stdio: "ignore", detached: true }).unref();
console.log(`Chrome on :${env.cdpPort} · profile ${profile}${headless ? " · headless" : ""}`);
