# Demo script (2 minutes, no slides)

Start on the tickets page. HUD in the top right. Press **Tab** whenever a gray suggestion appears.

---

**[Tickets page. Set Qty to 2. A gray highlight appears on Checkout.]**

> "This is Tab. It watches your screen, predicts your next step with TypeSafe's Jev model, and highlights it in gray: here, the Checkout button. I just press Tab."

**[Tab → checkout page, gray highlight on Buy tickets. Tab.]**

> "Buy tickets. Tab."

**[The page asks for payment: blue `Pay $0.30 · tickets.localhost`. Tab → Paying… → Paid ✓, tickets appear.]**

> "The site wants payment, so Tab pays it in stablecoins on Tempo, with one keypress. That whole order was three taps of one key."

**[Resale tab. Click Buy tickets. Red `Blocked · page says $0.30, payment asks $0.51`. Press Tab: nothing. Esc.]**

> "Same show on a resale site. The page says thirty cents, but the payment asks fifty-one cents, to someone else. Tab compares the payment to the price on the page, and blocks it."

---

**[Ctrl+→ to Terminal + Chrome. Press Enter on the pre-typed `git push`. Gray `Open pull request` appears at the bottom of Terminal. Tab.]**

> "It works across apps. I push a branch, and Tab offers to open the pull request."

**[Chrome comes forward. Gray description text fills the empty field. Tab. Gray highlight on Create pull request. Tab → PR is open.]**

> "It writes the description from my commits… and creates the PR. Three taps again."

---

**[Ctrl+→ to release notes + tracker. Close ticket ENG-142 by hand: search, open, Status Done, PR #12, Save.]**

> "Now a tedious one: six tickets to close and link to their pull requests. I do the first one myself."

**[Gray `Repeat for ENG-150 · #13` appears. Point at the HUD: `0 model calls`. Tab.]**

> "Tab noticed the pattern and offers to do the next one: no AI call, it just repeats what I did."

**[`Do the remaining 3`. Tab → all six Done.]**

> "And the rest. Done."

---

**[Click the numbers in the HUD; the reveal card counts up.]**

> "That's how much Tab did, and how little I did. Tab: your next step, one key, anywhere on your Mac."

---

### If something goes wrong
- **No suggestion after ~3 s:** do the step by hand and keep talking; the next suggestion still comes.
- **Payment takes long:** "Settling on chain…", then move on.
- **`git push` fails:** skip straight to the tracker.
- **Wifi dies:** play the backup video.

### Before going on stage
`npm run reset-demo` → `shell/scripts/preflight.sh` → `npm run warm` on the hotspot (TabShell quit, relaunch after) → `npm run reset-demo`. Put each flow on its own desktop (Ctrl+→ between them), with `git push -u origin fix/checkout-rounding` already typed in Terminal.
