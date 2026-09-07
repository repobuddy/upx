---
'@repobuddy/upx': patch
---

Fix `upx` on Windows.

- `bin/upx.mjs` handed `import()` an absolute path; on Windows the drive letter reads as a URL
  scheme, so every invocation died with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. It now converts the path
  to a `file://` URL.
- Windows never honours a `#!` line, so a package's JavaScript bin could not be spawned as a
  program. `upx` now reads the shebang and spawns the interpreter it names, mapping `node` to the
  Node already running.
- `npm` and `npx` are `.cmd` shims on Windows, which only `cmd.exe` can interpret. `upx` resolves
  them through `PATH`/`PATHEXT` and, when it finds a batch shim, runs it through `cmd.exe` with
  arguments escaped so a caret range such as `tool@^1.0.0` survives cmd's re-parse intact.
