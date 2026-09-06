---
title: Introduction
description: What upx is, and the one problem it solves.
---

`upx <pkg>@<range> [args…]` runs a package's CLI from a copy that is **already installed**, instead
of resolving one from the registry on every call.

```sh
upx semver@^7 --coerce v1.2
```

It walks `node_modules` from the current directory up through its ancestors, then checks the global
root, and spawns the first binary whose version satisfies the range. When nothing installed
satisfies it, `upx` runs `npx` with the spec exactly as given and says so on stderr.

## The problem

`npx <pkg>@<version>` re-resolves and re-spawns on every invocation, and it never reuses a globally
installed copy. A machine can have the exact version on disk and still pay the full resolution cost.
A script or an agent skill that shells out to a CLI dozens of times per run pays it every time.

Pinning the exact version into every consuming project avoids the network but fragments
`node_modules` across near-identical copies, and still leaves a global install unused.

## What `upx` does differently

Matching a **semver range** rather than an exact version is the whole design. One
`npm i -g <tool>` then serves every caller pinned to that major, from any directory, without a
per-project dependency.

`upx` is a transparent exec wrapper. The wrapped command owns stdout, stderr, and the exit code;
`upx` never rewraps the child's output, and it installs nothing.

## What it is not

`upx` is a **latency** fix. It does not make anything more reproducible — it makes it less so, on
purpose, by widening an exact pin to a range. Read [Tradeoffs](../../concepts/tradeoffs/) before
adopting it broadly, and [Measurements](../../concepts/measurements/) for what the speedup actually
is on current npm.
