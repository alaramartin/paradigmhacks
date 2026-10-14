# Demo script: 2 minutes, no slides, straight into the demo

**The pitch these 2 minutes must prove** (project summary): Tab predicts your next action on your Mac with **TypeSafe's Jev model** and shows it as a **gray suggestion highlight** on the button you're about to click or the field you're about to fill. **Placing an order or opening a pull request becomes three taps of one key.** Tab **learns your workflows**: do a tedious task once, and it offers to do the rest. When a step hits a paywall, Tab **pays in stablecoins on Tempo with one keypress**, and **blocks the payment if the amount doesn't match the price on the page**.

**Running order: Flow 1 (order + pay + block) → Flow 2 (pull request) → Flow 3 (learns a workflow) → reveal.** Flow 4 (one button, accessibility) is the reserve; see "Options" at the end.

| Summary claim | Where the audience sees it |
| --- | --- |
| Predicts the next action with Jev | Every gray ghost in flows 1 and 2; HUD chip `[model] … ms` |
| Gray highlight on the button / field | `Click Checkout ⇥` on the button; gray description text inside GitHub's empty field |
| An order = three taps of one key | Flow 1: Checkout ⇥ · Buy tickets ⇥ · Pay ⇥ |
| A pull request = three taps of one key | Flow 2: Open pull request ⇥ · description ⇥ · Create pull request ⇥ |
| Learns workflows: once by hand, then it offers the rest | Flow 3: ticket 1 by hand → `Repeat …` → `Do the remaining 3`; HUD `[pattern] 0 model calls` |
| Pays in stablecoins on Tempo with one keypress | Flow 1 `Pay $0.30 · tickets.localhost ⇥` → `Paying…` → `Paid $0.30 ✓`; the HUD ledger opens the Tempo explorer |
| Blocks a payment that doesn't match the page | Flow 1 resale: red `Blocked · page says $0.30, payment asks $0.51`; Tab does nothing |

---

## Before going on stage (stage manager, ~10 min before)

1. On the demo network (phone hotspot, not venue wifi): `cd web && npm run reset-demo`, then `shell/scripts/preflight.sh`. Fix every ✗. Confirm `PAY_RAIL=mpp` and `npm run balance` > 0.
2. Quit TabShell → `cd web && npm run warm` (~5 min; fills Jev's answer cache for every demo screen) → relaunch TabShell → **`npm run reset-demo` again** (warm leaves a full reset, but run it anyway: flow 3 must start with nothing learned).
3. **One macOS desktop per flow.** The ghost overlay, HUD and reveal card show on every desktop, so the presenter moves between flows with **Ctrl+→**, with no window dragging on stage:
   - **Desktop 1, Flow 1:** debug Chrome, left half: `tickets.localhost:4001/e/night-owls`, Qty still 1. A second tab, `resale.localhost:4002/checkout?qty=2`, sits next to it.
   - **Desktop 2, Flow 2:** Chrome left half (any page), **Terminal** right half in `~/Projects/tab-demo` on `fix/checkout-rounding` (2 unpushed commits). `git push -u origin fix/checkout-rounding` is **already typed, not run**.
   - **Desktop 3, Flow 3:** Chrome left: the GitHub release `v1.4.0` (notes table Ticket | Change | PR). Chrome right: `tracker.localhost:4003`, all six "In review".
   - **Desktop 4:** the backup video, open and paused at 0:00.
4. HUD in the top right, reading `none offered yet`. Normal Chrome quit. One display. Phone on silent.
5. Start on Desktop 1, with the tickets page focused.

---

## The script (~1:55; times are targets, set by a stopwatch at rehearsal)

Quotes are spoken. Everything else is what the presenter does. Let each ghost be **seen** before pressing Tab: the gray highlight is the product.

### 0:00 Flow 1: an order in three taps, paid on Tempo, and a payment that gets blocked

| On screen | Say | ~ends |
| --- | --- | --- |
| Tickets page. Set Qty to **2**. The gray ghost `Click Checkout ⇥` lands on the button. | "This is Tab. It predicts your next step on your Mac, and shows it right where you'd click." | 0:10 |
| **Tab.** Checkout opens; the ghost moves to `Click Buy tickets ⇥`. | "Tab to accept. It's TypeSafe's Jev model, reading the screen." | 0:16 |
| **Tab.** The page hits a paywall: blue `Pay $0.30 · tickets.localhost ⇥`. | "This one wants payment." | 0:20 |
| **Tab.** `Paying $0.30…` → `Paid $0.30 ✓`, two ticket cards. | "Stablecoins on Tempo, one keypress. That's the whole order: three taps of one key." | 0:30 |
| Switch to the resale tab. Click **Buy tickets**. Red `Blocked · page says $0.30, payment asks $0.51`. Press **Tab**: it shakes, nothing happens. **Esc.** | "Same show on a resale site. The page says thirty cents; the payment asks fifty-one, to someone else. Tab checks the price on the page against the payment, and won't pay it." | 0:45 |

### 0:45 Flow 2: a pull request in three taps (Ctrl+→)

| On screen | Say | ~ends |
| --- | --- | --- |
| **Ctrl+→.** Press **Enter** on the typed `git push`. GitHub's "Create a pull request" URL prints; the ghost `Open pull request ⇥` appears at the bottom of Terminal. | "It works across apps. I push a branch…" | 0:53 |
| **Tab.** Chrome comes forward on the pull request page. Gray description text fills the empty field, written from the commits. | "…it opens the pull request and drafts the description from my commits." | 1:01 |
| **Tab** (the description lands). `Click Create pull request ⇥`. **Tab.** The PR is open. | "Three taps, and the PR is up." | 1:08 |

### 1:08 Flow 3: it learns a workflow (Ctrl+→)

| On screen | Say | ~ends |
| --- | --- | --- |
| **Ctrl+→.** Ticket 1 **by hand**, at a brisk pace: type `ENG-142` in search, click it, Status **Done**, Linked PR `#12`, **Save**. (Accepting a correct ghost along the way is fine.) | "Release day. Six tickets to close, each linked to its PR from the release notes. I do the first one myself." | 1:28 |
| `Repeat for ENG-150 · #13 ⇥`. Point at the HUD: `[pattern] 0 model calls`. **Tab.** | "It watched once. Now it offers the rest, with no model call: it just repeats what I did, with the next row." | 1:36 |
| `Repeat for ENG-151 · #14 ⇥` **Tab** → `Do the remaining 3 ⇥` **Tab**. All six Done. | "And the rest. Done." | 1:44 |

### 1:44 Close: the reveal

| On screen | Say | ~ends |
| --- | --- | --- |
| Click the numbers in the HUD; the reveal card counts up "Tab did / You did". | "That's what Tab did, and that's what I did. Tab: your next step, one key, anywhere on your Mac." | 1:55 |

*(Spare ~5 s. If running long, drop the Esc on the resale ghost and the "Repeat for ENG-151" line; press through.)*

---

## When something goes wrong (decide on stage, don't debug)

- **A ghost is slow (> ~3 s):** keep talking. Then do the step by hand: the next ghost still comes. Jev's answer cache usually covers this if step 2 above was done on the demo network.
- **A payment hangs past ~10 s:** "Settling on chain…", then move on to flow 2; the Paying pill shows that something is happening.
- **`git push` fails (network/GitHub):** skip to Ctrl+→ flow 3. Say "Same idea with pull requests" and keep going.
- **Flow 3 opens with `Do all 6 from v1.4.0 · learned …`:** the reset was skipped. Use it: "It remembered this from earlier", press Tab, and move to the reveal.
- **Wifi dies entirely:** Ctrl+→ to Desktop 4 and play the backup video from the matching point.

---

## Options

- **A, the recommended script above: 1 → 2 → 3.** Shows every claim in the summary. Risk: flow 2 depends on GitHub and the network, and its weakest model step (`Create pull request`) is at 0.7 confidence against the 0.6 bar.
- **B, faster learning beat (saves ~15 s).** In flow 3, skip teaching ticket 1 live: run `npm run reset-demo -- --keep-workflows` beforehand, and the tracker opens with `Do all 6 from v1.4.0 · learned 10:03 am ⇥`. Say "I did this once this morning; it remembered", press Tab once, and all six are Done. That gives up "watch it learn", but the spare time can fit a short flow 4 at the end.
- **C, accessibility instead of the pull request (1 → 3 → 4).** Replace flow 2 with flow 4: inbox + pharmacy, high-contrast ghosts, **pedal only**: Rx, Oak St, 5:30 pm, Text me, Request refill, Pay $0.05, all with one switch. This is the more emotional close, and lower risk than GitHub, but it loses the "pull request in three taps" claim from the summary.
- **D, safest (1 + 3, ~1:30).** Time to slow down and talk over each ghost. Drops the cross-app pull request.

**Rehearsal rule:** run the chosen option five times with a stopwatch, with `npm run reset-demo` before each run. If two runs go over 2:00, take option B. Record the backup video on the best run (by 14:30).
