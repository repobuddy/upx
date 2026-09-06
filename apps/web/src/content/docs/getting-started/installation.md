---
title: Installation
description: Installing the upx bin, and the name collision to know about.
---

```sh
npm i -g @repobuddy/upx
```

Verify:

```sh
upx --help
```

`upx` is meant to be installed **once, globally**. That is what makes a range match pay off: a single
install serves every caller on that major, from any directory.

## It is not ambient

`npx` ships with npm, so it is on every machine that has Node. `upx` only exists after that global
install. Anything that has to work on a machine you do not control should stay on
`npx <pkg>@<exact>`.

## Name collision

The package is scoped `@repobuddy/upx` because the unscoped `upx` name on npm belongs to a wrapper
around [UPX, the executable packer](https://upx.github.io/) — an unrelated tool.

The **binary** installed here is still `upx`. If you also use the executable packer, the two collide
on `PATH`; install only one of them globally.

## Using it from a package script

Inside your own package, a declared dependency is better served by your package manager's `.bin`
resolution — `pnpm exec`, `npm run`, or `node_modules/.bin` directly. `upx` earns its place where
there is no declared dependency to lean on: ad-hoc calls, agent skills, and scripts that run across
many repositories.
