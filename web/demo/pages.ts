// HTML for the demo sites. Semantic markup only (no Tab-specific attributes); each site has its own look.
// Functional first pass by B overnight; the design-skill pass (PLAN "Design") is still to do.

const page = (title: string, css: string, body: string, script = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>*{box-sizing:border-box}body{margin:0}${css}</style></head>
<body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;

const money = (n: number) => `$${n.toFixed(2)}`;

// ---------------- tickets / resale ----------------

const TICKETS_CSS = {
    tickets: `
body{font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",sans-serif;background:#0e0e10;color:#f2f0ea}
header{display:flex;justify-content:space-between;align-items:center;padding:18px 32px;border-bottom:1px solid #26262b}
header .brand{font-weight:800;letter-spacing:.04em;text-transform:uppercase}
header nav a{color:#a9a6a0;text-decoration:none;margin-left:20px;font-size:14px}
main{max-width:720px;margin:0 auto;padding:40px 32px}
.kicker{color:#f5b54a;font-size:13px;letter-spacing:.12em;text-transform:uppercase}
h1{font-size:44px;line-height:1.05;margin:8px 0 6px;letter-spacing:-.02em}
.meta{color:#a9a6a0;margin:0 0 32px}
.panel{background:#18181c;border:1px solid #26262b;border-radius:14px;padding:24px}
.row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:10px 0}
.row+.row{border-top:1px solid #26262b}
label{color:#a9a6a0}
select{font:inherit;background:#0e0e10;color:#f2f0ea;border:1px solid #3a3a41;border-radius:8px;padding:8px 12px}
button.primary{font:inherit;font-weight:700;background:#f5b54a;color:#0e0e10;border:0;border-radius:10px;padding:12px 22px;cursor:pointer}
.total{font-size:22px;font-weight:700}
.tickets{display:grid;gap:12px;margin-top:24px}
.ticket{border:1px dashed #f5b54a;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between}
.note{color:#a9a6a0;font-size:14px}`,
    resale: `
body{font:15px/1.45 Verdana,Geneva,sans-serif;background:#f3f6fb;color:#1b2333}
header{background:#1d4ed8;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
header .brand{font-weight:700;font-size:20px}
header .brand small{font-weight:400;opacity:.8;font-size:12px;margin-left:6px}
header nav a{color:#dbe4ff;margin-left:16px;font-size:13px}
.banner{background:#fff3c4;color:#6b4e00;text-align:center;padding:6px;font-size:13px}
main{max-width:760px;margin:24px auto;padding:0 24px}
.kicker{color:#b91c1c;font-weight:700;font-size:12px;text-transform:uppercase}
h1{font-size:28px;margin:6px 0 4px}
.meta{color:#55607a;margin:0 0 20px}
.panel{background:#fff;border:1px solid #d5ddeb;border-radius:4px;padding:20px}
.row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:8px 0}
.row+.row{border-top:1px solid #e6ebf3}
label{color:#55607a}
select{font:inherit;border:1px solid #b9c4d8;border-radius:3px;padding:5px 8px;background:#fff}
button.primary{font:inherit;font-weight:700;background:#16a34a;color:#fff;border:0;border-radius:3px;padding:10px 20px;cursor:pointer}
.total{font-size:20px;font-weight:700}
.tickets{display:grid;gap:10px;margin-top:20px}
.ticket{background:#fff;border:1px solid #d5ddeb;border-left:4px solid #1d4ed8;padding:12px 16px;display:flex;justify-content:space-between}
.note{color:#55607a;font-size:13px}`,
};

function ticketsHeader(site: "tickets" | "resale") {
    return site === "tickets"
        ? `<header><span class="brand">Hall 9</span><nav><a href="/e/night-owls">Events</a><a href="#">Venue</a><a href="#">Sign in</a></nav></header>`
        : `<header><span class="brand">TixSwap<small>verified resale*</small></span><nav><a href="/e/night-owls">Browse</a><a href="#">Sell</a><a href="#">Help</a></nav></header><div class="banner">Prices may change at checkout. Limited availability!</div>`;
}

export function ticketsEvent(site: "tickets" | "resale", ga: number): string {
    return page(
        site === "tickets" ? "Night Owls · Hall 9" : "Night Owls tickets | TixSwap",
        TICKETS_CSS[site],
        `${ticketsHeader(site)}
<main>
  <p class="kicker">Live · Fri 9pm</p>
  <h1>Night Owls</h1>
  <p class="meta">Night Owls · live at Hall 9 · Fri 9pm</p>
  <section class="panel">
    <div class="row"><span>General admission</span><span>${money(ga)}</span></div>
    <div class="row"><label for="qty">Qty</label>
      <select id="qty" name="qty">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join("")}</select></div>
    <div class="row"><span class="note">All ages. Doors 8:30pm.</span><button class="primary" id="checkout" type="button">Checkout</button></div>
  </section>
</main>`,
        `document.getElementById("checkout").addEventListener("click",()=>{location.href="/checkout?qty="+document.getElementById("qty").value});`,
    );
}

export function ticketsCheckout(site: "tickets" | "resale", ga: number, qtyIn: number): string {
    const qty = Number.isInteger(qtyIn) && qtyIn >= 1 && qtyIn <= 4 ? qtyIn : 1;
    return page(
        site === "tickets" ? "Checkout · Hall 9" : "Checkout | TixSwap",
        TICKETS_CSS[site],
        `${ticketsHeader(site)}
<main>
  <p class="kicker">Checkout</p>
  <h1>Night Owls</h1>
  <p class="meta">${qty} × General admission · Fri 9pm</p>
  <section class="panel">
    <div class="row"><span>${qty} × General admission</span><span>${money(qty * ga)}</span></div>
    <div class="row"><span class="total">Total ${money(qty * ga)}</span><button class="primary" id="buy" type="button">Buy tickets</button></div>
  </section>
  <p class="note" id="status" role="status"></p>
  <ul class="tickets" id="tickets" aria-label="Your tickets"></ul>
</main>`,
        `const buy=document.getElementById("buy"),status=document.getElementById("status");
buy.addEventListener("click",async()=>{
  buy.disabled=true;status.textContent="Processing…";
  const r=await fetch("/api/buy?qty=${qty}",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
  if(r.status===402){status.textContent="Payment required. Use a wallet that supports x402 to pay.";buy.disabled=false;return}
  if(!r.ok){status.textContent="Something went wrong ("+r.status+").";buy.disabled=false;return}
  const {tickets}=await r.json();status.textContent="You're going! Show these at the door.";
  document.getElementById("tickets").innerHTML=tickets.map(t=>'<li class="ticket"><span><strong>'+t.show+'</strong> · '+t.venue+' · '+t.when+'</span><span>'+t.seat+' · '+t.code+'</span></li>').join("");
});`,
    );
}

// ---------------- tracker ----------------

export function trackerPage(): string {
    return page(
        "Tracker · Acme",
        `
body{font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;background:#fbfaf8;color:#2b2a27;display:grid;grid-template-columns:200px 1fr;min-height:100vh}
aside{border-right:1px solid #ebe8e2;padding:20px 16px;color:#6f6c66}
aside strong{display:block;color:#2b2a27;margin-bottom:16px}
aside a{display:block;color:inherit;text-decoration:none;padding:4px 0}
main{padding:24px 32px;position:relative}
h1{font-size:20px;font-weight:600;margin:0 0 16px}
input,select{font:inherit;border:1px solid #dcd8d0;border-radius:6px;padding:7px 10px;background:#fff;color:inherit}
#search{width:320px;margin-bottom:16px}
ul{list-style:none;margin:0;padding:0;border:1px solid #ebe8e2;border-radius:8px;background:#fff;max-width:720px}
li+li{border-top:1px solid #f0ede7}
li button{all:unset;box-sizing:border-box;display:flex;gap:16px;width:100%;padding:10px 14px;cursor:pointer}
li button:focus-visible{outline:2px solid #8a8378}
.id{color:#8a8378;width:72px;font-variant-numeric:tabular-nums}
.title{flex:1}
.status{color:#8a8378}
.status.done{color:#3f7d4e}
#panel{position:fixed;top:0;right:0;bottom:0;width:340px;background:#fff;border-left:1px solid #ebe8e2;padding:24px;display:none}
#panel.open{display:block}
#panel h2{font-size:16px;margin:0 0 4px}
#panel p{color:#8a8378;margin:0 0 20px}
#panel label{display:block;color:#6f6c66;margin:14px 0 6px}
#panel select,#panel input{width:100%}
#save{margin-top:22px;font:inherit;font-weight:600;background:#2b2a27;color:#fff;border:0;border-radius:6px;padding:9px 18px;cursor:pointer}`,
        `<aside><strong>Acme</strong><a href="#">Inbox</a><a href="#">My issues</a><a href="#">Release v1.4.0</a></aside>
<main>
  <h1>Release v1.4.0 · In review</h1>
  <input id="search" type="search" placeholder="Search tickets" aria-label="Search tickets" autocomplete="off">
  <ul id="list" aria-label="Tickets"></ul>
  <section id="panel" aria-label="Ticket details">
    <h2 id="p-id"></h2><p id="p-title"></p>
    <label for="p-status">Status</label>
    <select id="p-status" name="status"><option>Backlog</option><option>In review</option><option>Done</option></select>
    <label for="p-pr">Linked PR</label>
    <input id="p-pr" name="pr" type="text" placeholder="#123" autocomplete="off">
    <button id="save" type="button">Save</button>
  </section>
</main>`,
        `let tickets=[],open=null;const $=id=>document.getElementById(id);
async function load(){tickets=await (await fetch("/api/tickets")).json();render()}
function render(){const q=$("search").value.trim().toLowerCase();
  $("list").innerHTML=tickets.filter(t=>!q||(t.id+" "+t.title).toLowerCase().includes(q)).map(t=>'<li><button type="button" data-id="'+t.id+'"><span class="id">'+t.id+'</span><span class="title">'+t.title+'</span><span class="status'+(t.status==="Done"?" done":"")+'">'+t.status+(t.pr?" · "+t.pr:"")+'</span></button></li>').join("")}
$("search").addEventListener("input",render);
$("list").addEventListener("click",e=>{const b=e.target.closest("button[data-id]");if(!b)return;open=tickets.find(t=>t.id===b.dataset.id);
  $("p-id").textContent=open.id;$("p-title").textContent=open.title;$("p-status").value=open.status;$("p-pr").value=open.pr;$("panel").classList.add("open")});
$("save").addEventListener("click",async()=>{if(!open)return;
  await fetch("/api/tickets/"+open.id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:$("p-status").value,pr:$("p-pr").value})});
  $("panel").classList.remove("open");open=null;await load()});
load();`,
    );
}

// ---------------- inbox ----------------

export function inboxPage(): string {
    return page(
        "Inbox · Mail",
        `
body{font:14px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;background:#fff;color:#1f1f1f;display:grid;grid-template-columns:260px 1fr;min-height:100vh}
nav{background:#f6f6f4;border-right:1px solid #e8e8e4}
nav h1{font-size:15px;padding:18px 18px 8px;margin:0}
nav ul{list-style:none;margin:0;padding:0}
nav li{padding:12px 18px;border-top:1px solid #ecece8}
nav li.active{background:#fff}
nav .from{font-weight:600}
nav .sub{color:#6b6b66;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
article{padding:28px 40px;max-width:680px}
article h2{font-size:20px;margin:0 0 6px}
.hdr{color:#6b6b66;margin-bottom:24px}`,
        `<nav><h1>Inbox</h1><ul>
  <li class="active"><div class="from">Oak St Pharmacy</div><div class="sub">Your prescription is ready</div></li>
</ul></nav>
<article>
  <h2>Your prescription is ready</h2>
  <div class="hdr">Oak St Pharmacy · today 3:12 pm</div>
  <p>Hi,</p>
  <p>Rx 4471-209 is ready to refill at Oak St. Pick up after 5 pm.</p>
  <p>Want a heads-up? Ask us to text you when it's ready.</p>
  <p>Oak St Pharmacy</p>
</article>`,
    );
}

// ---------------- pharmacy ----------------

export function pharmacyPage(copay: number): string {
    return page(
        "Refill a prescription · CareRx",
        `
body{font:16px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;background:#f2f7f5;color:#17312a}
header{background:#fff;border-bottom:1px solid #dbe7e2;padding:16px 28px;font-weight:700;color:#1f6f5c}
main{max-width:560px;margin:32px auto;background:#fff;border:1px solid #dbe7e2;border-radius:16px;padding:28px 32px}
h1{font-size:24px;margin:0 0 4px}
.sub{color:#5b746c;margin:0 0 24px}
label,.lbl{display:block;font-weight:600;margin:18px 0 6px}
input[type=text],select{font:inherit;width:100%;border:1px solid #c5d6cf;border-radius:10px;padding:10px 12px;background:#fff;color:inherit}
.chips{list-style:none;display:flex;gap:8px;margin:0;padding:0}
.chips button{font:inherit;font-size:14px;border:1px solid #c5d6cf;background:#fff;border-radius:999px;padding:6px 14px;cursor:pointer}
.chips button[aria-pressed=true]{background:#1f6f5c;border-color:#1f6f5c;color:#fff}
.check{display:flex;align-items:center;gap:8px;font-size:13px;color:#5b746c;margin-top:18px;font-weight:400}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:26px}
.copay{color:#5b746c}
#submit{font:inherit;font-weight:700;background:#1f6f5c;color:#fff;border:0;border-radius:10px;padding:12px 22px;cursor:pointer}
#done{margin-top:18px;font-weight:600;color:#1f6f5c}`,
        `<header>CareRx</header>
<main>
  <h1>Refill a prescription</h1>
  <p class="sub">Pick up at any CareRx location.</p>
  <label for="rx">Rx number</label>
  <input id="rx" name="rx" type="text" placeholder="e.g. 1234-567" autocomplete="off">
  <label for="loc">Pickup location</label>
  <select id="loc" name="location"><option>Main St</option><option>Oak St</option><option>Elm Ave</option></select>
  <span class="lbl" id="time-lbl">Pickup time</span>
  <ul class="chips" aria-labelledby="time-lbl">
    <li><button type="button" aria-pressed="false">4:00 pm</button></li>
    <li><button type="button" aria-pressed="false">5:30 pm</button></li>
    <li><button type="button" aria-pressed="false">7:00 pm</button></li>
  </ul>
  <label class="check"><input id="sms" type="checkbox"> Text me when ready</label>
  <div class="foot"><span class="copay">Copay ${money(copay)}</span><button id="submit" type="button">Request refill</button></div>
  <p id="done" role="status"></p>
</main>`,
        `const $=id=>document.getElementById(id);let time=null;
document.querySelectorAll(".chips button").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".chips button").forEach(o=>o.setAttribute("aria-pressed","false"));b.setAttribute("aria-pressed","true");time=b.textContent}));
$("submit").addEventListener("click",async()=>{$("done").textContent="Sending…";
  const r=await fetch("/api/refill",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rx:$("rx").value,location:$("loc").value,time,sms:$("sms").checked})});
  if(r.status===402){$("done").textContent="Copay required to submit.";return}
  $("done").textContent=r.ok?"Refill requested ✓":"Something went wrong ("+r.status+")."});`,
    );
}
