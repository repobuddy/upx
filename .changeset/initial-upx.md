---
"@repobuddy/upx": minor
---

Extract `upx` from `universal-plugin` into its own package.

`upx` is a generic local-first package runner: nothing about it is specific to building agent
plugins, and its value proposition — install once globally, use everywhere in place of `npx` —
depends on that global install being small and unopinionated. Shipping it as a second bin of
`universal-plugin` meant `npm i -g universal-plugin` to get a runner word.

Behavior is unchanged. The resolution algorithm, the fail-loud bin rules, the npx fallback and its
notices, and the full test suite move across as they were.

Install with `npm i -g @repobuddy/upx`. The `upx` bin on `universal-plugin` continues to work as a
deprecated re-export and will be removed at its next major.
