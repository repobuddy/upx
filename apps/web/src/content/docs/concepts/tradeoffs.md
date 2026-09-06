---
title: Tradeoffs
description: What upx costs you — the failure modes it introduces, each of which is quiet rather than loud.
---

`upx` is a latency fix. It is not a correctness fix, and it introduces its own failure modes. Most of
them are quiet.

## It trades reproducibility for speed, by design

Adopting `upx` means widening an **exact** pin to a range (`^<major>`, or `^0.<minor>` for a 0.x
package). The version that runs is then whatever satisfying copy happens to be nearest — which may not
be the version the caller was written and tested against. A stale global install that still satisfies
the range wins silently. `npx <pkg>@<exact>` cannot do this.

## Resolution depends on ambient state

The result of the same command varies with:

- **the current working directory** — a package subdirectory and the repository root can resolve to
  different installs;
- **whatever is installed globally** on that machine, which nothing in your project declares or
  creates;
- **the active Node version**, where a version manager gives each one its own global root. A package
  installed globally under one Node version is invisible under another.

Agents and scripts change directories mid-run, so two calls in one run can legitimately resolve to
two different versions.

The fallback notice is a single stderr line, which in a long transcript is easy to miss. The common
failure is not an error — it is running the wrong version quietly.

## The fallback path still has npx's problems

A miss runs `npx`, so on a cold cache with parallel callers the
[contention](../why-upx/#cache-contention-under-parallelism) is unchanged; it just happens less
often, because hits skip it.

Worse, a miss is *slower than not using `upx` at all*: it pays `upx`'s start-up and then the full
`npx` cost. [Measured](../measurements/) at 701ms against 315ms for calling `npx` directly. Point
`upx` at ranges you expect to hit. A range that usually misses is a pessimisation, not an
optimisation.

## Dist-tags never get faster

`@latest` and `@next` name a moving target, so they cannot be matched against an installed
`package.json` version. Those references always fall through to `npx` and pay `upx`'s own start-up on
top. Use a semver range, or leave the reference on `npx`.

## An added bin can break a working call

`upx` refuses to guess among several binaries. It resolves a string `bin`, an object entry keyed by
the package's unscoped name, or a single-entry object — anything else is a fail-loud error.

A dependency that adds a second bin in a patch release can therefore turn a working `upx pkg@^1` call
into a hard failure with no change on the calling side. This is deliberate: running the wrong binary
silently is worse than stopping.

## It is not ambient, so it needs a bootstrap

`npx` ships with npm. `upx` exists only after `npm i -g @repobuddy/upx`, and a command word of `upx`
fails with `command not found` anywhere that install has not happened.

Keep `npx` as the runner word for anything that must work on a cold machine.

## Two runner words to maintain

Once a project mixes both forms, any tooling that rewrites version pins has to recognise both and
preserve whichever a reference already uses. Detection is textual — a `<runner> <pkg>@<version>`
pattern — so it depends on each reference carrying an explicit `@<version>`. That is a heuristic
boundary, not a declared one; treat a rewrite tool's output as something to review rather than trust.

## When to use which

| Situation | Use |
| --- | --- |
| A CLI called many times per run, on a machine you set up | `upx <pkg>@^<major>` |
| Code shipped to machines you do not control | `npx <pkg>@<exact>` |
| A dist-tag (`@latest`, `@next`) | `npx` — `upx` cannot match a tag |
| A declared dependency in your own package scripts | `node_modules/.bin`, via your package manager |
| The CLI exposes a library API and you control the call site | Import it in-process — no runner at all |
