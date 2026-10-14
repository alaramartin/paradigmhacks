// Checks that every control the demo flows touch is on the first screen of a half-screen window (720×790, 960×790).
// Needs the demo server and Chrome on :9222.  npm run fold
import CDP from "chrome-remote-interface";
const pages = [["http://tickets.localhost:4001/e/night-owls", ["#qty", "#checkout"]], ["http://tickets.localhost:4001/checkout?qty=2", ["#buy"]], ["http://resale.localhost:4002/e/night-owls", ["#checkout"]], ["http://resale.localhost:4002/checkout?qty=2", ["#buy"]], ["http://tracker.localhost:4003/", ["#search", "#list li:nth-child(6) button"]], ["http://pharmacy.localhost:4005/refill", ["#submit"]]];
const t = await CDP.New({ port: 9222, url: "about:blank" });
const c = await CDP({ port: 9222, target: t.id });
await c.Page.enable(); await c.Page.bringToFront();
for (const [w, h] of [[720, 790], [960, 790]]) {
  await c.Emulation.setDeviceMetricsOverride({ width: w, height: h, deviceScaleFactor: 1, mobile: false });
  for (const [url, sels] of pages) {
    const l = c.Page.loadEventFired(); await c.Page.navigate({ url }); await l; await new Promise((r) => setTimeout(r, 900));
    const { result } = await c.Runtime.evaluate({ expression: `JSON.stringify(${JSON.stringify(sels)}.map(s => Math.round(document.querySelector(s).getBoundingClientRect().bottom)))`, returnByValue: true });
    const b = JSON.parse(result.value);
    console.log(`${w}x${h} ${url.replace("http://", "").padEnd(42)} ${sels.map((s, i) => `${s}=${b[i]}${b[i] > h ? " BELOW" : ""}`).join("  ")}`);
  }
}
await c.close(); await CDP.Close({ port: 9222, id: t.id });
