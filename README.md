# Tab

> **Status:** working proof of concept, built at a hackathon. A general release is in the works. Follow [@alara_martin_](https://x.com/alara_martin_) for updates.

Tab predicts your next action on your Mac and shows it as a gray "ghost": a highlight on the button you're about to click, or gray text in the field you're about to fill. Press **Tab** to do it. Press **Esc** to dismiss it.

When the next step is an HTTP 402 paywall ([x402](https://x402.org)), the ghost becomes a payment, e.g. `Pay $0.30 · tickets.localhost ⇥`, and Tab pays with testnet USDC on Base Sepolia. Before it pays, Tab checks that the amount it's asked for matches what the page shows, and blocks the payment if they don't match. Do a chore once, and Tab repeats it for the next item in one keystroke, with no model call.

Built for the Paradigm Frontiers 2026 Hackathon.

## Demo

1. **Buy tickets:** Checkout → Buy → pay $0.30, one Tab per step. On a resale site, the page says $0.30 but the 402 asks for $0.51 to a different address, so Tab blocks it.
2. **`git push` to pull request:** after a push, Tab reads the PR link from Terminal, opens it in Chrome, writes the description, and creates the PR.
3. **Release day, teach once:** close the first shipped ticket in the tracker by hand. Tab offers `Repeat for ENG-150 · #13 ⇥` for the next one, then `Do the remaining 3 ⇥`. The HUD shows `pattern · 0 model calls`.
4. **One button:** refill a prescription and pay the $0.05 copay using only a foot pedal, compared with the same form done with macOS Switch Control.
5. **Proof on chain:** the HUD links to every transaction on Basescan (Sepolia).

## Architecture

```
TabShell.app (Swift) ──ws──┐
                            ├──  Hub + Brain (TypeScript)   ws://127.0.0.1:7800
Web + Pay (TypeScript) ──ws─┘
      │ CDP 127.0.0.1:9222
   Chrome (debug profile) ── github.com + demo sites (tickets, resale, tracker, inbox, pharmacy)
```

| Directory   | What it does                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------- |
| `shell/`    | macOS app: draws the ghost and HUD, owns Tab/Esc, reads Terminal, switches apps               |
| `brain/`    | Websocket hub and prediction: the repeat-what-you-did pattern rule plus one model call       |
| `web/`      | Chrome via CDP, x402 payments, the payment intent check, and the demo sites                   |
| `protocol/` | Shared message types                                                                          |

## Status

Work in progress. See [`PLAN.md`](PLAN.md) for the full build plan and protocol.

Testnet only. Never commit keys.
