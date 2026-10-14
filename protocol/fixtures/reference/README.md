# Reference captures (not demo fixtures)

Real GitHub pages from a public repo (astral-sh/uv), captured from the debug Chrome with
`node protocol/fixtures/capture/capture.mjs`. They show GitHub's real DOM as the perception rules see it.
They are **not** the demo fixtures: those (`web_state_github_release.json`, `web_state_github_compare.json`)
must come from the demo repo once it exists (PLAN human setup step 6).

- `real_github_release_table_uv.json`: a release whose notes contain a markdown table. Every row is a list item:
  `list.key` = the `tbody` path, `index` = row, `field` = `td:nth-of-type(N)` for text cells and
  `td:nth-of-type(N) > a` for links. **The list heuristic works on GitHub's rendered table.**
- `real_github_compare_commits_uv.json`: a logged-out compare view. Commit titles are links in
  `div#commits_bucket > … > ol > li`, so the key contains "commits". A title that references a PR is split into
  several links (`"Fix … ("`, `"#22424"`, `")"`). The compare view is a React partial that first renders "Loading",
  so perception has to re-emit state after it hydrates.
