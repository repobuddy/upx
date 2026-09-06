---
spec-type: behavioral
concept: [run, axi]
---

# upx — the local-first package runner

`upx <pkg>@<range> [args…]` runs a package's CLI **fast** by preferring an already-installed version.
It is a lean standalone bin, meant to be installed globally once and used in place of `npx` inside
skills and scripts.

## Why it exists

`npx <pkg>@<version>` pays ~1s per call — registry resolution plus spawn — **even when the package is
already cached**, and `npx` never reuses a **global** install. A skill that shells out to a CLI dozens
of times per run pays that cost every time. `upx` resolves the requested range against installed
packages and spawns the local binary directly (~0.10s, ~10× faster), falling back to `npx` only when
nothing installed satisfies the range. Because it matches a **range**, one global install serves many
callers across versions — the advantage over pinning a single version into `node_modules`.

`upx` is a **transparent exec wrapper**: the wrapped command owns stdout, stderr, and the exit code.
`upx` never rewraps the child's output. The [AXI](https://github.com/kunchenguid/axi) output contract
governs only `upx`'s own meta-surface — its `--help`, its fail-loud argument errors, and the one-line fallback notice — not the
child process it launches.

## Resolution

How `upx` turns `<pkg>@<range>` into a running binary:

1. **Parse the spec.** Split on the **last `@` at index > 0** so a scoped name survives
   (`@acme/cli@^1` → package `@acme/cli`, range `^1`). No `@` after index 0 — or a **trailing `@` with
   an empty range** (`pkg@`) — → a bare package, range `*` (any installed version). A package name that
   is **empty** or **violates npm's package-name rules** is a **fail-loud** error.
2. **Classify the range.** A valid **semver range** (`^1.2.0`, `~1.2.0`, `1.2.3`, `*`) drives local-first
   matching. A non-empty right-hand side that is **not** valid semver (e.g. `next`, `latest`) is a
   **dist-tag**: it cannot be matched against an installed `package.json` version, so `upx` goes straight
   to the npx fallback (npx resolves tags against the registry).
3. **Search local, then global.** *Local* = walk `node_modules` directories from the current working
   directory up through its ancestors; the **nearest** install whose `package.json` version satisfies
   the range wins. *Global* = the package under `npm root -g`, used only when no local install
   satisfies. Order: nearest-local → global → npx fallback.
4. **Resolve the bin.** From the chosen install's `package.json` `bin`: a **string** bin, an **object**
   whose key equals the package's unscoped name, or a **single-entry** object → that binary. An object
   with **multiple** bins and **no** key matching the package name — or a package with **no** `bin`
   field — is a **fail-loud** error (`upx` never guesses which bin to run).
5. **Spawn transparently or fall back.** On a match, spawn the resolved binary with the child arguments,
   inheriting stdio, and exit with the child's exit code. On no match, run `npx` with the package spec
   **exactly as given** (`npx <pkg>` for a bare package, `npx <pkg>@<range>` otherwise) plus the child
   arguments, pass the npx child's exit code through, and print the fallback notice.

## Use Cases

**Subject** — resolving `<pkg>@<range>` to an installed binary and running it, transparently, with an
`npx` fallback:

- **Local-first resolution** — a version satisfying `<range>` found by the ancestor `node_modules` walk
  is spawned directly; the **nearest** local install wins, and a local install is preferred over a
  **global** one.
- **Global install** — with no satisfying local install, a satisfying install under `npm root -g` runs.
- **Range semantics** — `<range>` accepts caret, tilde, exact, or any semver range; a bare `upx <pkg>`
  matches any installed version. Matching is `semver.satisfies` against each install's version.
- **Dist-tag → npx** — a non-semver spec after `@` (a dist-tag) cannot be matched locally and goes to
  the npx fallback, even when the package **is** installed. Its notice keeps the fixed
  `upx: no installed <pkg>` prefix but **names the dist-tag** rather than claiming a version failed to
  "satisfy" it — a tag is not a range.
- **npx fallback** — when no installed version satisfies `<range>`, `upx` runs `npx <pkg>@<range> [args…]`
  so the call still succeeds, and prints a single-line stderr notice with the fixed prefix
  `upx: no installed <pkg> satisfies "<range>", using npx`. `upx` degrades, it does not fail, on a miss.
- **No side effects** — `upx` installs nothing and writes nothing to `node_modules` **or** the
  `npm root -g` store; a miss simply defers to `npx`. Speeding up future calls is the setup skill's job,
  not a side effect of running.
- **Transparent passthrough** — the child inherits `upx`'s stdio, every argument after the package spec
  is forwarded **verbatim** (including `--flags` and `--`), and the child's **exit code becomes `upx`'s
  exit code**.
- **Bin resolution** — the executable name may differ from the package name; `upx` resolves the declared
  bin: a **string** bin, an object entry **keyed by the package's unscoped name** (even among several
  bins), or a **single-entry** object. A multi-bin object with **no** name match, or a package with **no
  `bin` field**, is a **fail-loud** error (`upx` never guesses which bin to run).
- **Scoped packages** — `@scope/pkg@range` parses on the last `@` and resolves like any package.
- **Argument boundary** — a **flag** is a token beginning with `-`; `upx`'s own flags are recognized only
  **before** the first non-flag token (the package spec). Everything from the package spec onward belongs
  to the child, so `upx <pkg> --help` shows the **child's** help. An unknown flag **before** the package
  spec is a **fail-loud** error.
- **Fail-loud on bad input** — no package spec, a malformed spec, an ambiguous/absent bin, or an unknown
  leading flag exits non-zero with a structured stderr error; `upx` never guesses.
- **`--help`** — `upx --help` prints a synopsis, the `<pkg>@<range>` form, the fallback behavior, and one
  example.

**Non-goals** — installing packages (a miss defers to `npx`; `upx` writes nothing to `node_modules` or
the global store); resolving or rewriting the `npx`→`upx` references inside skills (that is the **setup
skill**, not this bin — see `universal-plugin`'s `adopt-upx`); pinning versions into a release (that is
`universal-plugin`'s `plugin bundle`); wrapping or reformatting the child's output (transparent
passthrough — AXI applies only to `upx`'s own meta-surface); **selecting among multiple bins of one
package by name** (an ambiguous multi-bin package fails loud rather than choosing); installing,
updating, or managing packages in any way.

Every scenario in [`run.feature`](./run.feature) maps to one of these behaviors:

| Behavior | What it covers |
|---|---|
| **local-first resolution** | satisfying local install spawned; local preferred over global; nearest of two ancestor installs wins |
| **global install** | no local, satisfying global under `npm root -g` runs |
| **range semantics** | caret / tilde / exact / bare-any / empty-range-`pkg@` resolve via `semver.satisfies` |
| **dist-tag → npx** | a non-semver spec (`@next`) defers to npx even when installed |
| **npx fallback** | no satisfying install → `npx` with the spec as given (bare → `npx <pkg>`); fixed stderr notice; non-zero npx exit passes through |
| **no side effects** | a fallback leaves `node_modules` and the `npm root -g` store unchanged |
| **transparent passthrough** | stdio inherited; args (incl. a bare `--`) forwarded verbatim; child exit code is `upx`'s |
| **bin resolution** | differing bin name resolves; name-keyed match among several bins resolves; multi-bin-no-match / no-bin fail loud |
| **scoped packages** | `@scope/pkg@range` parses on the last `@` and resolves |
| **argument boundary** | flag after the spec → child; unknown flag before the spec → fail loud |
| **fail-loud** | missing / unparseable spec exits non-zero with an `error:` structured message |
| **`--help`** | `Usage: upx` synopsis, the `<pkg>@<range>` form, the npx-fallback note |
