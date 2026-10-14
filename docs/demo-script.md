# Demo script: buy tickets with Tempo, then add them to Calendar

The main demo flow. Two minutes, no slides: open straight on the Hall 9 tickets page in Chrome. Calendar is in the Dock. Each time a suggestion appears, let it sit for a beat so the audience sees it, then press Tab.

---

**Start on the Night Owls page. Set Qty to 2. A red suggestion lands on the Checkout button.**

"This is Tab. It watches what you're doing on your Mac and predicts your next step, using TypeSafe's Jev model. It shows that step right on the screen: here, it's highlighting the Checkout button I was about to click. I don't reach for the mouse. I press Tab."

**Press Tab. The checkout page opens, and the suggestion moves to Buy tickets.**

"Checkout's open, and it's already on the next button. Tab again."

**Press Tab. The site asks for payment, and the pay suggestion appears: Pay $0.30 · tickets.localhost.**

"Now the site wants to be paid, so Tab offers to check out with Tempo: thirty cents in stablecoins. Before offering, it checked that the amount matches the price on the page. If the site tried to charge more than it shows, Tab would block the payment. One tap to pay."

**Press Tab. "Paying $0.30" shows for a moment, then Paid ✓, and two tickets appear on the page.**

"Paid on Tempo, and the tickets are here. Three taps of one key for the whole order."

**Wait about two seconds, without touching anything. A red suggestion appears on Calendar's icon in the Dock: Add Night Owls · Fri 9pm to Calendar.**

"Tab isn't stuck in the browser. It knows what I just bought, and when it is, so it offers the obvious next step, right on the Calendar icon: put the show in my calendar."

**Press Tab. Calendar opens, a new event is typed in, and "Night Owls at Hall 9" lands on Friday at 9 pm.**

"One more tap, and it's in my calendar: right show, right day, right time, taken straight from the ticket page. A website feeding a native Mac app, with no copying and no typing. That's Tab: your next step, one key, anywhere on your Mac."

---

## If something goes wrong

If a suggestion hasn't appeared after about three seconds, do that step by hand and keep talking. The next suggestion still comes.

If the payment takes a while, say "settling on Tempo" and wait. The Paying pill shows it's working.

If the Calendar suggestion doesn't appear, click the Calendar icon yourself and say "and it would put it right in here".

If the wifi dies, play the backup video.

## Before going on stage

On the phone hotspot, run `cd web && npm run reset-demo`, then `shell/scripts/preflight.sh`, and confirm the payer has a balance (`npm run balance`).

Open Calendar well beforehand, in Week view, then leave it in the Dock. In its sidebar, uncheck every calendar except "Tab Demo" so no personal events show on the projector. Delete any "Night Owls" events left from rehearsals; `reset-demo` doesn't clear them.

Quit your normal Chrome and turn on Do Not Disturb. Leave the tickets page open with Qty at 1.

"Fri 9pm" means the coming Friday. If you demo on a Friday evening or a weekend, the event lands next week, so switch Calendar to that week first.
