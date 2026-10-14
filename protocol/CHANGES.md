# Protocol changes after M0

Additive optional fields only. One line each: date, field, reason.
- M0: `Action.url?` — with two Chrome windows, C needs to know which tab a step targets.
- 2026-10-14: `Ghost.place?` (A) — only the hub knows page geometry, so it says where the pill goes (`"inside"` keeps it off the tracker's first row).
- 2026-10-14: `Ghost.avoid?` (A) — the hub knows what's near the target, only the shell knows the pill's real size (HC is 1.5×); together they keep the pill off the next control (flow 4: chips → "Text me when ready"). Since 11:00 the shell ignores it for `pay`/`blocked` ghosts (they stay below their button, off the amount they quote; ghost-spec 11:00). Sending it is still fine.
- 2026-10-14 11:15: `El.radius?` and `Ghost.radius?` (A, at the human's request; additive, optional). C reads the CSS corner radius in `inject.js`, B copies the target's onto the ghost (pay/blocked/done: the element at `anchorRect`), and A draws the highlight box concentric with the element's shape (square, rounded or capsule). Without it A falls back to a 6 pt radius.
