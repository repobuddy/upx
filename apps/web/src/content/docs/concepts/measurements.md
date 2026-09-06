---
title: Measurements
description: What each runner costs per call, measured rather than asserted, and why the speedup is smaller than it used to be.
---

Numbers on this page were measured on the machine and toolchain named below. **Re-run them before
quoting them.** The gap between `npx` and `upx` depends heavily on the npm version, and it has
narrowed considerably as npm has got faster.

## Method

- **Subject:** `gherkin-cli@0.2.1`, invoked as `validate a.feature` on a one-scenario file — a real
  CLI doing trivial work, so the measurement is dominated by start-up rather than by the task.
- **Sampling:** 3 discarded warm-up runs, then 21 timed runs per path; the table reports the
  **median**, with min/max as the spread.
- **Cache state:** warm. The npx cache was populated by a serial run before timing, so the `npx` rows
  are its *best* case, not a cold-start worst case.
- **Environment:** Node v26.7.0, npm 12.0.2, Linux 6.18 (WSL2).

## Results

| Path | Median | Min–max | vs `npx` |
| --- | --- | --- | --- |
| `npx <cli>@<version>` | 315ms | 302–341ms | 1.0× |
| `npx --no-install` (cached) | 290ms | 285–327ms | 1.1× |
| `pnpm exec <cli>` | 440ms | 414–474ms | 0.7× |
| **`upx <cli>@<range>` (local hit)** | **106ms** | 101–120ms | **3.0×** |
| `upx` miss → `npx` fallback | 701ms | 681–906ms | 0.4× |
| `node_modules/.bin/<cli>` | 68ms | 62–87ms | 4.7× |
| `node -e ''` (cold-start floor) | 22ms | 20–27ms | 14.5× |

## Reading the table

**`upx` is ~3× faster than `npx`, not 10×.** Earlier figures for this tool claimed roughly 1s for
`npx` and a 10× win. On npm 12 a warm `npx` call is ~315ms, so the same absolute `upx` time is a much
smaller multiple. The ordering is unchanged; the headline number is not. If you are reading an older
claim of 10×, it was measured against a slower npm.

**A miss is worse than never having tried.** The fallback path pays `upx`'s own start-up *and then*
the full `npx` cost — 701ms against 315ms for calling `npx` directly. `upx` is a win only when it
hits. Point it at ranges you know are installed; a range that usually misses is a pessimisation.

**`pnpm exec` is the slowest path here**, not a middle ground. The ~440ms is package-manager
start-up, and it only works where the package is a declared dependency.

**`npx --no-install` barely helps.** With a warm cache, skipping the install check saves ~25ms. The
cost is npm's own start-up, not the registry.

**The floor is ~68ms**, the direct `.bin` call — node's 22ms cold start plus the CLI's own load. That
is what `upx` is spending 106ms to approximate without hardcoding a path or a version.

## Where `upx`'s own 38ms goes

`upx` adds ~38ms over the direct `.bin` call: one extra node process (~22ms) plus walking ancestor
`node_modules` directories and reading the matching `package.json`.

A **global** hit costs more. Locating the global root shells out to `npm root -g`, measured at 75ms
median here — comparable to everything else `upx` does put together. That lookup is deliberately
**lazy**: it runs only after every local install has been ruled out, so a local hit never pays for
it. Before that was made lazy, every call paid the 75ms and the local-hit path measured 169ms rather
than 106ms.
