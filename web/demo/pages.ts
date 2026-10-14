// HTML for the demo sites. Semantic markup only (no Tab-specific attributes); each site has its own look.
// Design pass (C): tickets and resale with design-taste-frontend (tickets "Loud and flat", resale
// "The contact sheet"), pharmacy's direction from it ("The split stage"), tracker and inbox with
// minimalist-ui. Styles and pictures live in demo/static/. Element ids, request shapes and the
// copy the brain reads are unchanged from B's functional pass.
// Rule for every page: nothing interactive moves after first paint (ghost rects come from the DOM).

// A one-letter favicon per site, in its own colours.
const icon = (ch: string, bg: string, fg: string) =>
    `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='${bg}'/><text x='16' y='23' font-family='Arial' font-weight='700' font-size='20' text-anchor='middle' fill='${fg}'>${ch}</text></svg>`,
    )}">`;

const page = (title: string, head: string, body: string, script = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${title}">${head}</head>
<body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;

const fonts = {
    cabinet: `<link rel="preconnect" href="https://api.fontshare.com"><link rel="preconnect" href="https://cdn.fontshare.com" crossorigin><link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,800&display=swap" rel="stylesheet">`,
    work: `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@300;400;500&display=swap" rel="stylesheet">`,
    geist: `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Newsreader:opsz,wght@6..72,500&display=swap" rel="stylesheet">`,
    gambarino: `<link rel="preconnect" href="https://api.fontshare.com"><link rel="preconnect" href="https://cdn.fontshare.com" crossorigin><link href="https://api.fontshare.com/v2/css?f[]=gambarino@400&display=swap" rel="stylesheet"><link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500&display=swap" rel="stylesheet">`,
};
const css = (href: string) => `<link rel="stylesheet" href="/static/${href}">`;

const money = (n: number) => `$${n.toFixed(2)}`;

// ---------------- tickets / resale ----------------

const T = "/static/tickets";
const R = "/static/resale";

function hall9Event(ga: number): string {
    return `<main>
  <section class="hero" aria-label="Night Owls at Hall 9">
    <header class="top"><a class="mark" href="/e/night-owls">Hall 9</a><a href="#tickets">Box office</a></header>
    <h1 class="statement in"><span>Night</span><span>Owls</span></h1>
    <p class="when in d1">Friday 9 pm, Hall 9</p>
    <div class="spacer"></div>
    <section class="boxoffice" id="tickets" aria-label="Box office">
      <p class="price">General admission <b>${money(ga)}</b></p>
      <label class="field" for="qty">Qty
        <select id="qty" name="qty">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join("")}</select>
      </label>
      <button class="btn" id="checkout" type="button">Checkout</button>
      <p class="note">Standing, four per order. Paid in USDC.</p>
    </section>
    <img class="cutout in d2" src="${T}/owl.jpg" width="1530" height="2250" alt="A porcelain owl from the Bow factory, about 1760">
    <p class="aside in d3">Doors at eight. Night Owls play from quarter past nine until the curfew at eleven.</p>
  </section>

  <section class="panel p-black" aria-labelledby="friday">
    <div class="list">
      <h2 class="giant in" id="friday">friday</h2>
      <div class="bars">
        <details open><summary>Running order</summary>
          <dl><div><dt>Doors</dt><dd>8:00 pm</dd></div><div><dt>The Lanterns</dt><dd>8:30 pm</dd></div><div><dt>Night Owls</dt><dd>9:15 pm</dd></div><div><dt>Curfew</dt><dd>11:00 pm</dd></div></dl></details>
        <details><summary>Tickets</summary>
          <dl><div><dt>General admission, standing</dt><dd>${money(ga)}</dd></div><div><dt>Most per order</dt><dd>4</dd></div><div><dt>Booking fee</dt><dd>none</dd></div></dl></details>
        <details><summary>At the door</summary>
          <dl><div><dt>Show your ticket on your phone</dt><dd>door 2</dd></div><div><dt>Age</dt><dd>16 and over</dd></div><div><dt>Cloakroom</dt><dd>$1</dd></div></dl></details>
        <details><summary>Access</summary>
          <dl><div><dt>Step-free entry</dt><dd>door 1</dd></div><div><dt>Viewing platform</dt><dd>stage left</dd></div><div><dt>Companion ticket</dt><dd>free</dd></div></dl></details>
      </div>
    </div>
  </section>

  <section class="panel p-yellow" aria-labelledby="hall">
    <div class="strip" aria-hidden="true"><div class="track">
      ${["the-concert-hall-monte-carlo-a-book.jpg|1920|1378", "postcard-queen-elizabeth-theatre-c-1959.jpg|1024|637", "ornament-with-owl-mocked-by-day-birds.jpg|1600|2275", "owl.jpg|1530|2250"]
          .concat(["the-concert-hall-monte-carlo-a-book.jpg|1920|1378", "postcard-queen-elizabeth-theatre-c-1959.jpg|1024|637", "ornament-with-owl-mocked-by-day-birds.jpg|1600|2275", "owl.jpg|1530|2250"]) // twice, for a seamless loop
          .map((x) => {
              const [f, w, h] = x.split("|");
              return `<img src="${T}/${f}" width="${w}" height="${h}" alt="" loading="lazy">`;
          })
          .join("")}
    </div></div>
    <div class="venue">
      <div>
        <h2 class="in" id="hall">The ninth shed on Dock Road</h2>
        <p class="in d1">Hall 9 was a grain shed until 1987. It holds 600 standing, the bar runs along the back wall, and the sound carries all the way to it.</p>
        <div class="cells in d2">
          <div><b>Dock Road 9</b>by the ferry pier</div>
          <div><b>Last ferry 11:40</b>forty minutes after curfew</div>
          <div><b>Night bus N9</b>every 15 minutes</div>
        </div>
      </div>
      <img class="engraving in d3" src="${T}/ornament-with-owl-mocked-by-day-birds.jpg" width="1600" height="2275" alt="Engraving of an owl mobbed by day birds, Martin Schongauer, about 1474" loading="lazy">
    </div>
  </section>

  <footer class="close">
    <h2 class="in">See you on Friday</h2>
    <a class="btn" href="#tickets">Get tickets</a>
    <div class="legal">
      <p class="credits">Pictures: “Owl”, Bow Porcelain Factory, c. 1760, and “Ornament with Owl Mocked by Day Birds”, Martin Schongauer, c. 1474, both public domain (CC0) via the Art Institute of Chicago; “The Concert Hall, Monte Carlo”, Jean Gilletta, public domain via Wikimedia Commons; “Postcard: Queen Elizabeth Theatre, c.1959”, blizzy63, public domain via Flickr.</p>
      <p>Hall 9 box office</p>
    </div>
    <p class="name" aria-hidden="true">night owls</p>
  </footer>
</main>`;
}

function tixswapEvent(ga: number): string {
    const fig = (f: string, w: number, h: number, alt: string, cap: string) => `<figure><img src="${R}/${f}" width="${w}" height="${h}" alt="${alt}"><figcaption>${cap}</figcaption></figure>`;
    const frames = (fs: string[]) => fs.map((f) => `<img src="${R}/${f}" width="960" height="640" alt="" loading="lazy">`).join("");
    return `<main>
  <section class="hero" aria-label="Night Owls resale tickets">
    <header class="corner"><a class="mark" href="/e/night-owls">Tix<b>Swap</b></a><a href="#more">Sell your tickets</a></header>
    <h1 class="in">Night Owls, sold out. Not here.</h1>
    <div class="strip in d1" aria-label="Photos">
      ${fig("concert-show.jpg", 960, 638, "A singer under blue stage lights", "Night Owls · Hall 9 · Fri 9 pm")}
      ${fig("crowd-people.jpg", 960, 640, "A crowd with hands raised", "Standing floor")}
      ${fig("music-concert.jpg", 960, 720, "A guitarist on a dark stage", "Last 4 left")}
      ${fig("crowd-audience.jpg", 960, 640, "An audience facing a lit stage", "Verified listing")}
      ${fig("concert-festival.jpg", 960, 640, "A festival crowd at dusk", "Instant delivery")}
    </div>
    <div class="buy">
      <p class="what in d2"><strong>Night Owls · Hall 9 · Fri 9 pm</strong>General admission, resold by a verified fan. 14 people are looking at this show.</p>
      <div class="order">
        <p class="price-tag">${money(ga)}<small>each</small></p>
        <label class="field" for="qty">Qty
          <select id="qty" name="qty">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join("")}</select>
        </label>
        <button class="btn" id="checkout" type="button">Checkout</button>
      </div>
    </div>
  </section>
  <section class="sheet" id="more" aria-labelledby="more-h">
    <h2 class="in" id="more-h">More resale this week</h2>
    <div class="runs">
      <div class="run in"><p>Paper Lanterns<span>Hall 9 · Sat 8 pm · from $0.22</span></p><div class="frames">${frames(["crowd-audience.jpg", "concert-show-2.jpg", "crowd-people.jpg", "concert-festival.jpg"])}</div></div>
      <div class="run in"><p>Low Tide Choir<span>The Pier · Sun 7 pm · from $0.18</span></p><div class="frames">${frames(["concert-festival.jpg", "crowd-audience.jpg", "concert-show-2.jpg", "crowd-people.jpg"])}</div></div>
      <div class="run in"><p>Static Bloom<span>Warehouse 3 · Tue 9 pm · from $0.31</span></p><div class="frames">${frames(["crowd-people.jpg", "concert-festival.jpg", "crowd-audience.jpg", "concert-show-2.jpg"])}</div></div>
    </div>
  </section>
  <section class="faq" aria-labelledby="faq-h">
    <h2 class="in" id="faq-h">Before you buy</h2>
    <details class="in"><summary>Are these tickets real?</summary><p>Every seller is verified by email. If a ticket doesn't scan, contact us within 30 days of the show.</p></details>
    <details class="in"><summary>Why is the price different at payment?</summary><p>Service and delivery fees are calculated at payment and may change with demand.</p></details>
    <details class="in"><summary>Can I get a refund?</summary><p>All resale is final. You can relist your tickets on TixSwap up to one hour before doors, at any price you like.</p></details>
  </section>
</main>
<footer>
  <p class="big in" aria-hidden="true">TixSwap</p>
  <div class="legal"><p>Photos: “Crowd People”, Anthony Delanoix; “Concert Show”, John Price; “Concert Show”, Nainoa Shizuru; “Music Concert”, Paweł Bukowski; “Crowd Audience”, donterase; “Concert Festival”, Burst. All CC0 via StockSnap.</p><p>TixSwap is not the venue.</p></div>
</footer>`;
}

export function ticketsEvent(site: "tickets" | "resale", ga: number): string {
    return page(
        site === "tickets" ? "Night Owls · Hall 9 · Friday 9 pm" : "Night Owls tickets | TixSwap",
        site === "tickets" ? fonts.cabinet + css("tickets/site.css") : fonts.work + css("resale/site.css"),
        site === "tickets" ? hall9Event(ga) : tixswapEvent(ga),
        `document.getElementById("checkout").addEventListener("click",()=>{location.href="/checkout?qty="+document.getElementById("qty").value});`,
    );
}

export function ticketsCheckout(site: "tickets" | "resale", ga: number, qtyIn: number): string {
    const qty = Number.isInteger(qtyIn) && qtyIn >= 1 && qtyIn <= 4 ? qtyIn : 1;
    const hall9 = site === "tickets";
    const body = hall9
        ? `<header class="bar"><a class="mark" href="/e/night-owls">Hall 9</a><span>Box office</span></header>
<main class="co">
  <div>
    <h1>Night Owls</h1>
    <p class="sub">Friday 9 pm, Hall 9, Dock Road</p>
    <ul class="tickets" id="tickets" aria-label="Your tickets"></ul>
    <p class="paid" id="paid" hidden></p>
    <figure class="co-pic"><img src="${T}/ornament-with-owl-mocked-by-day-birds.jpg" width="1600" height="2275" alt="Engraving of an owl mobbed by day birds, Martin Schongauer, about 1474"></figure>
  </div>
  <section class="summary" aria-label="Your order">
    <p class="row"><span>${qty} × General admission</span><span>${money(ga)} each</span></p>
    <p class="row"><span>Booking fee</span><span>$0.00</span></p>
    <p class="row total"><span>Total</span><span>${money(qty * ga)}</span></p>
    <button class="btn" id="buy" type="button">Buy tickets</button>
    <p class="status" id="status" role="status"></p>
  </section>
</main>`
        : `<header class="corner"><a class="mark" href="/e/night-owls">Tix<b>Swap</b></a><span>Secure checkout</span></header>
<main class="co">
  <div>
    <h1>Night Owls</h1>
    <p class="sub">Hall 9 · Fri 9 pm · resold by a verified fan</p>
    <ul class="tickets" id="tickets" aria-label="Your tickets"></ul>
    <img class="seat" src="${R}/concert-show-2.jpg" width="960" height="640" alt="A band on a lit stage">
  </div>
  <section class="summary" aria-label="Your order">
    <p class="row"><span>${qty} × General admission</span><span>${money(ga)} each</span></p>
    <p class="row total"><span>Total</span><span>${money(qty * ga)}</span></p>
    <button class="btn" id="buy" type="button">Buy tickets</button>
    <p class="status" id="status" role="status"></p>
    <p class="fine">Fees calculated at payment. All resale is final.</p>
  </section>
</main>`;
    // Ticket cards: Hall 9 prints stubs; TixSwap lists codes.
    const card = hall9
        ? `'<li class="ticket"><div class="main"><b>'+t.show+'</b><span>'+t.venue+' · '+t.when+'<br>General admission, admit one</span><span class="code">'+t.code+'</span></div><div class="stub">'+(i+1)+' of '+all.length+'</div></li>'`
        : `'<li class="ticket"><span>'+t.show+' · '+t.seat+'</span><span>'+t.code+'</span></li>'`;
    return page(
        hall9 ? "Checkout · Night Owls · Hall 9" : "Checkout | TixSwap",
        hall9 ? icon("9", "#1423b8", "#ffffff") + fonts.cabinet + css("tickets/site.css") : icon("T", "#0a0d14", "#5a9bfc") + fonts.work + css("resale/site.css"),
        body,
        `const buy=document.getElementById("buy"),status=document.getElementById("status");
buy.addEventListener("click",async()=>{
  buy.disabled=true;status.className="status";status.textContent=${JSON.stringify(hall9 ? "Waiting for payment…" : "Processing…")};
  const r=await fetch("/api/buy?qty=${qty}",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
  if(r.status===402){status.className="status err";status.textContent="Payment required. Use a wallet that supports x402 to pay.";buy.disabled=false;return}
  if(!r.ok){status.className="status err";status.textContent="Something went wrong ("+r.status+").";buy.disabled=false;return}
  const {tickets:all}=await r.json();status.textContent="You're going. Show these at the door.";
  document.getElementById("tickets").innerHTML=all.map((t,i)=>${card}).join("");
  buy.hidden=true;
});`,
    );
}

// ---------------- tracker ----------------

export function trackerPage(): string {
    return page(
        "Release v1.4.0 · Relay",
        icon("R", "#111111", "#ffffff") + fonts.geist + css("tracker.css"),
        `<aside>
  <div class="ws"><i>R</i>Relay</div>
  <nav aria-label="Views"><p>Checkout team</p><a href="#" class="on" aria-current="page">Release v1.4.0 <span>6</span></a><a href="#">Backlog <span>23</span></a><a href="#">My issues <span>4</span></a></nav>
  <nav aria-label="Teams"><p>Teams</p><a href="#">Payments</a><a href="#">Web</a></nav>
</aside>
<main>
  <p class="crumbs">Checkout team / Cycles</p>
  <h1>Release v1.4.0 · In review</h1>
  <p class="lede">Shipped in v1.4.0. Mark each ticket Done and link its pull request.</p>
  <div class="tools">
    <div class="search">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="#787774" stroke-width="1.8"/><path d="M11 11l3.5 3.5" stroke="#787774" stroke-width="1.8" stroke-linecap="round"/></svg>
      <input id="search" type="search" placeholder="Search tickets" aria-label="Search tickets" autocomplete="off">
    </div>
    <span class="count" id="count"></span>
  </div>
  <ul class="list" id="list" aria-label="Tickets"></ul>
  <section id="panel" class="panel" aria-label="Ticket details">
    <div><h2 id="p-id" class="key"></h2><p id="p-title" class="ptitle"></p></div>
    <div class="f f-status"><label for="p-status">Status</label>
      <select id="p-status" name="status"><option>Backlog</option><option>In review</option><option>Done</option></select></div>
    <div class="f f-pr"><label for="p-pr">Linked PR</label>
      <input id="p-pr" name="pr" type="text" placeholder="#123" autocomplete="off"></div>
    <div class="actions"><button id="save" class="btn primary" type="button">Save</button></div>
  </section>
</main>`,
        `let tickets=[],open=null;const $=id=>document.getElementById(id);
const tag=s=>s==="Done"?"done":s==="Backlog"?"backlog":"review";
async function load(){tickets=await (await fetch("/api/tickets")).json();render()}
function render(){const q=$("search").value.trim().toLowerCase();
  $("list").innerHTML=tickets.filter(t=>!q||(t.id+" "+t.title).toLowerCase().includes(q)).map(t=>'<li><button type="button" data-id="'+t.id+'"'+(open&&open.id===t.id?' class="sel"':'')+'><span class="key">'+t.id+'</span><span class="title">'+t.title+'</span><span class="tag '+tag(t.status)+'">'+t.status+'</span><span class="pr">'+(t.pr||"")+'</span></button></li>').join("");
  $("count").textContent=tickets.filter(t=>t.status==="Done").length+" of "+tickets.length+" done"}
$("search").addEventListener("input",render);
$("list").addEventListener("click",e=>{const b=e.target.closest("button[data-id]");if(!b)return;open=tickets.find(t=>t.id===b.dataset.id);
  $("p-id").textContent=open.id;$("p-title").textContent=open.title;$("p-status").value=open.status;$("p-pr").value=open.pr;$("panel").classList.add("open");render()});
$("save").addEventListener("click",async()=>{if(!open)return;
  await fetch("/api/tickets/"+open.id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:$("p-status").value,pr:$("p-pr").value})});
  $("panel").classList.remove("open");open=null;await load()});
load();`,
    );
}

// ---------------- inbox ----------------

export function inboxPage(): string {
    return page(
        "Inbox · Post",
        icon("P", "#edf3ec", "#346538") + fonts.geist + css("inbox.css"),
        `<aside>
  <p class="who">Sam Ortiz<span>sam@post.localhost</span></p>
  <button class="compose" type="button">New message</button>
  <nav aria-label="Mailboxes"><a href="#" class="on" aria-current="page">Inbox <span>3</span></a><a href="#">Starred</a><a href="#">Sent</a><a href="#">Archive</a></nav>
</aside>
<section class="threads" aria-label="Messages">
  <header>Inbox</header>
  <ul>
    <li class="unread"><a href="#" class="on"><span class="from">Oak St Pharmacy<time>3:12 pm</time></span><span class="subj">Your prescription is ready</span></a></li>
    <li class="unread"><a href="#"><span class="from">Hall 9<time>1:30 pm</time></span><span class="subj">Your tickets for Night Owls</span></a></li>
    <li class="unread"><a href="#"><span class="from">Maya Chen<time>11:05 am</time></span><span class="subj">Release v1.4.0 notes</span></a></li>
    <li><a href="#"><span class="from">Dock Road Ferries<time>Mon</time></span><span class="subj">Winter timetable</span></a></li>
  </ul>
</section>
<main class="read">
  <h1>Your prescription is ready</h1>
  <span class="tag">Pharmacy</span>
  <div class="sender">
    <div class="avatar" aria-hidden="true">O</div>
    <p>Oak St Pharmacy<span>refills@pharmacy.localhost</span></p>
    <time>Today, 3:12 pm</time>
  </div>
  <div class="body">
    <p>Hi,</p>
    <p class="main">Rx 4471-209 is ready to refill at Oak St. Pick up after 5 pm.</p>
    <p>Want a heads-up? Ask us to text you when it's ready.</p>
    <p class="sig">Oak St Pharmacy</p>
  </div>
</main>`,
    );
}

// ---------------- pharmacy ----------------

export function pharmacyPage(copay: number): string {
    return page(
        "Refill a prescription · CareRx",
        icon("+", "#7d0c14", "#e2e2e2") + fonts.gambarino + css("pharmacy/site.css"),
        `<figure class="stage">
  <img src="/static/pharmacy/pharmacy-jar.jpg" width="1400" height="1744" alt="A blue and white maiolica pharmacy jar lettered Basilicon, Italy, about 1740">
  <figcaption>Pharmacy jar, probably Savona, c. 1740. Art Institute of Chicago, public domain (CC0).</figcaption>
</figure>
<div class="col">
  <header class="top"><span>CareRx</span><span>Open until 9 pm</span></header>
  <h1>Refill a prescription</h1>
  <p class="lede">Pick up at any CareRx location. Tell us the number on your label and when you'll come in.</p>
  <main class="form">
    <div class="f f-rx"><label for="rx">Rx number</label>
      <input id="rx" name="rx" type="text" placeholder="e.g. 1234-567" autocomplete="off"></div>
    <div class="f f-loc"><label for="loc">Pickup location</label>
      <select id="loc" name="location"><option>Main St</option><option>Oak St</option><option>Elm Ave</option></select></div>
    <div class="f f-time"><p id="time-lbl">Pickup time</p>
      <ul class="chips" aria-labelledby="time-lbl">
        <li><button class="chip" type="button" aria-pressed="false">4:00 pm</button></li>
        <li><button class="chip" type="button" aria-pressed="false">5:30 pm</button></li>
        <li><button class="chip" type="button" aria-pressed="false">7:00 pm</button></li>
      </ul></div>
    <label class="check"><input id="sms" type="checkbox"> Text me when ready</label>
    <p class="due"><span class="copay">Copay ${money(copay)}</span></p>
    <button class="btn" id="submit" type="button">Request refill</button>
    <p id="done" role="status"></p>
  </main>
  <footer>CareRx · Main St, Oak St and Elm Ave. Copays are paid in USDC.</footer>
</div>`,
        `const $=id=>document.getElementById(id);let time=null;
document.querySelectorAll(".chips button").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".chips button").forEach(o=>o.setAttribute("aria-pressed","false"));b.setAttribute("aria-pressed","true");time=b.textContent}));
$("submit").addEventListener("click",async()=>{$("done").className="";$("done").textContent="Sending…";
  const r=await fetch("/api/refill",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rx:$("rx").value,location:$("loc").value,time,sms:$("sms").checked})});
  if(r.status===402){$("done").textContent="Copay required to submit.";return}
  if(!r.ok){$("done").textContent="Something went wrong ("+r.status+").";return}
  $("done").className="ok";$("done").textContent="Refill requested ✓"});`,
    );
}
