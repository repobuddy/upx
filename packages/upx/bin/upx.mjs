#!/usr/bin/env node
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
// `import()` takes a URL, not a path: on Windows an absolute path's drive letter reads as a URL
// scheme (`D:\…` → `ERR_UNSUPPORTED_ESM_URL_SCHEME`), so the path has to be converted, not passed.
await import(pathToFileURL(join(dir, '..', 'dist', 'upx.mjs')).href)
