# PLAN.md — Tab

Agent-facing build plan for Paradigm Frontiers 2026 Hackathon, due at 4pm on Wednesday, October 14th. Three agents (A, B, C) build in parallel against a frozen protocol. Read the whole file before writing code. Then read only your own section in detail.

## What we're building

Tab predicts the user's next action anywhere on the Mac and shows it as a gray ghost: a highlight box plus a gray cursor on a button, or gray text inside a field. **Tab** executes it. **Esc** dismisses it. When the next step hits an HTTP 402 (x402), the ghost becomes `Pay $0.05 · reviews.localhost ⇥`, and Tab pays with testnet USDC on Base Sepolia. Before paying, Tab checks the payment request against what the page actually shows and blocks mismatches.

**The demo is the spec. If something is not needed for the demo below, do not build it.**

## Demo script (acceptance test for the whole system)

**Setup:**

- Chrome runs on the debug profile in the left half of the screen.
- Numbers has `Expenses.numbers` open in the right half.
- The HUD sits in the top right.
- Browser zoom is 100%. One display.

1. **Paywalled review.**
    - In Chrome on `reviews.localhost:4001`, the user opens the review of the "Lumen Desk Lamp."
    - The server returns 402. A ghost appears: `Pay $0.05 · reviews.localhost ⇥`.
    - Tab pays, the full review loads, and the HUD shows the transaction.
2. **Store checkout.**
    - On `store.localhost:4002`, on the lamp's product page, ghosts walk the user through Add to cart → Checkout → Place order. Each step is one Tab.
    - Place order returns 402. A ghost appears: `Pay $0.34 · store.localhost ⇥`.
    - Tab pays and the order confirmation shows.
3. **Receipts into Numbers.**
    - The user opens `store.localhost:4002/orders`, which lists 3 orders, and clicks the first empty row in Numbers.
    - Row 1: ghosts predict one cell at a time (Date, Merchant, Item, Amount), using the Jev model, with values taken from the orders page. That's one Tab per cell.
    - Rows 2 and 3: a single ghost `Fill row ⇥` fills the entire row in one Tab. This comes from the pattern path. The HUD shows `pattern · 0 model calls · <10 ms`.
4. **Tampered checkout.**
    - At `store.localhost:4002/checkout?promo=FALL`, the page shows Total $0.34, but the 402 asks for $3.40 to a different address.
    - A red ghost appears: `Blocked · page says $0.34, payment asks $3.40`. Tab does nothing. Esc dismisses.
5. **Proof on chain.** Clicking "ledger" in the HUD opens Basescan (Sepolia) on the last transaction.

## Rules for all agents

- **Own only your directory.** `protocol/` is shared and frozen after M0. Changes after that must be additive optional fields, recorded in `protocol/CHANGES.md` with a one-line reason.
- **Testnet only.** Never commit keys. `.env` is gitignored.
- **Don't write SDK calls from memory.** This applies to x402 v2, CDP, and the AX APIs. x402 v2 renamed packages (`@x402/*`) and headers. Read the typings in `node_modules` or the headers before writing calls.
- **Keep your section of `STATUS.md` current,** using the headings Done / In progress / Blocked / Needs human. If you're blocked on a human action (permissions, faucet, Jev docs, Numbers file), write it under Needs human and move on to other work.
- **Commit small and often.** `main` must always build and run.
- **Respect the latency budget.** From a state change to a ghost on screen: ≤ 50 ms on the pattern path, ≤ 1.5 s via Jev. Log latency on every prediction.

## Architecture

```
TabShell.app (Swift, Agent A) ──ws──┐
                                     ├──  Hub + Brain (TypeScript, Agent B)   ws://127.0.0.1:7800
Web + Pay (TypeScript, Agent C) ──ws─┘
      │ CDP 127.0.0.1:9222                   Demo sites (Agent C):
   Chrome (debug profile)                     reviews.localhost:4001, store.localhost:4002
```

| Component                      | Owns                                                                                                                                              | Does not touch               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **A — Shell** (`shell/`)       | AX perception of native apps (Numbers); overlay and HUD windows; global Tab/Esc tap; executing native actions                                     | Chrome, prediction, payments |
| **B — Hub + Brain** (`brain/`) | websocket hub and routing; the predict loop; pattern path; Jev and LLM calls; example store; prediction logs                                      | Drawing, executing, payments |
| **C — Web + Pay** (`web/`)     | Chrome via CDP (perception, user events, executing actions); 402 interception; x402 wallet and payment; intent check; payments ledger; demo sites | Native apps, prediction      |

**Routing rule:** an action whose `app === "com.google.Chrome"` executes in C. Everything else executes in A. Ghosts are always drawn by A, using screen-point rects provided by whichever source owns the element.

## Repo layout

```
PLAN.md  STATUS.md  .env.example
protocol/  types.ts  CHANGES.md  fixtures/        # shared, frozen after M0
shell/     Package.swift  Sources/TabShell/...  scripts/build-shell.sh   # A
brain/     package.json  src/{hub,predict,pattern,jev,llm,examples,log}.ts  examples.jsonl  tools/  # B
web/       package.json  src/{cdp,state,exec,pay402,intent,ledger}.ts  demo/{reviews,store}/  scripts/  # C
docs/      jev.md                                   # humans paste the Jev API docs here
```

## Protocol (frozen at M0)

`protocol/types.ts` is the source of truth. A mirrors these types as Swift `Codable` types. All messages are JSON over a single websocket to the hub, and every message has a `type` field.

```ts
// Coordinates: global screen points, origin = top-left of the main display (AX convention).
export type Rect = { x: number; y: number; w: number; h: number };

export type Role =
    | "button"
    | "link"
    | "textfield"
    | "textarea"
    | "checkbox"
    | "menuitem"
    | "cell"
    | "tab"
    | "text"
    | "other";

export interface El {
    id: string; // stable across snapshots where possible
    role: Role;
    label: string; // accessible name or visible text, ≤ 80 chars
    value?: string; // current value (fields, cells)
    rect: Rect;
    enabled: boolean;
    path?: string; // structural path (CSS-ish for web, AX role path for native)
    list?: { key: string; index: number; field?: string }; // item in a repeated structure; field = path relative to the item
    row?: number;
    col?: number; // table cells (0-based)
}

export interface ScreenState {
    type: "state";
    source: "native" | "web";
    app: string; // bundle id; 'com.google.Chrome' for web
    window: string;
    url?: string;
    focusedId?: string;
    elements: El[]; // visible only, ≤ 200, interactive first, then text
    seq: number; // monotonic per source
    ts: number;
}

export interface UserEvent {
    type: "user_event";
    source: "native" | "web";
    app: string;
    kind: "click" | "type" | "key" | "focus" | "app_switch" | "navigate";
    target?: El;
    value?: string; // committed text, key name ('tab'|'return'|'escape'|...), bundle id, or url
    ts: number;
}

export type Op =
    | "click"
    | "type"
    | "key"
    | "switch_app"
    | "navigate"
    | "sequence";

export interface Action {
    op: Op;
    app: string;
    targetId?: string; // id in the latest state of `app`
    value?: string;
    steps?: Action[]; // op === 'sequence'
    label: string; // pill text without the key glyph, e.g. "Click Checkout", "Fill row"
    confidence: number; // 0..1
    source: "pattern" | "jev" | "llm";
}

export interface Ghost {
    id: string;
    kind: "action" | "text" | "pay" | "blocked" | "done";
    label: string; // e.g. "Click Checkout ⇥", "Pay $0.05 · reviews.localhost ⇥"
    rect?: Rect; // highlight box
    cursor?: { x: number; y: number };
    ghostText?: string; // gray inline text for kind 'text'
    ttlMs?: number; // auto-hide, used for 'done'
}

export interface Hud {
    mode: "idle" | "predicting" | "shown";
    lastSource?: "pattern" | "jev" | "llm";
    lastLatencyMs?: number;
    modelCalls: number;
    shown: number;
    accepted: number;
    lastTx?: { hash: string; explorerUrl: string; amountUsd: string };
}

export interface PaymentRequired {
    type: "payment_required";
    paymentId: string;
    url: string;
    method: string;
    payeeDomain: string; // hostname shown to the user
    payTo: string;
    amountUsd: string; // "0.34"
    network: string; // "eip155:84532"
    asset: string;
    verdict: { ok: boolean; reason?: string; pagePriceUsd?: string };
    anchorRect?: Rect; // element that triggered it (screen points)
}

export interface PaymentResult {
    type: "payment_result";
    paymentId: string;
    ok: boolean;
    txHash?: string;
    explorerUrl?: string;
    error?: string;
}
```

**Messages:**

```
A → hub:  hello{role:'shell'} | state(native) | user_event(native) | frontmost{app, window}
          | accept{ghostId} | dismiss{ghostId} | exec_result{ghostId, ok, error?} | hud_click{item:'ledger'}
hub → A:  ghost{ghost} | ghost_hide{} | exec{ghostId, action} | hud{hud}
C → hub:  hello{role:'web'} | state(web) | user_event(web) | payment_required | payment_result | exec_result{...}
hub → C:  exec{ghostId, action} | pay{paymentId} | dismiss_payment{paymentId} | open_url{url}
```

**Pill formats:**

- Action: `Click Checkout ⇥`
- Text: inline gray text plus `⇥`
- Pay: `Pay $0.05 · reviews.localhost ⇥`
- Blocked: `Blocked · <reason>` (red, no ⇥)
- Done: `Paid $0.05 ✓` (1500 ms)

**Fixtures:** at M0, A commits `protocol/fixtures/native_state_numbers.json` and C commits `web_state_store_checkout.json` and `web_state_orders.json`. Both must be captured from the real apps. B develops against these.

---

## Agent A — TabShell (Swift, macOS 14+)

**Goal:** see native apps, draw ghosts and the HUD, intercept Tab and Esc, and execute native actions.

**Build and permissions**

- **Build:** a SwiftPM executable, wrapped into `shell/build/TabShell.app` by `scripts/build-shell.sh`. The Info.plist sets `LSUIElement=true` and bundle id `dev.tab.shell`. The script also codesigns the bundle.
- **Signing:** use a stable local signing identity if one exists. Otherwise ad-hoc sign, but keep the bundle path and id fixed.
- **Permission:** the app needs Accessibility. If events stop after a rebuild, write "re-grant Accessibility" under Needs human.
- **Connection:** connect to `ws://127.0.0.1:7800` with auto-reconnect.

**Perception (native apps only; skip when Chrome is frontmost)**

- Track the frontmost app with `NSWorkspace.didActivateApplicationNotification`. Send `frontmost` on every change.
- Register an `AXObserver` for focused-element changes, value changes, and window moves and resizes. On each notification, debounce 100 ms, then snapshot.
- **Snapshot:** walk the focused window's AX tree. Limit to 400 nodes and 60 ms. Collect actionable roles plus text. For each element, read its frame from `kAXPosition` and `kAXSize`.
- **Element fields:** `id` is a stable AX role path plus index. Map AX roles to `Role`.
- **Numbers cells:** set `role:'cell'`, plus `row` and `col` from the cell's index attributes or its parent row/column position. Include column header cells as `text` elements.
- **First task in hour 1:** run `TabShell --dump` with Numbers frontmost and record in STATUS.md which attributes Numbers exposes for cells (value, frame, row/col). If cells are not readable, report that immediately under Blocked. The fallback is keyboard-only units (see B, pattern path). If even typing into Numbers fails, the humans will switch the target app to TextEdit or Notes.

**Native user events**

- Use one `CGEventTap` at the session level on keyDown and leftMouseDown.
- **Mouse down:** find the element under the pointer with `AXUIElementCopyElementAtPosition` and emit `click`.
- **Typing:** do not reconstruct text from keystrokes. When focus leaves a field, or Tab/Return is pressed, read the previous field's new `AXValue` and emit a `type` event. Emit `key` for `tab` and `return`.
- **Secure fields:** when `IsSecureEventInputEnabled()` is true, drop all typing events.
- **Our own events:** every synthetic event we post carries `eventSourceUserData = 0x7AB`. The tap passes these through and never logs them.

**Tab/Esc**

- While any ghost is visible, swallow Tab (keycode 48) and send `accept{ghostId}`. Swallow Esc (keycode 53) and send `dismiss{ghostId}`.
- With no ghost visible, pass Tab and Esc through untouched.
- A `blocked` ghost swallows Esc, not Tab.

**Overlay**

- One borderless, transparent, click-through `NSWindow` (`ignoresMouseEvents = true`) at `.statusBar` level, joining all spaces.
- **Coordinates:** convert from AX/top-left to AppKit/bottom-left with `y_ns = mainScreenHeight − y − h`.
- **Draw:**
    - a rounded highlight box, 2 px stroke, gray #8E8E93 at 70% opacity;
    - a gray arrow cursor at `cursor`;
    - a pill next to the rect;
    - for `text` ghosts, the ghost text in gray inside the field, after any existing value (get the caret bounds via `kAXBoundsForRangeParameterizedAttribute`, falling back to the field's left inset);
    - `blocked` ghosts in red;
    - `done` ghosts that auto-hide after `ttlMs`.
- **HUD:** a separate small clickable window in the top right showing `mode`, source, latency, model calls, shown/accepted, and the last tx. Clicking "ledger" sends `hud_click`.

**Execute (`exec` for non-Chrome apps)**

- `click`: `AXPress` on the target. Fall back to a synthetic click at the rect center.
- `type`: set `kAXValueAttribute`. If that fails (likely for Numbers cells), click the target and type with `CGEvent` `keyboardSetUnicodeString`.
- `key`: virtual keycodes for tab, return, and escape.
- `switch_app`: activate by bundle id.
- `sequence`: run the steps in order with a 60 ms gap, then send a single `exec_result`.

**Self-tests**

- `TabShell --selftest` draws a test ghost at a fixed rect.
- `TabShell --dump` prints one native snapshot as JSON.

**Done when:** in Numbers, A's state shows the cells with correct rects. A ghost sent by the hub lands exactly on the target cell. Tab executes a `sequence` that fills a row.

---

## Agent B — Hub + Brain (TypeScript, Node 20+)

**Goal:** route messages, decide what to predict and when, and keep the pattern path fast.

**Hub (`src/hub.ts`)**

- Websocket server on `127.0.0.1:7800`.
- **State tracking:** keep the latest state per app, plus a cache of the last state per URL or app for the past 120 s. That cache is the cross-app context.
- **Active source:** the frontmost app reported by A. If it's Chrome, use C's state.
- **On a new active state:** debounce 150 ms, increment `gen`, and call `predict(gen)`. Drop the result if `gen` has moved on. Show a ghost when `confidence ≥ 0.6`. Build the ghost's rect and cursor from the target element's rect.
- **On a user event:** any `user_event` not caused by our own exec hides the current ghost and gets logged in history.
- **On `accept`:** route the `exec` by app. On `exec_result{ok}`, append the action to history as executed and re-predict after the next state arrives.
- **Payments:**
    - A `payment_required` message preempts any action ghost. If `verdict.ok`, show a `pay` ghost at `anchorRect`. Otherwise show `blocked` with `verdict.reason`.
    - `accept` on a pay ghost sends `pay` to C.
    - On `payment_result`: if `ok`, show a `done` ghost and update `hud.lastTx`; otherwise show `blocked` with the error.
- **HUD:** send a `hud` update after every prediction and payment event. On `hud_click` for ledger, send `open_url(lastTx.explorerUrl)` to C.

**Predict order (`src/predict.ts`)**

1. Pattern path, synchronous, ≤ 10 ms. If it returns an action, use it.
2. Jev (`src/jev.ts`), with a 1500 ms timeout.
3. LLM (`src/llm.ts`), only when Jev's chosen action is a `type` whose value doesn't exist on screen or in cached states (new text has to be written), or when Jev errors or times out. In the error/timeout case, the LLM uses the same structured schema as Jev.

**Jev input** (one compact JSON):

- the active state, trimmed to 120 elements;
- the cached state of each other recently used app, trimmed to 60 elements each;
- the last 15 history entries;
- the top 3 examples from `examples.jsonl`;
- the output schema: `op` enum, `targetId` enum (from the active state's ids), `value`, `label`, `confidence`.

Read `docs/jev.md` (the humans will paste the API docs there) before writing `jev.ts`. If it's missing at start, write it under Needs human and build the LLM path first behind the same interface: `decide(input): Promise<Action|null>`.

**LLM:** Anthropic Messages API, with the model from env `LLM_MODEL`, JSON output only.

**Examples (`examples.jsonl`)**

- About 12 lines covering the store flow (product page → Add to cart → Checkout → Place order) and expense entry in Numbers (previous-week rows: Date / Merchant / Item / Amount, in the sheet's format).
- **Retrieval:** filter by app, then rank by word overlap with the visible labels. No embeddings.

**Pattern path (`src/pattern.ts`)** — the technical centerpiece. Write it explicitly.

- **History H:** the last 50 entries (user events and executed actions). Each entry has op, app, target `{path, list, row, col}`, value, and ts.
- **Provenance:** for each `type` value `v`, search the cached states (any app, last 120 s) for an element with `list` set whose label or value equals `v`. Normalize currency, so `"$0.34" == "0.34" == ".34"`, and trim whitespace. Record `prov = {listKey, index, field}`.
- **Unit:** the most recent contiguous suffix U of H (2–8 steps, all in one app) in which every `type` step has provenance from the same `listKey` and the same `index i`. Key steps (`tab`, `return`) and an optional leading click are part of the unit.
- **Next unit:**
    - same ops and keys;
    - a leading click target advances `row + 1` (same `col`) when the cells have row/col;
    - `type` values come from the latest cached list `listKey` at index `i + 1`, with the same `field`;
    - if index `i + 1` doesn't exist, there is no prediction.
- **Keyboard-only fallback:** if A reports no row/col for cells, emit the unit with no click step, relying on the caret position after `return`.
- **Output:** `Action{op:'sequence', label:'Fill row', source:'pattern'}` with confidence 0.85 if the unit has been seen once and 0.97 if it's been seen two or more times.
- **Tests:** unit tests on recorded sequences, using `protocol/fixtures/web_state_orders.json` plus a synthetic history of Numbers row 1.

**Logs:** append to `brain/logs/predictions.jsonl` with `{ts, gen, source, latencyMs, action, shown, accepted}`.

**Tools:**

- `tools/send.ts`, to send any protocol message by hand (A and C use it to test against the hub).
- `npm run replay <session.jsonl>`, to replay a recorded session and print each prediction with its latency.

**Done when:** replaying the demo session produces the right ghost at every step. Pattern-path predictions take < 10 ms. Jev predictions take < 1.5 s.

---

## Agent C — Web + Pay (TypeScript, Node 20+)

**Goal:** make Chrome visible and controllable, handle x402 end to end, and build the demo world.

**Chrome**

- **Launch command** (humans run this; Chrome requires a non-default profile for remote debugging):
  `open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/tab-chrome`
- Connect with `chrome-remote-interface` or `puppeteer-core`. Track the active tab, meaning the tab whose document has focus.
- **Injected script:** inject via `Page.addScriptToEvaluateOnNewDocument`, and register a `Runtime.addBinding('__tabEmit')` channel back to Node. The script:
    - **Collects state:** visible interactive elements (`a, button, input, select, textarea, [role=button]`), plus visible text in main content, up to 200 elements total.
    - **Element ids:** assign `data-tab-id` on first sight.
    - **Labels:** `aria-label`, then trimmed innerText, then placeholder, then name.
    - **Rects:** from `getBoundingClientRect`, converted to screen points as `x = screenX + r.x`, `y = screenY + (outerHeight − innerHeight) + r.y`. This assumes 100% zoom.
    - **Lists:** heuristic — siblings under the same parent with the same tag-and-class signature, at least 2 of them. `list.key` is the parent's path. `field` is the path inside the item. Don't add data attributes to the demo pages to make this work. Write the demo markup semantically (`<table>` / `<li>`) so the heuristic works honestly.
    - **When to emit `state`:** on mutation (debounced 150 ms), navigation, focus change, and scroll. Also poll `screenX`/`screenY` every 500 ms to catch window moves.
    - **User events:** emit `user_event` for click, change/blur (committed value), focus, and navigation.
- **Exec (Chrome actions):**
    - `click`: `Input.dispatchMouseEvent` at the rect center (convert back to page coordinates). Fall back to `el.click()`.
    - `type`: focus, then `Input.insertText`.
    - `key`: `Input.dispatchKeyEvent`.
    - `navigate`: `Page.navigate`.
    - `open_url`: open a new tab.

**402 interception (`src/pay402.ts`)**

- `Fetch.enable` with the pattern `http://*.localhost:*/*` at the Response stage. On a paused response with status 402:
    - **Decode the payment requirements** using the `@x402/core` helpers. Find the decoder in the package typings; do not hand-roll header names. Build `PaymentRequired` with `anchorRect` set to the last clicked element, or, for documents, the top center of the viewport.
    - **Document requests:** fulfill with a simple placeholder page ("Payment required") and remember the original request.
    - **Fetch/XHR requests:** continue the response unchanged. The page's JS shows "Waiting for payment…" and listens for a `tab:paid` event.
    - Run the intent check, then send `payment_required`.
- **On `pay`:**
    - Replay the original request (same method and body; get the POST data via `Fetch.getRequestPostData`) through `wrapFetchWithPaymentFromConfig` from `@x402/fetch`, with `ExactEvmScheme` from `@x402/evm` and the payer key, network `eip155:84532`.
    - **Documents:** the paid response sets a signed `tab_access` cookie. Copy it into Chrome with `Network.setCookie`, then reload.
    - **Fetch/XHR:** dispatch the result into the page with `Runtime.evaluate("window.dispatchEvent(new CustomEvent('tab:paid',{detail}))")`.
    - Decode the settlement response with the SDK to get the tx hash. Set `explorerUrl = https://sepolia.basescan.org/tx/<hash>`. Send `payment_result`.
- `dismiss_payment` just forgets the pending payment.

**Intent check (`src/intent.ts`)** — runs before every payment, in this priority order:

1. **Amount.**
    - `pagePrice`: from the triggering tab's latest state, take the element whose label matches `/\btotal\b/i` and has a currency amount in it or in the nearest following text element. If there's none, use the currency amount nearest to `anchorRect`.
    - If `|amount − pagePrice| > $0.01`, block with: `page says $<pagePrice>, payment asks $<amount>`.
2. **Payee.**
    - The first payment to a domain records its `payTo` in the ledger.
    - A later payment to the same domain with a different `payTo` is blocked with: `payee changed for <domain>`.
3. Otherwise `ok`. Always include `pagePriceUsd` in the verdict when found.

**Ledger (`src/ledger.ts`):** append-only `web/data/payments.jsonl` with `{ts, domain, payTo, amountUsd, url, txHash, ok}`.

**Demo sites (`web/demo/`)** — Express, with `@x402/express` + `@x402/evm` on Base Sepolia, facilitator from `FACILITATOR_URL`.

- **Look:** clean and believable, plain CSS. Pages should look like real sites at a glance.
- **`reviews.localhost:4001`:**
    - `/` lists 3 lamp reviews with teasers.
    - `/r/lumen-desk-lamp` is the full review, x402-priced at $0.05.
    - The middleware lets a request through if it carries a valid `tab_access` cookie (HMAC, 1 h). A paid request sets that cookie.
- **`store.localhost:4002`:**
    - **Products:** Lumen Desk Lamp $0.34, USB-C Hub $0.27, Cable Organizer $0.12.
    - **Pages:** `/p/:slug` has Add to cart. `/cart` has Checkout. `/checkout` shows `Total $X` and Place order, which the page JS posts to `/api/order/:slug` (x402 priced at the product price, payTo `PAYEE_ADDRESS`).
    - **Tampered:** `/checkout?promo=FALL` shows the same total, but Place order posts to `/api/order-promo/:slug`, priced at 10× the product price with payTo `ATTACKER_ADDRESS`.
    - **`/orders`:** a `<table>` with columns Date | Merchant | Item | Amount. It's seeded with the USB-C Hub ($0.27) and Cable Organizer ($0.12) earlier today, and new orders append to it.
- **Scripts:**
    - `scripts/new-wallets.ts` prints three fresh keys and addresses (payer, payee, attacker).
    - `scripts/balance.ts` shows the payer's USDC balance.
    - `npm run pay-test` pays for the review through Node alone (no browser) and prints the tx hash. Get this working before the browser path.
- **Prices vs. faucet:** prices are deliberately tiny so testnet USDC lasts. One full demo run (review + order) costs $0.39; the tampered $3.40 payment is always blocked and never sent. One Circle faucet drip (10 USDC) covers about 25 rehearsal runs. Amounts must stay consistent between the page and the 402.

**Done when:**

- `pay-test` settles on Base Sepolia.
- In Chrome, the review and the order both pay through the ghost.
- The tampered checkout is blocked with the exact reason string.
- `/orders` emits list metadata the pattern path can use.

---

## Milestones (Pacific time)

| By          | Milestone                                                                            | A                                                                                                | B                                                 | C                                                                    |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------- |
| 00:15       | **M0 skeleton**                                                                      | overlay draws a ghost sent via `tools/send.ts`; `--dump` works; Numbers cell report in STATUS.md | hub routes and echoes; `tools/send.ts`            | CDP connected, `state` flowing; demo sites serve; fixtures committed |
| 02:00       | **M1 web slice**                                                                     | ghosts land correctly on Chrome rects                                                            | Jev (or the LLM fallback) predicts the store flow | exec of clicks in Chrome                                             |
| 03:30       | **M2 payments**                                                                      | pay / blocked / done styles                                                                      | payment ghost flow                                | `pay-test` settles; review and order paid from the ghost             |
| 03:30–08:30 | Humans sleep. Agents keep working on tasks that don't need permissions or the faucet | Numbers exec via AX/CGEvent                                                                      | pattern path + tests on fixtures                  | tampered checkout, intent check, `/orders`                           |
| 11:00       | **M3 Numbers**                                                                       | row fill via `sequence`                                                                          | row 1 via Jev, rows 2–3 via pattern               | —                                                                    |
| 13:00       | **M4 + freeze**                                                                      | HUD polish                                                                                       | latency logs, HUD data                            | ledger link                                                          |
| 13:00–15:00 | Rehearse 5×, record the backup video by 14:30, fix demo-breaking bugs only           |                                                                                                  |                                                   |                                                                      |

## Human setup (do now, in parallel with M0)

1. Create the repo with this file, an empty `STATUS.md` (with A/B/C sections), and `.env` copied from `.env.example`.
2. Paste the Jev API docs into `docs/jev.md` and the key into `.env`.
3. Run `web/scripts/new-wallets.ts` (once C has it). Put the keys in `.env`. Fund the payer with Base Sepolia USDC from the Circle faucet. Gas isn't needed, because the facilitator pays it. Check how much the faucet gives per request.
4. Launch Chrome with the debug command above and set zoom to 100%.
5. After A's first build, grant TabShell Accessibility in System Settings → Privacy & Security.
6. Create `Expenses.numbers` with the header row Date | Merchant | Item | Amount and 3 rows from last week, matching `examples.jsonl`.
7. Arrange the screen: Chrome on the left half, Numbers on the right, one display.

## `.env.example`

```
JEV_API_KEY=
JEV_BASE_URL=
ANTHROPIC_API_KEY=
LLM_MODEL=
PAYER_PRIVATE_KEY=
PAYEE_ADDRESS=
ATTACKER_ADDRESS=
NETWORK=eip155:84532
FACILITATOR_URL=https://x402.org/facilitator
TAB_ACCESS_SECRET=
HUB_PORT=7800
CDP_PORT=9222
```
