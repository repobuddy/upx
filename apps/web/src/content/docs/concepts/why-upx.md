---
title: Why upx exists
description: The three costs of npx that a local-first runner removes, and the one it cannot.
---

## Per-call latency

`npx <pkg>@<version>` re-resolves and re-spawns on every invocation, **even when the package is
already in the npx cache**. A skill or script that calls a CLI a few dozen times per run spends most
of its wall clock in the runner rather than in the tool.

See [Measurements](../measurements/) for the current numbers.

## No reuse of a global install

`npx` never uses a globally installed copy. A machine can have the exact version already on disk and
still pay the full resolution cost.

The obvious workaround — pinning an exact version into every consuming project — fragments
`node_modules` across near-identical copies and still leaves the global install unused. Matching a
**range** is what breaks the trade: one global install serves every caller on that major.

## Cache contention under parallelism

The npx install cache (`~/.npm/_npx`) is shared process-wide and is not concurrency-safe. When
several tasks shell out to the same uncached `npx <pkg>@<version>` at once — parallel CI jobs, or
several agents working at the same time — the concurrent installs race to populate the same directory
and fail with `ENOTEMPTY`.

The symptom is not a clean error. A step reports that it "did not run", intermittently, on some runs
only.

`upx` narrows this window rather than closing it: a hit skips the cache entirely, but
[a miss still runs `npx`](../tradeoffs/#the-fallback-path-still-has-npxs-problems) and races exactly
as before.

Two mitigations work, in escalating order:

1. **Warm the cache serially** before the parallel work, so the concurrent calls all hit a populated
   cache. This narrows the window; it does not close it.
2. **Remove the subprocess.** Where the CLI also ships a programmatic API, importing it in-process
   removes the resolution, the spawn, and the cache entirely. This is the only complete fix, and it
   is available only when the tool exposes a library entry point.

If eliminating the race is the goal rather than making it rarer, the answer is the second one, not
`upx`.
