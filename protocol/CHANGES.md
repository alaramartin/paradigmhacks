# Protocol changes after M0

Additive optional fields only. One line each: date, field, reason.
- M0: `Action.url?` — with two Chrome windows, C needs to know which tab a step targets.
- 2026-10-14: `Ghost.place?` (A) — only the hub knows page geometry, so it says where the pill goes (`"inside"` keeps it off the tracker's first row).
- 2026-10-14: `Ghost.avoid?` (A) — the hub knows what's near the target, only the shell knows the pill's real size (HC is 1.5×); together they keep the pill off the next control (flow 4: chips → "Text me when ready").
