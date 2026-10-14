# Demo script: buy tickets, then add them to Calendar (2 minutes, no slides)

One continuous flow. Start on the Hall 9 tickets page in Chrome, with the HUD in the top right and Calendar in the Dock. Every time a red suggestion appears, let the audience see it for a beat, then press Tab.

---

**Open on the Night Owls page. Set Qty to 2. A red suggestion lands on the Checkout button.**

"This is Tab. It watches what you're doing on your Mac and predicts your next step, using TypeSafe's Jev model. It shows the prediction right on the screen: here, it's highlighting the Checkout button I was about to click. I don't move the mouse. I just press Tab."

**Press Tab. The checkout page opens, and the suggestion moves to Buy tickets.**

"Checkout's open, and it's already on the next button: Buy tickets. Tab again."

**Press Tab. The site asks for payment, and a blue suggestion appears: Pay $0.30 · tickets.localhost.**

"Now the site wants to be paid. Tab can pay for me, in stablecoins on Tempo. It checked that thirty cents is the price this page shows. If the payment asked for more than the page says, Tab would refuse to pay it. One more tap."

**Press Tab. "Paying $0.30" shows for a moment, then Paid ✓, and two tickets appear on the page.**

"Paid, and the tickets are here. That whole order was three taps of one key, and I barely moved a finger."

**Wait about two seconds, without touching anything. A red suggestion appears on Calendar's icon in the Dock: Add Night Owls · Fri 9pm to Calendar.**

"And Tab isn't stuck in the browser. It knows what I just bought, and it knows what people usually do next: put it in their calendar. So it's offering that, right on the Calendar icon."

**Press Tab. Calendar opens, a new event is created and typed in, and "Night Owls at Hall 9" lands on Friday at 9 pm.**

"One tap, and it's in my calendar: the right show, the right day, the right time, copied from the ticket page. That's a website feeding a native Mac app, with no copy-paste and no typing."

**Click the Tab did / You did numbers in the HUD. The reveal card counts up.**

"Here's the score: everything Tab did, and the little I did. Tab: your next step, one key, anywhere on your Mac."

---

## If something goes wrong

If a suggestion hasn't appeared after about three seconds, do that step by hand and keep talking. The next suggestion still comes.

If the payment takes a while, say "settling on chain" and wait. The Paying pill shows it's working.

If the Calendar suggestion doesn't appear, click the Calendar icon yourself, say "and it would put it right in here", and move on to the reveal.

If the wifi dies, play the backup video.

## Before going on stage

Run `cd web && npm run reset-demo`, then `shell/scripts/preflight.sh`, on the phone hotspot.

Open Calendar well beforehand, in Week view, and leave it in the Dock. In the sidebar, uncheck every calendar except "Tab Demo", so no personal events show on the projector. Delete any rehearsal "Night Owls" events from Tab Demo, because `reset-demo` doesn't clear them.

Quit your normal Chrome and turn on Do Not Disturb. Leave the tickets page open with Qty at 1.

"Fri 9pm" means the coming Friday. If the demo is on a Friday evening or a weekend, the event lands in next week, so switch Calendar to that week before going on stage.
