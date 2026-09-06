import * as path from 'node:path'
import * as semver from 'semver'

/** One candidate install of a package — local (an ancestor `node_modules`) or global (`npm root
 *  -g`). `bin` is `package.json`'s raw `bin` field, unresolved. */
export interface Install {
	/** Absolute path to the install's package directory (where its `package.json` lives). */
	dir: string
	version: string
	bin: string | Record<string, string> | undefined
}

/** The filesystem/process boundary `upx`'s resolution needs — implemented by `run/fs.ts` for real
 *  use, faked in tests. Local installs are returned nearest-first (Background's cwd `node_modules`
 *  before any ancestor's). */
export interface RunFs {
	findLocalInstalls(pkg: string): Install[]
	findGlobalInstall(pkg: string): Install | undefined
	/** Spawns `binPath` with `args`, inheriting stdio; returns the child's exit code. */
	spawnBin(binPath: string, args: string[]): number
	/** Spawns `npx` with `args` (the package spec first, then the child args), inheriting stdio;
	 *  returns the child's exit code. */
	spawnNpx(args: string[]): number
}

export interface ParsedSpec {
	pkg: string
	range: string
	/** True for a bare package (no `@range`, or a trailing `@` with an empty range) — the npx
	 *  fallback then omits the `@range` suffix entirely. */
	bare: boolean
}

export type ParseSpecResult = { ok: true; spec: ParsedSpec } | { ok: false; error: string }

const NPM_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** A loose approximation of npm's package-name rules: lowercase, alphanumeric/`.`/`_`/`-`, an
 *  optional `@scope/` prefix, non-empty. Good enough to reject the obviously malformed without
 *  chasing every edge npm itself enforces. */
export function isValidPackageName(name: string): boolean {
	if (!name || name.length > 214) return false
	return NPM_NAME_PATTERN.test(name)
}

/** Splits `<pkg>@<range>` on the **last** `@` at index > 0, so a scoped name's leading `@` survives.
 *  No `@` after index 0 — or a trailing `@` with an empty range — is a bare package (range `*`). A
 *  package name that is empty or violates npm's naming rules is a fail-loud error. */
export function parseSpec(spec: string): ParseSpecResult {
	if (!spec) return { ok: false, error: 'error: no package spec given' }

	const lastAt = spec.lastIndexOf('@')
	let pkg: string
	let rangeRaw: string
	if (lastAt <= 0) {
		pkg = spec
		rangeRaw = ''
	} else {
		pkg = spec.slice(0, lastAt)
		rangeRaw = spec.slice(lastAt + 1)
	}

	if (!isValidPackageName(pkg)) {
		return { ok: false, error: `error: unparseable package spec "${spec}"` }
	}

	const bare = rangeRaw === ''
	return { ok: true, spec: { pkg, range: bare ? '*' : rangeRaw, bare } }
}

/** A valid semver range drives local-first matching; a non-empty non-semver spec (`next`,
 *  `latest`) is a dist-tag that can't be matched against an installed `package.json` version. */
export function isSemverRange(range: string): boolean {
	return semver.validRange(range) !== null
}

/** Nearest-local → global, first install whose version satisfies `range`. `locals` must already be
 *  nearest-first.
 *
 *  `getGlobalInstall` is a **thunk, called at most once and only after every local install has been
 *  ruled out**. Locating the global root shells out to `npm root -g`, which costs a full npm
 *  start-up (~75ms — comparable to everything else `upx` does put together), so a local hit must
 *  never pay for it. */
export function selectInstall(
	range: string,
	locals: Install[],
	getGlobalInstall: () => Install | undefined,
): Install | undefined {
	for (const install of locals) {
		if (semver.satisfies(install.version, range)) return install
	}
	const globalInstall = getGlobalInstall()
	if (globalInstall && semver.satisfies(globalInstall.version, range)) return globalInstall
	return undefined
}

export type ResolveBinResult = { ok: true; bin: string } | { ok: false; error: string }

/** Resolves the executable from a `package.json` `bin` field: a string bin, an object entry keyed
 *  by the package's unscoped name (even among several bins), or a single-entry object. A
 *  multi-entry object with no name match, or a missing `bin` field entirely, fails loud — `upx`
 *  never guesses which bin to run. */
export function resolveBinPath(pkgName: string, bin: string | Record<string, string> | undefined): ResolveBinResult {
	if (bin === undefined) {
		return { ok: false, error: `error: package "${pkgName}" declares no bin field` }
	}
	if (typeof bin === 'string') return { ok: true, bin }

	const entries = Object.entries(bin)
	if (entries.length === 0) {
		return { ok: false, error: `error: package "${pkgName}" declares no bin field` }
	}
	if (entries.length === 1) return { ok: true, bin: entries[0]![1]! }

	const unscoped = pkgName.includes('/') ? pkgName.slice(pkgName.lastIndexOf('/') + 1) : pkgName
	const match = bin[unscoped] ?? bin[pkgName]
	if (match) return { ok: true, bin: match }

	return {
		ok: false,
		error: `error: package "${pkgName}" declares multiple bins and none matches its name — upx never guesses which to run`,
	}
}

export interface ParsedArgv {
	help: boolean
	spec: string | undefined
	childArgs: string[]
}

export type ParseArgvResult = { ok: true; args: ParsedArgv } | { ok: false; error: string }

const KNOWN_LEADING_FLAGS = new Set(['--help', '-h'])

/** A flag is a token starting with `-`; `upx`'s own flags are recognized only before the first
 *  non-flag token (the package spec) — everything from the spec onward belongs to the child. An
 *  unknown flag before the spec fails loud. */
export function parseArgv(argv: string[]): ParseArgvResult {
	if (argv.length === 0) {
		return { ok: false, error: 'error: no package spec given' }
	}

	const first = argv[0]!
	if (first.startsWith('-')) {
		if (KNOWN_LEADING_FLAGS.has(first)) {
			return { ok: true, args: { help: true, spec: undefined, childArgs: [] } }
		}
		return { ok: false, error: `error: unknown flag "${first}"` }
	}

	return { ok: true, args: { help: false, spec: first, childArgs: argv.slice(1) } }
}

export function fallbackNotice(pkg: string, range: string): string {
	return `upx: no installed ${pkg} satisfies "${range}", using npx`
}

/** A dist-tag (`next`, `latest`) is not a version range, so the miss notice must not claim the
 *  installed versions failed to "satisfy" it — it never could. Keeps the fixed
 *  `upx: no installed <pkg>` prefix shared with {@link fallbackNotice}. */
export function distTagNotice(pkg: string, tag: string): string {
	return `upx: no installed ${pkg}; "${tag}" is a dist-tag, using npx`
}

export const HELP_TEXT = `Usage: upx <pkg>@<range> [args…]

Runs a package's CLI from a local or global install matching <range>, falling
back to npx when nothing installed satisfies it.

Example:
  $ upx semver@^7 --coerce v1.2
`

export type RunOutcome =
	| { kind: 'help'; text: string }
	| { kind: 'error'; message: string }
	| { kind: 'exit'; code: number; notice?: string }

/** Resolves `argv` (everything after `upx`) to a running child, per the Resolution algorithm in
 *  the spec: parse → classify the range → search local-then-global → resolve the bin → spawn, or
 *  fall back to npx with the spec exactly as given. */
export function runUpx(argv: string[], fs: RunFs): RunOutcome {
	const parsedArgv = parseArgv(argv)
	if (!parsedArgv.ok) return { kind: 'error', message: parsedArgv.error }
	if (parsedArgv.args.help) return { kind: 'help', text: HELP_TEXT }

	const specResult = parseSpec(parsedArgv.args.spec!)
	if (!specResult.ok) return { kind: 'error', message: specResult.error }

	const { pkg, range, bare } = specResult.spec
	const childArgs = parsedArgv.args.childArgs

	const semverRange = isSemverRange(range)
	if (semverRange) {
		const locals = fs.findLocalInstalls(pkg)
		const install = selectInstall(range, locals, () => fs.findGlobalInstall(pkg))

		if (install) {
			const binResult = resolveBinPath(pkg, install.bin)
			if (!binResult.ok) return { kind: 'error', message: binResult.error }
			const binPath = path.join(install.dir, binResult.bin)
			return { kind: 'exit', code: fs.spawnBin(binPath, childArgs) }
		}
	}

	const npxSpec = bare ? pkg : `${pkg}@${range}`
	const code = fs.spawnNpx([npxSpec, ...childArgs])
	const notice = semverRange ? fallbackNotice(pkg, range) : distTagNotice(pkg, range)
	return { kind: 'exit', code, notice }
}
