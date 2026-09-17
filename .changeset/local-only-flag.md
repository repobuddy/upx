---
"@repobuddy/upx": minor
---

Add `--local-only`, a leading flag that resolves exactly as `upx` always does — nearest local
install, then global, range-checked — but never falls back to `npx` on a miss. It prints a one-line
notice (`upx: no installed <pkg> ..., skipped npx (--local-only)`) and exits 127, the shell's
"command not found" code, instead of downloading.

This fits an agent skill's optional step: "if tool X is installed, ask it something; otherwise
skip." Plain `upx` still costs a registry lookup or a download on a miss, which is wrong for a step
that usually finds nothing installed. `command -v` misses repo-local installs and skips the version
check entirely; `--local-only` gives the same local-first resolution as `upx`'s default path with a
"not installed" signal a caller can branch on.

A dist-tag spec (`pkg@next`) is always a miss under `--local-only` — a tag can't be matched against
an installed version.
