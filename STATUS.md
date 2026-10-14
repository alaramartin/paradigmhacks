# STATUS

## A — Shell

### Done
- `shell/` builds: `shell/scripts/build-shell.sh` (`--run [args]` relaunches; log in `~/.tab/shell.log`). Signed with a stable self-signed identity "Tab Shell Dev" from its own keychain (`~/Library/Keychains/tab-shell-signing.keychain-db`, added to the user search list). DR = `identifier "dev.tab.shell" and certificate leaf = H"4f25…df22"`, the same on every rebuild, so the Accessibility grant should stick.
- Hub client with auto-reconnect: verified across hub restarts (reconnects in ≤ 2 s). Sends `hello` and `frontmost`; decodes `ghost`, `ghost_hide`, `hud`, `exec`.
- Overlay draws on the real screen: B's proof `design/proof/b-repeat-ghost-a-overlay.png`. Every kind (action, text, textarea text, pay, blocked, done, Repeat, Do the remaining N, Terminal `pillAt`) is drawn normal and high contrast by `TabShell --selftest` (on screen) and `TabShell --render out.png [--dark] [--bg img]` (offscreen; no permissions needed).
- **Terminal reader, session-log path: works.** A real `git push --progress` recorded with `script -q` gives clean lines: progress `\r` overwrites collapse to their final state, ANSI is stripped, and the PR URL is intact. The window frame comes from CGWindowList, which needs no permission. `protocol/fixtures/native_state_terminal_push.json` comes from this path. **It's provisional:** the push went to a local bare remote whose post-receive hook prints GitHub's `Create a pull request … by visiting:` lines, so the `To` line says `../origin.git`. Recapture after human setup step 6.
- Hold-to-dismiss: Tab/pedal held ≥ 600 ms dismisses at the threshold, with a bar filling on the pill. Short press on `blocked` shakes it.
### In progress
- Ghost/HUD prototype + `design/ghost-spec.md` (due 03:00), then transcribe the spec into `Overlay.swift`/`HUD.swift`.
### Blocked
- **Terminal AX path (`AXTextArea → AXValue`) not tested yet.** It needs TabShell's Accessibility grant, and the screen is locked (frontmost = `loginwindow`). Reader order is `TAB_TERM_SOURCE=auto` (AX, then `~/.tab/term.log`), `ax`, or `log` (`--term-log`).
- Input tap (Tab/Esc swallowing) is written but not running: no Accessibility grant.
- Agents can't screenshot: `screencapture` → "could not create image from display" (Ghostty has no Screen Recording).
### Needs human
- **Grant Accessibility to TabShell**: System Settings → Privacy & Security → Accessibility → enable "TabShell" (`shell/build/TabShell.app`). Then run `shell/build/TabShell.app/Contents/MacOS/TabShell --dump` with Terminal frontmost, or tell A.
- **Grant Screen Recording and Accessibility to Ghostty** (the terminal the agents run in), then restart it.
- Demo terminal fallback: if the AX path fails, start the demo Terminal tab with `script -q ~/.tab/term.log` before `git push`.

## B — Hub + Brain

### Done
_Hub ↔ A verified live on this Mac (02:0x): with B playing C (`npm run drive`), the hub's ghosts reach A's overlay and draw: ![](design/proof/b-repeat-ghost-a-overlay.png) Jev predicted "Type ENG-142" into the empty search box before the user typed (225 ms), and the pattern offered `Repeat for ENG-150 · #13` in 2.7 ms after Save. HUD counters update. Still to prove with C: real Chrome rects, exec, payments._
- `protocol/types.ts`: PLAN types verbatim + typed message unions (`ShellToHub`, `HubToShell`, `WebToHub`, `HubToWeb`, `ExecResult`). Added optional `Action.url` (see CHANGES.md).
- Hub on ws://127.0.0.1:7800 (`cd brain && npm i && npm start`). Routes, predicts, ghosts, payments, HUD, ledger click → open_url. Records every incoming message to `brain/logs/session-*.jsonl`.
- `npm run send` (tools/send.ts) for A and C:
  - `npm run send -- --ghost` → draws a test ghost on A.
  - `npm run send -- '{"to":"shell","msg":{...}}'` → delivers any message to A (or `"to":"web"` to C) verbatim.
  - `npm run send -- '{"as":"web", ...}'` → acts as C toward the hub (e.g. a payment_required). `--fixture <file>` sends a captured state.
  - `npm run send -- --listen` → prints everything the hub sends.
- Pattern rule + sequence runner + counters, unit + integration tests on synthetic tracker/release states (`npm test`, 8 passing). Pattern runs in < 2 ms.
- `npm run replay <session.jsonl> [--no-model]`, `npm run latency [N]`, `npm run drive` (acts as C: plays ticket 1 into a running hub, for testing with A before C exists).
- Ignoring is sticky: a ghost hidden by input elsewhere (A's `input`) isn't re-offered until the user acts on a page (a C `user_event`). Found live: real clicks in another app made the Repeat ghost flash back after every pause.
- No placeholder positions: a ghost with no element of its own anchors to the last clicked element (payments, done, "open URL"), else is sent with no position and A centers it at the top of the screen. **C: please still send `anchorRect` on `payment_required`.**
- **Jev model path** (`src/candidates.ts`, `src/model.ts`): code lists the possible next actions (buttons, checkboxes, select options, values copied from other pages, URLs printed in Terminal, the PR description), Jev picks the element and the value in one call. `npm run scenarios` runs every model-driven demo step live: 9–10/10 correct and shown, ~100 ms per call.

### In progress
- Retune on C's real fixtures. "Create pull request" after the description is the weakest step (right pick, confidence 0.44–0.66 against the 0.6 bar).
- Switching tests to C's real fixtures once committed.

### Blocked

### Needs human
- (none right now) Jev key is in `.env`. Base URL is `https://api.typesafe.ai` (B defaults to it when `JEV_BASE_URL` is empty).

### Jev findings (B, 01:5x)
- **Jev = TypeSafe's model.** Docs: https://docs.typesafe.ai/introduction · cookbooks: https://docs.typesafe.ai/cookbooks · raw copies of the key pages in `docs/jev.md`.
- One endpoint: `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`, body `{model:"jev-latest", state, questions}`. Questions are `choice` (≤255 options), `score`, or `noul` (yes-probability). Text only, 32k tokens for state + longest question.
- **Jev does not generate text.** It picks/scores/answers yes-no about the state you send. So B generates candidate actions in code (clicks, select options, values found on other pages, URLs in Terminal) and asks Jev one Choice: which is next. Free text like the PR description has to come from code (a template from the commit titles on the page), not from Jev.
- **Decision (humans, 02:xx): the PR description is a template from the commit titles.** We may add a text-writing LLM later (e.g. Claude, if we get an API key) to write it properly. The hook is already there: `makeDecider()` falls back to the Claude client when `ANTHROPIC_API_KEY` is set and `JEV_API_KEY` isn't; for "Jev picks, LLM writes" B would call the LLM only for the description text.
- Measured live: 0.14–0.21 s per call, picked "Type 4471-209 into Rx" at confidence 0.81 on the pharmacy form. Well under the 1.5 s budget.
- Known rough edges (docs): leans toward the first Choice option; accuracy drops with irrelevant state, so B sends only what the question needs.

### Notes for A and C (from B)
- **C — inbox email copy:** give the user a reason to tick "Text me when ready", e.g. add "Want a heads-up? Ask us to text you when it's ready." Jev only picks the checkbox when the page gives it a reason.
- **C — GitHub compare page:** B finds commit titles as `link` elements with `list` set whose path or list key contains "commit". Please check that holds on the real page when you capture `web_state_github_compare.json`, or tell B what it looks like.
- **C — `type` exec should replace the field's value**, not append. The tracker search box still says "ENG-142" when the repeat for ENG-150 types into it.
- **C — exec targets:** every `exec` now carries `action.url` for web steps; use it to pick the tab (two Chrome windows). `targetPath` is preferred, `targetId` is the fallback.
- **C — list metadata:** clicking a search result must not look like a "commit" click. B treats a `button` click as the end of a repeat unit only if the element has no `list`, so tracker result items need `list` set (they're in a `<ul>`, so your heuristic should do it).
- **C — user_events caused by our own exec** are ignored by B for 400 ms after a sequence finishes; if your echoes arrive later than that, tell B.
- **B uses a 10 min state cache, not 120 s**: C only re-emits on change, so the release page / inbox would otherwise drop out of context.
- **A — Terminal ghosts** come with `pillAt` (16 pt in from the window's bottom-left, using the `term` element's rect as the window frame) and no `rect`.

## C — Web + Pay

### Done
### In progress
### Blocked
### Needs human
