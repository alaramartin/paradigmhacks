// npm run capture -- <url-substring> <fixture-name>
// Writes the latest real state the hub received for a page to protocol/fixtures/<name>.json.
// Needs the hub and web running and the page open in the debug Chrome.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const [match, name] = process.argv.slice(2);
if (!match || !name) throw new Error("usage: npm run capture -- <url-substring> <fixture-name>");
const dir = new URL("../../brain/logs/", import.meta.url);
const latest = readdirSync(dir).filter((f) => f.startsWith("session-")).sort().at(-1);
if (!latest) throw new Error("no hub session log; is the hub running?");
const states = readFileSync(new URL(latest, dir), "utf8").trim().split("\n").map((l) => JSON.parse(l).msg).filter((m) => m.type === "state" && m.url?.includes(match));
const s = states.at(-1);
if (!s) throw new Error(`no state for a url containing "${match}" in ${latest}`);
const out = new URL(`../../protocol/fixtures/${name.replace(/\.json$/, "")}.json`, import.meta.url);
writeFileSync(out, JSON.stringify(s, null, 2) + "\n");
console.log(`${out.pathname}: ${s.url} · ${s.elements.length} elements`);
