# Protocol changes after M0

Additive optional fields only. One line each: date, field, reason.
- M0: `Action.url?` — with two Chrome windows, C needs to know which tab a step targets.
- 02:30: `Ghost.place?` (A). The hub knows the page geometry, so it can keep the pill off the next target. Example: a pill below the tracker search box covers the first list row; send `"inside"` there.
