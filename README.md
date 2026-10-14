# Tab

Tab predicts your next action anywhere on your Mac and shows it as a gray "ghost": a highlight on the button you're about to click, or gray text in the field you're about to fill. Press **Tab** to do it. Press **Esc** to dismiss it.

When the next step is an HTTP 402 paywall ([x402](https://x402.org)), the ghost becomes a payment, e.g. `Pay $0.05 · reviews.localhost ⇥`, and Tab pays with testnet USDC on Base Sepolia. Before it pays, Tab checks that the amount it's asked for matches what the page shows, and blocks the payment if they don't match.

Built for the Paradigm Frontiers 2026 Hackathon.

## Demo

1. **Paywalled review:** open a review, hit a 402, press Tab to pay $0.05, and the full review loads.
2. **Store checkout:** Add to cart → Checkout → Place order, one Tab per step, then pay $0.34.
3. **Receipts into Numbers:** fill an expense sheet from the orders page. After the first row, Tab fills each whole row in one keystroke, with no model call.
4. **Tampered checkout:** the page says $0.34 but the 402 asks for $3.40 to a different address, so Tab blocks it.
5. **Proof on chain:** the HUD links to every transaction on Basescan (Sepolia).

## Architecture

```
TabShell.app (Swift) ──ws──┐
                            ├──  Hub + Brain (TypeScript)   ws://127.0.0.1:7800
Web + Pay (TypeScript) ──ws─┘
      │ CDP 127.0.0.1:9222          Demo sites:
   Chrome (debug profile)            reviews.localhost:4001, store.localhost:4002
```

| Directory   | What it does                                                                     |
| ----------- | -------------------------------------------------------------------------------- |
| `shell/`    | macOS app: reads native apps via Accessibility, draws the ghost and HUD, catches Tab/Esc |
| `brain/`    | Websocket hub and prediction: pattern matching plus model calls                   |
| `web/`      | Chrome via CDP, x402 payments, the payment intent check, and the demo sites       |
| `protocol/` | Shared message types                                                             |

## Status

Work in progress. See [`PLAN.md`](PLAN.md) for the full build plan and protocol.

Testnet only. Never commit keys.
