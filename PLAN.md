# PLAN.md — Tab

Agent-facing build plan for Paradigm Frontiers 2026 Hackathon, due at 4pm PT on Wednesday, October 14th. Three agents (A, B, C) build in parallel against a frozen protocol. Read the whole file before writing code. Then read only your own section in detail.

## What we're building

Tab predicts the user's next action on the Mac and shows it as a gray ghost: a highlight box plus a gray cursor on a button, or gray text inside a field. **Tab** executes it. **Esc** dismisses it. When the next step hits an HTTP 402 (x402), the ghost becomes `Pay $0.30 · tickets.localhost ⇥`, and Tab pays with testnet USDC on Base Sepolia. Before paying, Tab checks the payment request against what the page actually shows and blocks mismatches. After the user does a chore once, Tab repeats it for the next item in one keystroke, with no model call.

**The demo is the spec. If something is not needed for the demo below, do not build it.**

## UX rules (all agents)

- **No ghost, no change.** With no ghost on screen, Tab and Esc behave exactly as normal.
- **Ignoring is free.** Any other user input hides the ghost immediately.
- **Say exactly what will happen.** The pill names the action, and for payments the amount and domain: `Click Checkout ⇥`, `Repeat for ENG-150 · #13 ⇥`, `Pay $0.30 · tickets.localhost ⇥`.
- **Don't interrupt typing.** Model ghosts appear only after 600 ms with no user input. Pattern ghosts appear right after the unit completes.
- **Refuse loudly.** `blocked` ghosts are red. Tab does nothing on them; Esc (or a long press) dismisses.
- **Only the user pays.** Tab never pays, or repeats a payment, without a Tab press on a `pay` ghost.

## Demo script (acceptance test for the whole system)

**Setup:**

- One display. Chrome runs on the debug profile at 100% zoom, logged into GitHub. The HUD sits in the top right.
- A USB foot pedal or large button that sends Tab is on the table (flow 4).
- The HUD counters ("Tab did" / "You did") run across all four flows and are revealed at the end.

### 1. Buy tickets, and get stopped by a junk fee

Layout: Chrome on the left half.

1. On `tickets.localhost:4001/e/night-owls` (GA $0.15), the user sets Qty to 2. Ghost: `Click Checkout ⇥` → Tab.
2. The checkout page shows `Total $0.30`. Ghost: `Click Buy tickets ⇥` → Tab. The page's fetch returns 402.
3. Ghost: `Pay $0.30 · tickets.localhost ⇥` → Tab. `Paid $0.30 ✓`, two ticket cards render, and the HUD shows the tx.
4. Same show on `resale.localhost:4002`. Checkout shows `Total $0.30`, but the 402 asks for $0.51 to a different address. Red ghost: `Blocked · page says $0.30, payment asks $0.51`. Tab does nothing. Esc dismisses.
5. Clicking "ledger" in the HUD opens Basescan (Sepolia) on the last transaction.

### 2. From `git push` to an open pull request

Layout: Chrome on the left, Terminal on the right. The local clone of the demo repo is on branch `fix/checkout-rounding` with 2 unpushed commits.

1. The user types `git push -u origin fix/checkout-rounding`. GitHub's `remote: Create a pull request for … by visiting: https://github.com/…/pull/new/fix/checkout-rounding` appears. Ghost pill at the bottom of the Terminal window: `Open pull request ⇥` → Tab. Chrome comes to the front on that URL.
2. On GitHub's "Open a pull request" page, gray ghost text fills the empty description, written from the commits on the page and in Terminal → Tab.
3. *(Cut first if flaky.)* `Request review from @<teammate> ⇥` → Tab.
4. `Click Create pull request ⇥` → Tab. The PR opens.

### 3. Release day: teach once, then repeat

Layout: Chrome window on the left showing the GitHub release `v1.4.0`, whose notes are a markdown table `Ticket | Change | PR` with 6 rows. Chrome window on the right showing `tracker.localhost:4003`, with the same 6 tickets in "In review".

1. **Ticket 1, by the user.** In the tracker: type `ENG-142` in search, click the result, set Status → Done, type `#12` in Linked PR, click Save. (If a model ghost offers a correct step, accepting it is fine. Executed actions count toward the pattern.)
2. Ghost: `Repeat for ENG-150 · #13 ⇥` → Tab. Ticket 2 is done in one go. HUD: `pattern · 0 model calls · <10 ms`.
3. Ghost: `Repeat for ENG-151 · #14 ⇥` → Tab.
4. Ghost: `Do the remaining 3 ⇥` → Tab. All six tickets show Done.

### 4. Accessibility: one button

Layout: Chrome window on the left showing `inbox.localhost:4004` with the email "Rx 4471-209 is ready to refill at Oak St. Pick up after 5 pm." Chrome window on the right showing `pharmacy.localhost:4005/refill`. High-contrast ghosts on. The presenter uses only the pedal (tap = Tab, hold ≥ 600 ms = dismiss).

1. Gray `4471-209` in the Rx field → press.
2. `Select Oak St ⇥` → press.
3. `Click 5:30 pm ⇥` (a small time chip) → press.
4. `Check "Text me when ready" ⇥` → press.
5. `Click Request refill ⇥` → press. The fetch returns 402.
6. `Pay $0.05 · pharmacy.localhost ⇥` → press. "Refill requested ✓".
7. Reveal the HUD totals. Then play the pre-recorded clip of the same form done with macOS Switch Control, timed.

## Rules for all agents

- **Own only your directory.** `protocol/` is shared and frozen after M0. Changes after that must be additive optional fields, recorded in `protocol/CHANGES.md` with a one-line reason.
- **Testnet only.** Never commit keys. `.env` is gitignored.
- **Don't write SDK calls from memory.** This applies to x402 v2, CDP (especially `Fetch.*`), and the AX APIs. x402 v2 renamed packages (`@x402/*`) and headers. Read the typings in `node_modules` or the protocol docs before writing calls.
- **Keep your section of `STATUS.md` current,** using the headings Done / In progress / Blocked / Needs human. If you're blocked on a human action (permissions, faucet, GitHub login, Jev docs), write it under Needs human and move on to other work.
- **Commit small and often.** `main` must always build and run. Pull with rebase before every push.
- **Respect the latency budget.** From a state change to a ghost on screen: ≤ 50 ms on the pattern path, ≤ 1.5 s via the model. Log latency on every prediction.

## Not building (cut from the first plan; do not add back)

Numbers and any native-app spreadsheet; AX tree walks of arbitrary apps; row/col cells; native click and typing capture; native click/type execution; the Jev → LLM cascade; `examples.jsonl` retrieval; the reviews paywall; HMAC access cookies; paid document loads; per-domain payee memory.

## Architecture

```
TabShell.app (Swift, Agent A) ──ws──┐
                                     ├──  Hub + Brain (TypeScript, Agent B)   ws://127.0.0.1:7800
Web + Pay (TypeScript, Agent C) ──ws─┘
      │ CDP 127.0.0.1:9222
   Chrome (debug profile) ── github.com (real) + demo sites (one Express app, Agent C):
                              tickets :4001 · resale :4002 · tracker :4003 · inbox :4004 · pharmacy :4005
```

| Component                      | Owns                                                                                                                                     | Does not touch               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **A — Shell** (`shell/`)       | overlay and HUD; global Tab/Esc/hold tap and the input counter; frontmost app; reading Terminal's text; activating apps                  | Chrome, prediction, payments |
| **B — Hub + Brain** (`brain/`) | websocket hub and routing; the predict loop; the pattern rule; one model client; the sequence runner; counters; prediction logs          | Drawing, executing, payments |
| **C — Web + Pay** (`web/`)     | Chrome via CDP (perception, user events, single-step execution); 402 hold → pay → fulfill; intent check; ledger; demo sites; demo reset | Native apps, prediction      |

**Routing rule:** an action whose `app === "com.google.Chrome"` executes in C. `switch_app` executes in A. **Only the hub runs sequences.** A and C execute single steps. Before running a step in an app that isn't frontmost, the hub sends A a `switch_app` for it. Ghosts are always drawn by A, using screen-point rects from whichever source owns the element.

## Repo layout

```
PLAN.md  STATUS.md  .env.example
protocol/  types.ts  CHANGES.md  fixtures/                                   # shared, frozen after M0
shell/     Package.swift  Sources/TabShell/...  scripts/build-shell.sh       # A
brain/     package.json  src/{hub,predict,pattern,model,prompt,seq,counters,log}.ts  tools/   # B
web/       package.json  src/{cdp,state,exec,pay402,intent,ledger}.ts  demo/  scripts/          # C
docs/      jev.md                                                           # humans paste the Jev API docs here, if Jev is required
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
    | "select"
    | "checkbox"
    | "text"
    | "other";

export interface El {
    id: string; // stable across snapshots where possible
    role: Role;
    label: string; // accessible name or visible text, ≤ 80 chars
    value?: string; // current value (fields); for Terminal, the last 40 lines
    options?: string[]; // role 'select' only: option labels
    checked?: boolean; // checkboxes and pressed toggle buttons
    rect: Rect;
    enabled: boolean;
    path?: string; // CSS path for web. Replays resolve targets by path.
    list?: { key: string; index: number; field?: string }; // item in a repeated structure; field = path relative to the item
}

export interface ScreenState {
    type: "state";
    source: "native" | "web";
    app: string; // bundle id: 'com.google.Chrome' for web, e.g. 'com.apple.Terminal' for native
    window: string;
    url?: string;
    focused: boolean; // web: this tab is in the focused Chrome window. native: always true
    elements: El[]; // visible only, ≤ 200, interactive first, then text
    seq: number; // monotonic per source
    ts: number;
}

export interface UserEvent {
    // web only (C). A reports native input as anonymous `input` messages.
    type: "user_event";
    source: "web";
    app: string;
    url: string;
    kind: "click" | "type" | "key" | "focus" | "navigate";
    target?: El;
    value?: string; // committed text or selected option label, key name, or url
    ts: number;
}

export type Op = "click" | "type" | "key" | "navigate" | "switch_app" | "sequence";

export interface Action {
    op: Op;
    app: string;
    targetId?: string; // id in the latest state of `app`
    targetPath?: string; // used by replays; resolved against the latest state
    value?: string; // text, option label (for selects), key name, url, or bundle id
    steps?: Action[]; // op === 'sequence'; run by the hub only
    label: string; // pill text without the key glyph, e.g. "Click Checkout", "Repeat for ENG-150 · #13"
    confidence: number; // 0..1
    source: "pattern" | "model";
}

export interface Ghost {
    id: string;
    kind: "action" | "text" | "pay" | "blocked" | "done";
    label: string; // e.g. "Click Checkout ⇥", "Pay $0.30 · tickets.localhost ⇥"
    rect?: Rect; // highlight box; omitted for Terminal ghosts
    cursor?: { x: number; y: number };
    pillAt?: { x: number; y: number }; // pill position when there is no rect
    ghostText?: string; // gray inline text for kind 'text'
    ttlMs?: number; // auto-hide, used for 'done'
}

export interface Hud {
    mode: "idle" | "predicting" | "shown" | "running";
    lastSource?: "pattern" | "model";
    lastLatencyMs?: number;
    modelCalls: number;
    shown: number;
    accepted: number;
    tabDid: { clicks: number; keys: number }; // what Tab executed for the user
    youDid: number; // every real user input, including Tab/Esc presses
    lastTx?: { hash: string; explorerUrl: string; amountUsd: string };
}

export interface PaymentRequired {
    type: "payment_required";
    paymentId: string;
    url: string;
    method: string;
    payeeDomain: string; // hostname shown to the user
    payTo: string;
    amountUsd: string; // "0.30"
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
A → hub:  hello{role:'shell'} | frontmost{app, window} | state(native, Terminal only) | input{kind:'key'|'click'}
          | accept{ghostId} | dismiss{ghostId} | exec_result{ghostId, ok, error?} | hud_click{item:'ledger'|'contrast'}
hub → A:  ghost{ghost} | ghost_hide{} | exec{ghostId, action}  (switch_app only) | hud{hud}
C → hub:  hello{role:'web'} | state(web) | user_event(web) | payment_required | payment_result | exec_result{...}
hub → C:  exec{ghostId, action}  (single step) | pay{paymentId} | dismiss_payment{paymentId} | open_url{url}
```

`input` carries no key identity or text, only the kind. Sequence steps use `ghostId = "<ghostId>:<stepIndex>"`.

**Pill formats:**

- Action: `Click Checkout ⇥`, `Open pull request ⇥`
- Text: inline gray text plus `⇥`
- Repeat: `Repeat for ENG-150 · #13 ⇥`, then `Do the remaining 3 ⇥`
- Pay: `Pay $0.30 · tickets.localhost ⇥`
- Blocked: `Blocked · <reason>` (red, no ⇥)
- Done: `Paid $0.30 ✓` (1500 ms)

**Fixtures:** at M0, A commits `protocol/fixtures/native_state_terminal_push.json`. C commits `web_state_tickets_checkout.json`, `web_state_github_compare.json`, `web_state_github_release.json`, `web_state_tracker.json`, and `web_state_pharmacy.json`. All must be captured from the real apps and pages. B develops against these.

---

## Agent A — TabShell (Swift, macOS 14+)

**Goal:** draw ghosts and the HUD, own the Tab/Esc keys, read Terminal, and activate apps. Nothing else native.

**Build and permissions**

- **Build:** a SwiftPM executable, wrapped into `shell/build/TabShell.app` by `scripts/build-shell.sh`. The Info.plist sets `LSUIElement=true` and bundle id `dev.tab.shell`. The script also codesigns the bundle.
- **Signing:** sign with a stable identity, so the Accessibility grant survives rebuilds (ad-hoc signatures change on every build and macOS drops the grant). If no identity exists, create a self-signed code-signing certificate in Keychain once and use it from the script. If events stop after a rebuild anyway, write "re-grant Accessibility" under Needs human.
- **Connection:** connect to `ws://127.0.0.1:7800` with auto-reconnect.

**Frontmost app**

- Track it with `NSWorkspace.didActivateApplicationNotification`. Send `frontmost` on every change.
- Never report `dev.tab.shell` itself as frontmost.

**Terminal reader (the only native perception)**

- While Terminal (`com.apple.Terminal`) or iTerm2 (`com.googlecode.iterm2`) is frontmost, poll every 300 ms: focused window → its `AXTextArea` → `AXValue`. Keep the last 40 lines.
- When the text changed, send a native `state` with one element: `{id:'term', role:'textarea', label:'Terminal', value:<last 40 lines>, rect:<window frame>}`.
- **First task in hour 1:** run `TabShell --dump` with Terminal frontmost and record in STATUS.md whether the text is readable. If it isn't, try iTerm2. If neither works, fall back to tailing a session log: the demo terminal runs `script -q ~/.tab/term.log` and A reads that file and strips the ANSI escapes. Report which path you used.

**Input tap**

- Use one `CGEventTap` at the session level on keyDown, keyUp, and leftMouseDown. Keep the callback fast: no AX calls and no network writes inside it (enqueue them). Re-enable the tap on `tapDisabledByTimeout` and `tapDisabledByUserInput`.
- **Our own events:** every synthetic event we post carries `eventSourceUserData = 0x7AB`. The tap passes these through and never counts them.
- **Tab (keycode 48) while an `action`, `text`, or `pay` ghost is visible:** swallow keyDown, its autorepeats, and keyUp. On keyUp, a press held < 600 ms sends `accept{ghostId}`; a press held ≥ 600 ms sends `dismiss{ghostId}` (single-switch users have no Esc).
- **Tab while a `blocked` ghost is visible:** swallow it and do nothing (a short shake of the pill is fine). A hold ≥ 600 ms dismisses.
- **Esc (keycode 53) while any ghost is visible:** swallow it and send `dismiss{ghostId}`.
- **No ghost visible, or a `done` ghost:** pass Tab and Esc through untouched.
- **Every other real keyDown or mouseDown:** hide the ghost locally and send `input{kind}`. No key codes, no text.
- **Secure fields:** when `IsSecureEventInputEnabled()` is true, send nothing for typing.

**Overlay**

- One borderless, transparent, click-through `NSWindow` (`ignoresMouseEvents = true`) at `.statusBar` level, joining all spaces.
- **Coordinates:** convert from AX/top-left to AppKit/bottom-left with `y_ns = mainScreenHeight − y − h`.
- **Draw:**
    - a rounded highlight box, 2 px stroke, gray #8E8E93 at 70% opacity;
    - a gray arrow cursor at `cursor`;
    - a pill next to the rect, or at `pillAt` when there's no rect (Terminal ghosts);
    - for `text` ghosts, the ghost text in gray inside the rect at the left inset, wrapped for textareas (the demo fields are empty, so no caret math);
    - `blocked` ghosts in red;
    - `done` ghosts that auto-hide after `ttlMs`.
- **High contrast:** a 4 px outline in #FFD60A, the pill at 1.5× size, ghost text at full opacity. Toggled from the HUD (`hud_click{item:'contrast'}` also flips it locally) or with `--high-contrast`.

**HUD**

- A small `NSPanel` with `.nonactivatingPanel` in the top right, so clicking it never steals focus.
- It shows `mode`, source, latency, model calls, shown/accepted, **Tab did** (clicks · keys), **You did**, and the last tx with a "ledger" button. Clicking "ledger" sends `hud_click{item:'ledger'}`.

**Execute (`exec` from the hub)**

- `switch_app`: activate the app with that bundle id, then send `exec_result`. That's the only native op.

**Self-tests**

- `TabShell --selftest` draws one ghost of every kind at fixed rects, in normal and high-contrast modes.
- `TabShell --dump` prints one Terminal snapshot as JSON.

**Done when:** a ghost sent with `tools/send.ts` lands exactly on a Chrome element. A Terminal ghost's pill sits at the bottom of the Terminal window. Tab, Esc, and pedal hold behave as above. The HUD counters update.

---

## Agent B — Hub + Brain (TypeScript, Node 20+)

**Goal:** route messages, decide what to predict and when, run sequences, and keep the pattern rule fast.

**Hub (`src/hub.ts`)**

- Websocket server on `127.0.0.1:7800`.
- **State tracking:** keep the latest state per app and per URL, plus a cache of the last state per URL or app for the past 120 s. That cache is the cross-app context.
- **Active source:** the frontmost app reported by A. If it's Chrome, use the web state with `focused: true`.
- **On a new active state:** debounce 150 ms, increment `gen`, and call `predict(gen)`. Drop the result if `gen` has moved on. Show a ghost when `confidence ≥ 0.6`. Build the ghost's rect and cursor from the target element's rect. For Terminal ghosts, omit `rect` and set `pillAt` to 16 pt in from the bottom-left of the Terminal window.
- **On user input** (`input` from A, or any `user_event` from C not caused by our own exec): hide the current ghost, increment `gen`, and predict again only after 600 ms with no further input. C's `user_event`s also go into history.
- **On `accept`:** a single-step action routes by app (with a `switch_app` to A first if its app isn't frontmost); a `sequence` goes to the sequence runner. On success, append the executed steps to history and re-predict after the next state arrives.
- **Payments:**
    - A `payment_required` message preempts any action ghost. If `verdict.ok`, show a `pay` ghost at `anchorRect`. Otherwise show `blocked` with `verdict.reason`.
    - `accept` on a pay ghost sends `pay` to C. `dismiss` sends `dismiss_payment`.
    - On `payment_result`: if `ok`, show a `done` ghost and update `hud.lastTx`; otherwise show `blocked` with the error.
- **HUD:** send a `hud` update after every prediction, exec, input, and payment event. On `hud_click` for ledger, send `open_url(lastTx.explorerUrl)` to C.

**Sequence runner (`src/seq.ts`)**

- Run steps in order. For each step: if its app isn't frontmost, send A `switch_app` first. Resolve the target by `targetPath` in the latest state of that app (fall back to `targetId`). Send `exec` and wait for `exec_result`, then wait for the next `state` from that app (max 1000 ms) before the next step.
- On a failed step, stop, hide the ghost, and log the error. No retries.
- HUD `mode` is `running` while a sequence runs. User input during a sequence is ignored except Esc, which stops it after the current step.

**Counters (`src/counters.ts`)**

- **Tab did,** from executed steps: `click`, `navigate`, `switch_app`, and a `type` into a select = 1 click each; any other `type` = `value.length` keys; `key` = 1 key. Payments count 0.
- **You did:** every `input`, `accept`, and `dismiss` from A.

**Predict order (`src/predict.ts`)**

1. Pattern rule, synchronous, ≤ 10 ms. If it returns an action, use it.
2. One model call (`src/model.ts`) with a 1500 ms target and a 3000 ms hard timeout. Behind one interface, `decide(input): Promise<Action|null>`. Use Jev if `docs/jev.md` and `JEV_API_KEY` exist (sponsor requirement); otherwise the Anthropic Messages API with the model from env `LLM_MODEL`, JSON output only.

**Model input** (one compact JSON):

- the active state, trimmed to 120 elements;
- the cached state of each other recent app or page, trimmed to 60 elements each (Terminal: its 40 lines);
- the last 15 history entries;
- 6–8 inline examples in `src/prompt.ts`: store checkout steps, the GitHub push → PR steps, and the pharmacy refill form;
- the output schema: `op` enum, `targetId` enum (from the active state's ids), `value`, `label`, `confidence`.

**Pattern rule (`src/pattern.ts`)** — the technical centerpiece. Write it explicitly.

- **History H:** the last 50 entries (C's user events and executed steps). Each entry has op, app, url, target `{id, path, list}`, value, and ts.
- **Trigger:** the newest entry is a click on a `button` in a web page.
- **Unit U:** the entries on that same URL since the previous trigger click on that URL (exclusive) through this click (inclusive). 2–12 steps.
- **Provenance:** for each `type` step value `v`, search the cached states of *other* URLs (last 120 s) for an element with `list` set whose label or value equals `v`. Normalize by trimming whitespace and ignoring case. Normalize currency, so `"$0.34" == "0.34" == ".34"`. Record `prov = {listKey, index, field}`.
- **Valid unit:** at least one step has provenance, and every step with provenance has the same `listKey` and the same `index i`.
- **Next unit:**
    - steps with provenance take their value from the latest cached list `listKey` at index `i + 1`, same `field`;
    - every other step repeats exactly: same op, same `targetPath`, same value;
    - if index `i + 1` doesn't exist, there is no prediction.
- **Output:** `Action{op:'sequence', label:'Repeat for <prov values of i+1, joined by " · ">', source:'pattern'}` with confidence 0.85 if the unit has been seen once and 0.97 if it's been seen two or more times.
- **Batch:** after two accepted repeats of the same unit, offer `Do the remaining N`: one sequence containing every remaining unit.
- **Tests:** unit tests on `web_state_github_release.json` plus `web_state_tracker.json` and a synthetic history of ticket 1. Assert the exact steps and values for ticket 2 and the batch.

**Logs:** append to `brain/logs/predictions.jsonl` with `{ts, gen, source, latencyMs, action, shown, accepted}`.

**Tools:**

- `tools/send.ts`, to send any protocol message by hand (A and C use it to test against the hub).
- `npm run replay <session.jsonl>`, to replay a recorded session and print each prediction with its latency.

**Done when:** replaying recorded sessions of all four flows produces the right ghost at every step. The pattern rule offers `Repeat for ENG-150 · #13` right after ticket 1 is saved, in < 10 ms. Model predictions take < 1.5 s.

---

## Agent C — Web + Pay (TypeScript, Node 20+)

**Goal:** make Chrome visible and controllable, handle x402 end to end, and build the demo world.

**Chrome**

- **Launch command** (humans run this; Chrome requires a non-default profile for remote debugging):
  `open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/tab-chrome`
- Connect with `chrome-remote-interface` or `puppeteer-core`. Track every window's visible tab (the demo uses two windows side by side). Mark the tab in the focused window `focused: true`.
- **Injected script:** inject via `Page.addScriptToEvaluateOnNewDocument`, and register a `Runtime.addBinding('__tabEmit')` channel back to Node. The script:
    - **Collects state:** visible interactive elements (`a, button, input, select, textarea, [role=button]`), plus visible text in main content, up to 200 elements total. For `select`, include `options`. For checkboxes and `aria-pressed` buttons, include `checked`.
    - **Element ids:** assign `data-tab-id` on first sight. Also emit a CSS `path` for every element.
    - **Labels:** `aria-label`, then trimmed innerText, then placeholder, then name.
    - **Rects:** from `getBoundingClientRect`, converted to screen points as `x = screenX + r.x`, `y = screenY + (outerHeight − innerHeight) + r.y`. This assumes 100% zoom and is computed per window.
    - **Lists:** heuristic: siblings under the same parent with the same tag-and-class signature, at least 2 of them. `list.key` is the parent's path. `field` is the path inside the item. This must work on GitHub's rendered markdown table (`tbody > tr`, with each `td` and its `a` as fields). Don't add data attributes to the demo pages to make this work. Write the demo markup semantically (`<table>` / `<ul>`) so the heuristic works honestly.
    - **When to emit `state`:** on mutation (debounced 150 ms), navigation, focus change, and scroll. Also poll `screenX`/`screenY` every 500 ms to catch window moves.
    - **User events:** emit `user_event` for click, change/blur (committed value; for selects, the chosen option's label), focus, and navigation.
- **Exec (single steps only):**
    - Resolve the target by `targetPath` if given, else by `targetId`.
    - `click`: `Input.dispatchMouseEvent` at the rect center (converted back to page coordinates). Fall back to `el.click()`.
    - `type`: for a `select`, choose the option whose label matches `value` and dispatch `input` and `change`. Otherwise focus the element and use `Input.insertText`.
    - `key`: `Input.dispatchKeyEvent`.
    - `navigate`: `Page.navigate` in the focused tab.
    - `open_url`: open a new tab.

**402 hold → pay → fulfill (`src/pay402.ts`)**

All paid actions on the demo sites are `fetch` POSTs from page JS. No paid document loads.

- `Fetch.enable` with the pattern `http://*.localhost:*/*` at the Response stage. On a paused response with status 402:
    - **Decode the payment requirements** with the `@x402/core` helpers. Find the decoder in the package typings; do not hand-roll header names. Build `PaymentRequired` with `anchorRect` set to the last clicked element.
    - **Keep the request paused.** The page's own pending fetch is the "waiting" state.
    - Run the intent check, then send `payment_required`.
- **On `pay`:**
    - Replay the original request from Node (same method, headers minus hop-by-hop ones, and body from `Fetch.getRequestPostData`) through `wrapFetchWithPaymentFromConfig` from `@x402/fetch`, with `ExactEvmScheme` from `@x402/evm`, the payer key, and network `eip155:84532`.
    - Fulfill the paused request with the paid response's status, headers, and body (`Fetch.fulfillRequest`). The page renders the result with no Tab-specific code.
    - Decode the settlement response with the SDK to get the tx hash. Set `explorerUrl = https://sepolia.basescan.org/tx/<hash>`. Send `payment_result`.
- **On `dismiss_payment`:** let the original 402 through to the page, and forget the payment. Check the CDP docs for the right call for a request paused at the Response stage.
- **First task in hour 1:** hold a paused 402 fetch for 60 s, then fulfill it, and confirm the page renders the result. Record the result in STATUS.md.

**Intent check (`src/intent.ts`)** — runs before every payment:

- `pagePrice`: from the triggering tab's latest state, take the element whose label matches `/\btotal\b/i` and has a currency amount in it or in the nearest following text element. If there's none, use the currency amount nearest to `anchorRect`.
- If `|amount − pagePrice| > $0.01`, block with: `page says $<pagePrice>, payment asks $<amount>`.
- Otherwise `ok`. Always include `pagePriceUsd` in the verdict when found.

**Ledger (`src/ledger.ts`):** append-only `web/data/payments.jsonl` with `{ts, domain, payTo, amountUsd, url, txHash, ok}`.

**Demo sites (`web/demo/`)** — one Express app (`web/demo/server.ts`) listening on five ports, with `@x402/express` + `@x402/evm` on Base Sepolia and the facilitator from `FACILITATOR_URL`.

- **Look:** clean and believable, plain CSS, a distinct look per site. Pages should look like real sites at a glance.
- **`tickets.localhost:4001`:**
    - `/e/night-owls`: "Night Owls · live at Hall 9 · Fri 9pm", General admission $0.15, a Qty select (1–4), and Checkout.
    - `/checkout?qty=N` shows `Total $X` and Buy tickets. That button `fetch`-POSTs to `/api/buy`, x402-priced at N × $0.15 with payTo `PAYEE_ADDRESS`, and the page renders N ticket cards from the JSON.
- **`resale.localhost:4002`:** the same flow with a different look. Checkout shows the same total, but `/api/buy` is priced at N × $0.255 (N = 2 → $0.51) with payTo `ATTACKER_ADDRESS`.
- **`tracker.localhost:4003`:** a single page with no reloads. A search box filters a `<ul>` of tickets as you type. Clicking a ticket opens a side panel with Status (`<select>`: Backlog / In review / Done), Linked PR (text field), and Save. Save closes the panel. It's seeded with ENG-142, ENG-150, ENG-151, ENG-155, ENG-157, and ENG-160, all "In review". State is in memory, and `POST /api/reset` restores it.
- **`inbox.localhost:4004`:** a simple mail client with the pharmacy email open: "Rx 4471-209 is ready to refill at Oak St. Pick up after 5 pm."
- **`pharmacy.localhost:4005/refill`:** an Rx number field, a Pickup location `<select>` (Main St / Oak St / Elm Ave), time chips (`<button aria-pressed>`: 4:00, 5:30, 7:00 pm), a small "Text me when ready" checkbox, and Request refill. That button `fetch`-POSTs to `/api/refill`, x402-priced at $0.05 with payTo `PAYEE_ADDRESS`, and the page shows "Refill requested ✓".
- **Scripts:**
    - `scripts/new-wallets.ts` prints three fresh keys and addresses (payer, payee, attacker).
    - `scripts/balance.ts` shows the payer's USDC balance.
    - `npm run pay-test` buys 2 tickets through Node alone (no browser) and prints the tx hash. Get this working before the browser path.
    - `scripts/reset-demo.ts` resets the tracker, and with `gh` closes the demo PR, deletes the remote `fix/checkout-rounding` branch, and restores the local branch to its 2 unpushed commits.
- **Prices vs. faucet:** prices are deliberately tiny so testnet USDC lasts. One full demo run (tickets + refill) costs $0.35; the $0.51 resale payment is always blocked and never sent. One 10 USDC faucet drip covers about 28 rehearsal runs. Amounts must stay consistent between the page and the 402.

**Done when:**

- `pay-test` settles on Base Sepolia.
- In Chrome, the tickets and the refill both pay through the ghost.
- The resale checkout is blocked with the exact reason string.
- The GitHub release table and the tracker list both emit list metadata the pattern rule can use.
- `reset-demo` returns everything to the starting state in one command.

---

## Milestones (Pacific time, Wednesday)

| By          | Milestone                                                                     | A                                                                                       | B                                                         | C                                                                                     |
| ----------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 02:00       | **M0 skeleton**                                                               | overlay draws every ghost kind via `tools/send.ts`; `--dump` Terminal report in STATUS.md | hub routes and echoes; `tools/send.ts`; model latency measured | CDP state flowing from two windows; tickets site serves; 402 hold test done; fixtures committed |
| 04:00       | **M1 flow 1**                                                                 | ghosts land on Chrome rects; pay / blocked / done styles                                 | model predicts flow 1; payment ghost flow                 | `pay-test` settles; tickets paid from the ghost; resale blocked                       |
| 04:00–08:30 | Humans sleep. Agents keep working on tasks that don't need permissions, the faucet, or GitHub login | HUD with counters, ledger, high contrast; pedal hold                                    | pattern rule + tests on fixtures; sequence runner          | tracker, inbox, pharmacy sites; select support; `reset-demo`                          |
| 10:30       | **M2 flows 2 + 3**                                                            | live Terminal state; `switch_app`                                                       | push → PR predictions; repeat live on the tracker          | GitHub compare and release pages perceived correctly                                  |
| 12:30       | **M3 flow 4 + polish**                                                        | high-contrast polish                                                                    | counters correct across all flows; latency logs           | refill paid from the ghost                                                            |
| 13:00       | **Freeze**                                                                    |                                                                                         |                                                           |                                                                                       |
| 13:00–15:00 | Rehearse 5×, record the backup video by 14:30, fix demo-breaking bugs only    |                                                                                         |                                                           |                                                                                       |

## Human setup (do now, in parallel with M0)

1. Create `STATUS.md` (with A/B/C sections) and `.env` copied from `.env.example`.
2. If Jev is a sponsor requirement, paste the Jev API docs into `docs/jev.md` and the key into `.env`. Otherwise set `ANTHROPIC_API_KEY` and `LLM_MODEL`.
3. Run `web/scripts/new-wallets.ts` (once C has it). Put the keys in `.env`. Fund the payer with Base Sepolia USDC from the Circle faucet. Gas isn't needed, because the facilitator pays it. Check how much the faucet gives per request.
4. Quit regular Chrome. Launch Chrome with the debug command above, set zoom to 100%, and log into GitHub in that profile.
5. After A's first build, grant TabShell Accessibility in System Settings → Privacy & Security.
6. **GitHub demo repo:** create a throwaway repo and set `GITHUB_DEMO_REPO`. Clone it locally with branch `fix/checkout-rounding` holding 2 unpushed commits, and no PR template. Publish release `v1.4.0` whose notes are a markdown table `Ticket | Change | PR` with 6 rows (ENG-142 #12, ENG-150 #13, ENG-151 #14, ENG-155 #15, ENG-157 #16, ENG-160 #17, using real PR numbers if you have them). Run `gh auth login` for the reset script.
7. Get a USB foot pedal or large button that sends Tab. Fallback: a spare keyboard with every key taped over except Tab and Esc.
8. Record the Switch Control comparison: turn on Switch Control (System Settings → Accessibility → Switch Control) and fill the pharmacy form with it. Keep the clip with a visible timer.
9. Arrange each flow's windows as described in the demo script. One display.

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
GITHUB_DEMO_REPO=
HUB_PORT=7800
CDP_PORT=9222
```
