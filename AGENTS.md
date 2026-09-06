# AGENTS.md

`@repobuddy/upx` is a local-first package runner — see [README.md](./README.md) for what it does and
[packages/upx/.agents/spec/README.md](./packages/upx/.agents/spec/README.md) for the behavioral spec
that governs it. Every scenario in `packages/upx/.agents/spec/run.feature` maps to a behavior in that
spec.

## Working here

- `pnpm verify` runs the whole gate: biome check, build, typecheck, tests.
- `pnpm --filter ./packages/upx test` builds and runs both suites. `src/run.test.ts` covers the pure
  resolution logic; `src/bin/upx.test.mts` drives the built `bin/upx.mjs` end to end against a
  fixture `node_modules` tree with fake `npm` and `npx` shims on `PATH`.
- Add a changeset for any published change: `pnpm changeset`.

## Constraints specific to this package

- **Keep the dependency list tiny.** `semver` is the only runtime dependency. `upx` exists to be
  faster than `npx`, and every dependency is paid on every invocation.
- **Do not introduce an argument-parsing library.** `src/cli.ts` is hand-rolled on purpose; a parser's
  require cost lands on cold start.
- **`upx` is a transparent exec wrapper.** It must never wrap, buffer, prefix, or reformat the child's
  stdout/stderr, and it must exit with the child's code. The AXI output contract applies only to
  `upx`'s own meta-surface: `--help`, fail-loud argument errors, and the one-line fallback notice.
- **Never guess.** An ambiguous multi-bin package, a malformed spec, or an unknown leading flag fails
  loud rather than picking something plausible.
- **`upx` installs nothing.** A miss defers to `npx`; nothing is written to `node_modules` or the
  global store.
