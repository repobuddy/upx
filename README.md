# upx

[![CI](https://github.com/repobuddy/upx/actions/workflows/release.yml/badge.svg)](https://github.com/repobuddy/upx/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@repobuddy/upx)](https://www.npmjs.com/package/@repobuddy/upx)
[![License](https://img.shields.io/npm/l/@repobuddy/upx)](LICENSE)

A local-first package runner. `upx <pkg>@<range>` resolves a semver **range** against the copies
already installed on the machine and spawns that binary directly, falling back to `npx` only when
nothing installed satisfies it.

```sh
npm i -g @repobuddy/upx

upx semver@^7 --coerce v1.2
```

## Why

`npx <pkg>@<version>` pays roughly **1s per call** — registry resolution plus spawn — *even when the
package is already in the npx cache*, and it never reuses a globally installed copy. A script or an
agent skill that shells out to a CLI dozens of times per run spends most of its wall clock in the
runner.

| Path | Median | vs `npx` |
| --- | --- | --- |
| `npx <cli>@<version>` | 315ms | 1.0× |
| `pnpm exec <cli>` | 440ms | 0.7× |
| **`upx <cli>@<range>`** | **106ms** | **3.0×** |
| `node_modules/.bin/<cli>` | 68ms | 4.7× |

<sub>Node 26.7.0, npm 12.0.2, warm cache, median of 21 runs against `gherkin-cli`. Older claims of a
10× win were measured against a much slower npm — see
[Measurements](https://repobuddy.github.io/upx/concepts/measurements/) for the method, and re-run it
before quoting it.</sub>

Matching a **range** rather than an exact version is the point: one global install serves every
caller pinned to that major.

## How it resolves

1. **Parse** `<pkg>@<range>` on the last `@` at index > 0, so a scoped name survives
   (`@acme/cli@^1` → package `@acme/cli`, range `^1`). A bare name, or a trailing `@` with an empty
   range, means "any installed version".
2. **Classify.** A valid semver range drives local-first matching. A dist-tag (`latest`, `next`)
   cannot be matched against an installed `package.json`, so it goes straight to `npx`.
3. **Search** `node_modules` from the current directory up through its ancestors — nearest wins —
   then the package under `npm root -g`.
4. **Resolve the bin** from `package.json`: a string `bin`, an object entry keyed by the package's
   unscoped name, or a single-entry object. Anything ambiguous is a **fail-loud** error; `upx` never
   guesses which binary to run.
5. **Spawn transparently**, or fall back to `npx` with the spec exactly as given and a one-line
   notice on stderr.

`upx` installs nothing. It is a transparent exec wrapper: the child owns stdout, stderr, and the exit
code.

## When not to use it

`upx` is a latency fix, not a correctness fix.

- **It trades reproducibility for speed, by design.** A range matches whatever satisfying copy is
  nearest, which may not be the version a caller was tested against. A stale global install that
  still satisfies the range wins silently.
- **Resolution depends on ambient state** — the current working directory and whatever is installed
  globally. Two calls from different directories in one run can legitimately resolve differently.
- **It is not ambient.** `npx` ships with npm. `upx` exists only after a global install, so anything
  that must work on a cold machine should stay on `npx <pkg>@<exact>`.
- **Dist-tags never get faster.** `@latest` and `@next` always fall through to `npx` and pay `upx`'s
  startup on top.

| Situation | Use |
| --- | --- |
| A CLI called many times per run, on a machine you set up | `upx <pkg>@^<major>` |
| Code shipped to unknown machines | `npx <pkg>@<exact>` |
| A dist-tag (`@latest`, `@next`) | `npx` |
| A declared dependency in your own package scripts | `node_modules/.bin`, via your package manager |
| The CLI exposes a library API and you control the call site | Import it in-process — no runner at all |

## Documentation

[repobuddy.github.io/upx](https://repobuddy.github.io/upx) — the measurements and their method, the
full resolution algorithm, and the tradeoffs in detail.

## Naming

The package is scoped `@repobuddy/upx` because the unscoped `upx` name on npm belongs to a wrapper
around [UPX, the executable packer](https://upx.github.io/) — an unrelated tool. The **binary** this
package installs is still `upx`. If you also use the executable packer, the two will collide on
`PATH`; install only one of them globally.

## License

MIT
