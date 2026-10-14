// Checks that every control the demo flows touch is on the first screen of a half-screen window: 720 and 960 wide,
// 790 tall and 707 tall (what a full-height half-screen window actually shows on alara's Mac, measured by B). Exit 1 if not.
// Needs the demo server and Chrome on :9222.  npm run fold [-- --no-webfonts]  (blocks the font CDNs: what bad wifi shows)
import CDP from "chrome-remote-interface";
const pages = [["http://tickets.localhost:4001/e/night-owls", ["#qty", "#checkout"]], ["http://tickets.localhost:4001/checkout?qty=2", ["#buy"]], ["http://resale.localhost:4002/e/night-owls", ["#checkout"]], ["http://resale.localhost:4002/checkout?qty=2", ["#buy"]], ["http://tracker.localhost:4003/", ["#search", "#list li:nth-child(6) button"]], ["http://pharmacy.localhost:4005/refill", ["#rx", "#loc", ".chips li:nth-child(3) button", "#sms", "#submit"]]];
const t = await CDP.New({ port: 9222, url: "about:blank" });
const c = await CDP({ port: 9222, target: t.id });
await c.Page.enable(); await c.Page.bringToFront();
if (process.argv.includes("--no-webfonts")) { await c.Network.enable(); await c.Network.setBlockedURLs({ urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*fontshare.com*"] }); }
let below = 0;
for (const [w, h] of [[720, 790], [960, 790], [720, 707], [960, 707]]) {
  await c.Emulation.setDeviceMetricsOverride({ width: w, height: h, deviceScaleFactor: 1, mobile: false });
  for (const [url, sels] of pages) {
    const l = c.Page.loadEventFired(); await c.Page.navigate({ url }); await l; await new Promise((r) => setTimeout(r, 900));
    const { result } = await c.Runtime.evaluate({ expression: `JSON.stringify(${JSON.stringify(sels)}.map(s => Math.round(document.querySelector(s).getBoundingClientRect().bottom)))`, returnByValue: true });
    const b = JSON.parse(result.value);
    below += b.filter((y) => y > h).length;
    console.log(`${w}x${h} ${url.replace("http://", "").padEnd(42)} ${sels.map((s, i) => `${s}=${b[i]}${b[i] > h ? " BELOW" : ""}`).join("  ")}`);
  }
}
await c.close(); await CDP.Close({ port: 9222, id: t.id });
console.log(below ? `${below} control(s) below the fold` : "every control fits");
process.exitCode = below ? 1 : 0;
