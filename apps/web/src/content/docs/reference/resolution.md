---
title: Resolution
description: Exactly how upx turns <pkg>@<range> into a running binary, including every fail-loud case.
---

`upx <pkg>@<range> [args…]`

Everything from the package spec onward belongs to the child. `upx`'s own flags are recognised only
*before* the spec; an unknown flag there is a fail-loud error.

## Algorithm

### 1. Parse the spec

Split on the **last `@` at index > 0**, so a scoped name survives: `@acme/cli@^1` → package
`@acme/cli`, range `^1`.

- No `@` after index 0 (`pkg`) → a bare package, range `*` (any installed version).
- A trailing `@` with an empty range (`pkg@`) → also bare.
- A package name that is empty or violates npm's naming rules → **fail-loud**.

### 2. Classify the range

A valid **semver range** (`^1.2.0`, `~1.2.0`, `1.2.3`, `*`) drives local-first matching.

A non-empty right-hand side that is **not** valid semver (`next`, `latest`) is a **dist-tag**. It
cannot be matched against an installed `package.json` version, so `upx` goes straight to the `npx`
fallback — `npx` resolves tags against the registry.

### 3. Search local, then global

**Local** — walk `node_modules` directories from the current working directory up through its
ancestors. The **nearest** install whose version satisfies the range wins. An install with no readable
`package.json` version is skipped rather than treated as a match.

**Global** — the package under `npm root -g`, consulted only when no local install satisfies.

This lookup is **lazy**. `npm root -g` costs a full npm start-up
([~75ms measured](../../concepts/measurements/#where-upxs-own-38ms-goes)), so a local hit never pays
for it.

Order: nearest-local → global → `npx` fallback.

### 4. Resolve the bin

From the chosen install's `package.json` `bin` field:

| `bin` field | Result |
| --- | --- |
| A string | That binary |
| An object entry keyed by the package's unscoped name | That entry, even among several |
| A single-entry object | That entry |
| Multiple entries, none matching the package name | **Fail-loud** |
| No `bin` field at all | **Fail-loud** |

`upx` never guesses which binary to run.

### 5. Spawn, or fall back

On a match, spawn the resolved binary with the child arguments, inheriting stdio, and exit with the
child's exit code.

On no match, run `npx` with the package spec **exactly as given** — `npx <pkg>` for a bare package,
`npx <pkg>@<range>` otherwise — plus the child arguments, pass the exit code through, and print a
one-line notice to stderr:

```text
upx: no installed <pkg> satisfies "<range>", using npx
upx: no installed <pkg>; "<tag>" is a dist-tag, using npx
```

The two notices differ on purpose: a dist-tag never *could* have been satisfied by an installed
version, so claiming it failed to "satisfy" a range would be misleading.

## Transparency contract

`upx` is an exec wrapper. The wrapped command owns stdout, stderr, and the exit code, and `upx` never
rewraps, buffers, prefixes, or reformats the child's output. The
[AXI](https://github.com/kunchenguid/axi) output contract governs only `upx`'s own meta-surface: its
`--help`, its fail-loud argument errors, and the one-line fallback notice.

## Non-goals

- **Installing anything.** A miss defers to `npx`; `upx` writes nothing to `node_modules` or the
  global store.
- **Choosing among multiple bins by guesswork.** An ambiguous multi-bin package fails loud.
- **Matching dist-tags.** Those belong to `npx`.
- **Rewriting `npx` references** in your own files. That is a separate concern; see
  `universal-plugin`'s `adopt-upx` skill.
