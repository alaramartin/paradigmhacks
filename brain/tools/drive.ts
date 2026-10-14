// npm run drive — act as C (and frontmost from A) to play ticket 1 of the release-day flow into a running hub,
// so the hub and A can be tested before C exists. Prints what the hub sends back.
import WebSocket from "ws";
import { releaseState, trackerState, SEARCH, STATUS, PR, SAVE, resultEl, TRACKER_URL, CHROME } from "../test/synthetic.ts";
const ws = new WebSocket("ws://127.0.0.1:7800");
const send = (m: object) => ws.send(JSON.stringify(m));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
ws.on("open", async () => {
  send({ type: "hello", role: "tool" });
  send({ as: "shell", type: "frontmost", app: CHROME, window: "Tracker" });
  send({ as: "web", ...releaseState(Date.now()) });
  send({ as: "web", ...trackerState(Date.now()) });
  await sleep(1500);
  for (const [kind, el, v] of [["click", SEARCH], ["type", SEARCH, "ENG-142"], ["click", resultEl(0)], ["type", STATUS, "Done"], ["type", PR, "#12"], ["click", SAVE]] as const) {
    send({ as: "web", type: "user_event", source: "web", app: CHROME, url: TRACKER_URL, kind, target: el, value: v, ts: Date.now() });
    await sleep(300);
  }
  await sleep(1500);
  ws.close();
});
ws.on("message", (d) => { const m = JSON.parse(String(d)); if (m.msg?.type !== "hud") console.log("hub→", m.to, JSON.stringify(m.msg).slice(0, 160)); });
