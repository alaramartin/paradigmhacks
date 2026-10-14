# Ghost and HUD spec (frozen)

Frozen 2026-10-14 after 4 rounds on `design/ghost/index.html`. It supersedes the default numbers in PLAN.md's "Overlay" section. Proof: `design/proof/ghost-prototype-full.png` (full size) and `design/proof/ghost-prototype-50.png` (50%, the back of the room).

All sizes are in points. Colours are sRGB hex plus alpha (α). "Screen" means top-left screen points, the same as the protocol and the flipped overlay view. The prototype's `renderGhost()` implements this spec one to one, so if a value here is unclear, read it there.

## Idea

The ghost should look like a suggestion, not a dialog: a graphite outline, a quiet slate pill, and a **keycap** at the right end of the pill that names the key to press (`tab`, or `esc` on blocked). The keycap is the one memorable element. It teaches the interaction to the audience without words, and it fills while the pedal is held. Money changes the colour: pay is Base blue, blocked is red, done is green. High contrast switches everything to black and yellow at 1.5×.

## Palette

| Token | Hex | Use |
|---|---|---|
| graphite | `#8E8E93` | box stroke, halo, cursor, ghost text |
| slate | `#636366` | action/text pill fill |
| pay | `#0052FF` | pay box + pill (Base blue) |
| payHC | `#0040D6` | pay pill in high contrast |
| blockFill | `#D70015` | blocked pill fill (white text 5.9:1) |
| blockStroke | `#FF3B30` | blocked box stroke, halo, fill |
| doneFill | `#248A3D` | done pill fill (white text 4.6:1) |
| doneStroke | `#34C759` | done box stroke, halo, fill |
| hc | `#FFD60A` | high-contrast outline, keycap, pill text |
| black | `#000000` | high-contrast rings, pill fill, ghost text |

## Geometry (normal → high contrast)

| Name | Normal | HC | Notes |
|---|---|---|---|
| boxOutset | 3 | 5 | box path = element rect outset by this |
| boxRadius | 7 | 9 | corner radius of the box path (stroke centreline) |
| boxStroke | 2.5 | 4 | blocked normal = 3.0 |
| halo | 3 wide | none | outside the stroke: path outset by `boxStroke/2 + 1.5`, radius `boxRadius + boxStroke/2 + 1.5`, lineWidth 3 |
| hcRings | none | 1.5 black on both sides | draw the box path in black at lineWidth `4 + 2×1.5 = 7`, then in the kind's colour at lineWidth 4 |
| pill font | SF Pro 14 semibold | 21 semibold | `NSFont.systemFont(ofSize:weight:.semibold)` |
| pillH | 28 | 42 | capsule, radius = pillH/2 |
| padL | 12 | 18 | left padding to the icon/text |
| padR (no key) | 12 | 18 | |
| keyInset | 3 | 4.5 | key's top/bottom/right inset inside the pill |
| key height | 22 | 33 | = pillH − 2·keyInset |
| key minWidth | 33 | 49.5 | = 1.5 × key height |
| key padH | 6 | 9 | |
| key radius | 5 | 7.5 | |
| key font | SF Pro 12 semibold | 18 semibold | |
| keyGap | 8 | 12 | text → key |
| icon | 13 square | 19.5 | left of the text, gap 6 (HC 9) |
| gap | 6 | 8 | box → pill |
| clamp | 4 | 4 | pill stays 4 pt inside the visible frame (below the menu bar) |

## Pill content

- **Key glyph.** Strip a trailing `⇥` from `label`. If it was there, draw a keycap labelled `tab`. A `blocked` ghost always gets a keycap labelled `esc`. A `done` ghost has no keycap.
- **Two weights.** Split the label at its first ` · `. The head is semibold at full alpha. The tail is drawn as `· <rest>`, regular weight, text colour at α .82, after a 4.2 pt gap (0.3 em; HC 6.3). In AppKit, draw one attributed string: `head` + ` · rest` with the tail attributes. Examples: **Pay $0.30** · tickets.localhost, **Repeat for ENG-150** · #13, **Blocked** · page says $0.30, payment asks $0.51.
- **Icons.** `blocked`: a circle-slash, 12-unit viewBox, circle r 4.9 at (6,6) and a line (2.6,9.4)→(9.4,2.6), stroke 1.6 in the pill's text colour. `done`: strip a trailing `✓` and draw a check path (2.2,6.4)→(4.9,9)→(9.8,3.2), stroke 1.8, round caps and joins. Scale the icon to its size (13 or 19.5).
- **Key-only pill.** A `text` ghost's label is just `⇥`, so the pill is the keycap plus a `keyInset` ring of pill fill. Left padding is `keyInset`.

## Per kind, normal mode (light and dark backgrounds)

Every normal pill also gets a **1 pt inner hairline** in white α .22, which gives it an edge on dark pages, and an **NSShadow** of black α .22, blur 8, offset 2 pt down (`shadowOffset = (0, −2)` in a non-flipped context; in the flipped overlay view, check visually that it falls downward).

| Kind | Box stroke | Halo | Box fill | Pill fill | Pill text | Key fill | Key text | Key |
|---|---|---|---|---|---|---|---|---|
| action | graphite α .90, 2.5 | graphite α .16 | graphite α .08 | slate α .96 | white | white α .20 | white | `tab` |
| text | graphite α .70, 2.5 | graphite α .12 | none (field cover, see Ghost text) | slate α .96 | white | white α .20 | white | `tab` |
| pay | pay α .90, 2.5 | pay α .16 | pay α .07 | pay α 1 | white | white α .22 | white | `tab` |
| blocked | blockStroke α 1, **3.0** | blockStroke α .20 | blockStroke α .10 | blockFill | white | white α .22 | white | `esc` |
| done | doneStroke α .95, 2.5 | doneStroke α .18 | doneStroke α .08 | doneFill | white | — | — | none |

On dark backgrounds (checked on a GitHub-dark stand-in, the "Dark page" row) the same values hold. Slate, Base blue, red, and green pills all separate from #0d1117, and the hairline outlines them. No separate dark table is needed.

## Per kind, high contrast (pedal flow 4)

No drop shadow and no halo in HC. The pill border is a 2 pt inner stroke. All boxes get the 1.5 pt black rings, so yellow and green read on white pages.

| Kind | Box (on black rings) | Box fill | Pill fill | Pill text | Pill border | Key fill | Key text | Key |
|---|---|---|---|---|---|---|---|---|
| action | hc 4 | none | black | hc | hc 2 | hc | black | `tab` |
| text | hc 4 | none (field cover) | black | hc | hc 2 | hc | black | `tab` |
| pay | hc 4 | none | payHC | white | hc 2 | hc | black | `tab` |
| blocked | blockStroke 4 | blockStroke α .12 | blockFill | white | white 2 | white | black | `esc` |
| done | doneStroke 4 | none | doneFill | white | white 2 | — | — | none |

## Ghost text (`text` kind)

1. **Field cover:** first fill the element rect inset by 1.5, radius 4, with white α 1 in both modes. It hides the page's own placeholder ("Add a description", which otherwise collides with the ghost text). It also gives the ghost text a known background on any field, light or dark. That is the explicit dark-field rule: Tab never trusts the field colour; it brings its own paper. Every demo field is light, so the cover is invisible in practice.
2. **Font:** SF Pro regular. Multiline (rect h ≥ 44): 14 pt, line height 1.45 (20.3 pt), word wrap, inset 8 left/right/top. Single line: size `clamp(12, h × 0.42, 15)`, line height 1.2 × size, vertically centred, inset 8 left, truncating tail.
3. **Colour:** normal graphite `#8E8E93` α 1. HC is black text on a hc α 1 marker, drawn with `NSAttributedString.Key.backgroundColor`, which gives a per-line highlight. It reads on any field because of the cover.
4. **Pill placement:** single line: inline, 6 pt after the end of the ghost text, centred on the field, if it fits before `rect.maxX − 4`; otherwise to the right of the box (`x = rect.maxX + gap + boxOutset`), vertically centred. Multiline: **inside the rect's bottom-right corner**, inset 8 (`x = rect.maxX − pillW − 8`, `y = rect.maxY − pillH − 8`).
5. A text ghost never draws a cursor.

## Placement (all other ghosts)

- With a rect: the pill goes below the box, `x = box.minX`, `y = box.maxY + gap`. If `y + pillH > usable.maxY − 4`, flip it above: `y = box.minY − gap − pillH`.
- `pillAt` with no rect (Terminal): `pillAt` is the pill's **bottom-left corner** (`y = pillAt.y − pillH`). B sends `(win.x + 16, win.y + win.h − 16)`.
- No rect and no `pillAt`: centre horizontally, 40 pt below the usable top.
- Then clamp x and y to 4 pt inside `usable` (`NSScreen.visibleFrame`, converted to top-left).

## Cursor

- Path in points, tip at (0,0), y down: `(0,0) (0,17) (4.2,13.2) (7.0,19.6) (9.6,18.5) (6.9,12.2) (12.2,12.2)`, closed. Scale 1.0 (HC 1.4). Round line join.
- Normal: fill graphite α .90, stroke white α .95 at 1.2. Shadow black α .30, blur 3, 1 pt down.
- HC: fill hc, stroke black at 1.5, same shadow.
- **Only on `action` ghosts that have a rect and a `cursor`** (cursor present = show it). Pay, blocked, done, text, and Terminal ghosts get no cursor.
- **The shell positions the tip from the rect, not from `cursor`** (B sends the element centre, which puts the arrow over the button's own label). If `w ≥ 48`: tip = `(min(x + 0.78·w, x + w − 14), y + 0.62·h)`, the lower-right quadrant, clear of centred labels and left-aligned select/list text. If `w < 48` (chips, checkboxes): tip = `(x + 0.6·w, y + 0.6·h)`.

## Motion (ms)

| Event | Spec |
|---|---|
| appear | alpha 0→1 over 140 ms, ease-out. The pill also moves up 4 pt into place over the same 140 ms. The box is alpha only. |
| accept (Tab released < 600 ms) | The key shows pressed for 60 ms (normal: key fill white α .45; HC: black α .25 over the hc key). Then the whole ghost goes alpha →0 over 120 ms, ease-in, with the pill scaling 1→0.97. |
| dismiss (Esc, hold, other input, `ghost_hide`) | alpha →0 over 100 ms, ease-in, with no movement. Other input hides at once (≤ 100 ms) per "ignoring is free". |
| done | Appears like any ghost, stays until `ttlMs` (1500), then alpha →0 over 220 ms. |
| blocked shake (Tab on blocked) | The box and pill move together in translateX: `0, −7, 7, −5, 5, −2, 0`, keyframes evenly spaced over 320 ms. |
| hold progress (Tab held) | Hidden for the first 150 ms after keyDown, so a normal tap never flashes it. The key fill then sweeps left to right, linear, reaching 100% at 600 ms after keyDown, and the ghost dismisses (100 ms fade). The fill is white α 1 (normal) or black (HC). The key label is drawn twice: clipped to the filled part in slate (normal) or hc (HC), and clipped to the rest in the normal key text colour. If Tab is released before 600 ms, the fill resets with no animation and accept runs. |
| HUD "predicting" dot | alpha 1→.35→1, 900 ms loop, only while `mode == predicting`. |
| reduced motion | If `NSWorkspace.shared.accessibilityDisplayShouldReduceMotion`, use alpha only: no translate, scale, or shake (blocked flashes the pill border α 1→.4→1 over 320 ms instead). |

## HUD

A non-activating panel at the top right, 12 pt in from the visible frame's top and right edges. **Width 264**; height fits the content (≈ 196).

- **Panel:** fill `#1C1C1E` α .94, radius 12, 1 pt inner stroke white α .10, shadow black α .35, blur 20, 8 pt down. Padding 14 horizontal, 12 vertical.
- **Text colours:** primary white α .92, secondary white α .60, disabled white α .45. All numbers use `monospacedDigitSystemFont`.

| Row | Content |
|---|---|
| 1 (h 18) | Left: `Tab`, 13 bold, primary. Right: a 7 pt dot, a 6 pt gap, then the mode word in 11 medium, secondary. Dot colours: offline `#FF3B30`, idle `#8E8E93`, predicting `#0A84FF` (pulsing), shown `#FFFFFF`, running `#FFD60A`. Show `offline` while the websocket is down. |
| 2 (10 pt below) | Two equal columns. Label (11 medium, secondary): `Tab did` / `You did`. Number: 26 semibold, line height 30, primary. `Tab did` = `tabDid.clicks + tabDid.keys`; `You did` = `youDid`. Sub-line (11 regular, secondary): `<clicks> clicks, <keys> keys` / `keys and clicks`. This row is the end-of-demo reveal. |
| divider | 1 pt white α .10, 10 pt above and 8 pt below. |
| 3 | Three items spread across the width, 11, secondary, tabular: `<source>` in semibold primary plus latency (`< 10 ms` gets one decimal, else whole ms), or `no prediction yet`; `<modelCalls>` in semibold primary + ` model calls`; `<accepted>` in semibold primary + `/<shown> accepted`. |
| 4 (h 22, 8 pt below) | Left: `Paid $<amountUsd> · <hash[0..6]>…<hash[-4..]>`, 11, primary, or `No payments yet` (disabled). For 3 s after `lastTx` changes, prefix `✓ ` and colour the line `#30D158`. Right: a `ledger ↗` button, 11 semibold, padding 3×8, radius 6, fill white α .12, primary text. Without a tx: fill α .05, disabled text, clicks ignored. |
| 5 (8 pt below) | High-contrast switch: track 24×14, radius 7, fill white α .20 (off) or hc (on). Knob 12 pt, white, at x+1 (off) or x+11 (on), y+1. Label `High contrast`, 11 medium, secondary (primary when on). The whole row is the hit target. |

## Not decided here

- **The cursor position rule moves logic into the shell.** If B would rather send the lower-right point itself, the shell should use `cursor` as given. Agree on one of the two; the drawing is the same either way.
- **The `tab` keycap replaces the `⇥` glyph,** but the protocol labels keep `⇥`, so a shell that strips it changes nothing for B.

## Amendments (A, after freeze)

- **02:30 `Ghost.place`** (optional, protocol/CHANGES.md). Values: `below` (default, as specced, flips above at the screen edge), `above`, `right` (gap to the right of the box, vertically centred), and `inside` (docked in the element's right end like a badge, inset `max(4, (h − pillH)/2)` from the right, vertically centred). Use `inside` for wide fields whose pill would otherwise cover the next list row (flow 3's search box).
- **Keycap edge:** a 1.5 pt band along the key's bottom, black α .18 (HC .22, 2.25 pt), clipped to the key, hidden while pressed. It makes the key read as a physical key.
- **Key-only pill in HC:** no 2 pt border. The yellow key on its black ring is the edge; a second yellow ring read as brackets.
