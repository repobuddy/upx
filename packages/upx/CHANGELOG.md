# @repobuddy/upx

## 0.1.0

### Minor Changes

- 64f0f45: Extract `upx` from `universal-plugin` into its own package.
  
  `upx` is a generic local-first package runner: nothing about it is specific to building agent
  plugins, and its value proposition — install once globally, use everywhere in place of `npx` —
  depends on that global install being small and unopinionated. Shipping it as a second bin of
  `universal-plugin` meant `npm i -g universal-plugin` to get a runner word.
  
  Behavior is unchanged. The resolution algorithm, the fail-loud bin rules, the npx fallback and its
  notices, and the full test suite move across as they were.
  
  Install with `npm i -g @repobuddy/upx`. The `upx` bin on `universal-plugin` continues to work as a
  deprecated re-export and will be removed at its next major.

### Patch Changes

- 64f0f45: Only look up the global install when no local one satisfies the range.
  
  `runUpx` called `findGlobalInstall` eagerly, on every invocation, even when a local install already
  satisfied and the global result was then discarded. Locating the global root shells out to
  `npm root -g`, which costs a full npm start-up — measured at 75ms, comparable to everything else
  `upx` does put together.
  
  `selectInstall` now takes a thunk and calls it at most once, only after every local install has been
  ruled out. On the local-hit path — the one `upx` exists for — a call drops from 169ms to 106ms.
  
  Two unit tests pin the behavior so it cannot silently regress.
- 7e1ced7: Fix `upx` on Windows.
  
  - `bin/upx.mjs` handed `import()` an absolute path; on Windows the drive letter reads as a URL
    scheme, so every invocation died with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. It now converts the path
    to a `file://` URL.
  - Windows never honours a `#!` line, so a package's JavaScript bin could not be spawned as a
    program. `upx` now reads the shebang and spawns the interpreter it names, mapping `node` to the
    Node already running.
  - `npm` and `npx` are `.cmd` shims on Windows, which only `cmd.exe` can interpret. `upx` resolves
    them through `PATH`/`PATHEXT` and, when it finds a batch shim, runs it through `cmd.exe` with
    arguments escaped so a caret range such as `tool@^1.0.0` survives cmd's re-parse intact.
