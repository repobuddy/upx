---
"@repobuddy/upx": patch
---

Only look up the global install when no local one satisfies the range.

`runUpx` called `findGlobalInstall` eagerly, on every invocation, even when a local install already
satisfied and the global result was then discarded. Locating the global root shells out to
`npm root -g`, which costs a full npm start-up — measured at 75ms, comparable to everything else
`upx` does put together.

`selectInstall` now takes a thunk and calls it at most once, only after every local install has been
ruled out. On the local-hit path — the one `upx` exists for — a call drops from 169ms to 106ms.

Two unit tests pin the behavior so it cannot silently regress.
