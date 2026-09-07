import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

const bin = path.resolve('bin/upx.mjs')

// ── fixture plumbing ──
// A fixture project is `<tmp>/work/proj` (the cwd `upx` runs from). `<tmp>/work` is its parent —
// the "farther ancestor" for the two-ancestor-installs scenario. `<tmp>/global` stands in for
// `npm root -g`'s output (a fake `npm` shim on PATH prints its path). A fake `npx` on PATH prints a
// marker so a test can prove whether the npx fallback ran.

let tmpDir: string
let binDir: string
let globalDir: string
let cwd: string
let ancestorDir: string

function pkgDirIn(base: string, pkg: string): string {
	return path.join(base, ...pkg.split('/'))
}

const isWindows = process.platform === 'win32'

function writeExecutable(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, content)
	fs.chmodSync(filePath, 0o755)
}

/** Puts a fake `npm`/`npx` on `PATH`. POSIX runs the shebang script itself; Windows cannot execute
 *  one, so it gets the `.cmd` shim next to the script that npm itself installs there — which is
 *  also what makes these tests exercise `upx`'s real cmd.exe path rather than a POSIX-only one. */
function writeShimOnPath(name: string, body: string): void {
	const script = path.join(binDir, isWindows ? `${name}.mjs` : name)
	writeExecutable(script, `#!/usr/bin/env node\n${body}`)
	if (isWindows) {
		fs.writeFileSync(path.join(binDir, `${name}.cmd`), `@node "%~dp0${name}.mjs" %*\r\n`)
	}
}

function markerScript(marker: string): string {
	return `#!/usr/bin/env node
const args = process.argv.slice(2)
process.stdout.write(${JSON.stringify(marker)} + ' ' + args.join(' ') + '\\n')
const code = process.env.LOCAL_BIN_EXIT_CODE ? Number(process.env.LOCAL_BIN_EXIT_CODE) : 0
process.exit(code)
`
}

function writeStringBinInstall(nodeModulesDir: string, pkg: string, version: string, marker: string): void {
	const dir = pkgDirIn(nodeModulesDir, pkg)
	writeExecutable(path.join(dir, 'bin.js'), markerScript(marker))
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkg, version, bin: 'bin.js' }))
}

function writeNamedBinInstall(
	nodeModulesDir: string,
	pkg: string,
	version: string,
	binName: string,
	marker: string,
): void {
	const dir = pkgDirIn(nodeModulesDir, pkg)
	writeExecutable(path.join(dir, 'bin.js'), markerScript(marker))
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkg, version, bin: { [binName]: 'bin.js' } }))
}

function writeMultiBinInstall(
	nodeModulesDir: string,
	pkg: string,
	version: string,
	bins: { name: string; marker?: string }[],
): void {
	const dir = pkgDirIn(nodeModulesDir, pkg)
	const binField: Record<string, string> = {}
	for (const { name, marker } of bins) {
		const file = `bin-${name}.js`
		binField[name] = file
		writeExecutable(path.join(dir, file), markerScript(marker ?? `UNUSED-${name}`))
	}
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkg, version, bin: binField }))
}

function writeNoBinInstall(nodeModulesDir: string, pkg: string, version: string): void {
	const dir = pkgDirIn(nodeModulesDir, pkg)
	fs.mkdirSync(dir, { recursive: true })
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkg, version }))
}

function localNodeModules(): string {
	return path.join(cwd, 'node_modules')
}

function ancestorNodeModules(): string {
	return path.join(ancestorDir, 'node_modules')
}

function snapshotDir(dir: string): string[] {
	if (!fs.existsSync(dir)) return []
	const out: string[] = []
	const walk = (d: string) => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, entry.name)
			if (entry.isDirectory()) walk(p)
			else out.push(path.relative(dir, p))
		}
	}
	walk(dir)
	return out.sort()
}

function run(args: string[], env: Record<string, string> = {}) {
	return spawnSync('node', [bin, ...args], {
		cwd,
		encoding: 'utf8',
		env: {
			...process.env,
			NODE_NO_WARNINGS: '1',
			PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
			FAKE_GLOBAL_ROOT: globalDir,
			...env,
		},
	})
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upx-e2e-'))
	binDir = path.join(tmpDir, 'bin')
	globalDir = path.join(tmpDir, 'global')
	ancestorDir = path.join(tmpDir, 'work')
	cwd = path.join(ancestorDir, 'proj')
	fs.mkdirSync(binDir, { recursive: true })
	fs.mkdirSync(globalDir, { recursive: true })
	fs.mkdirSync(cwd, { recursive: true })

	writeShimOnPath(
		'npx',
		`const args = process.argv.slice(2)
process.stdout.write('NPX-SHIM ' + args.join(' ') + '\\n')
const code = process.env.NPX_SHIM_EXIT_CODE ? Number(process.env.NPX_SHIM_EXIT_CODE) : 0
process.exit(code)
`,
	)
	writeShimOnPath(
		'npm',
		`const args = process.argv.slice(2)
if (args[0] === 'root' && args[1] === '-g') {
  process.stdout.write((process.env.FAKE_GLOBAL_ROOT || '') + '\\n')
  process.exit(0)
}
process.exit(1)
`,
	)

	// Background: a local install "tool-a" at version "1.2.3" whose bin prints "TOOL-A-LOCAL <args>"
	writeStringBinInstall(localNodeModules(), 'tool-a', '1.2.3', 'TOOL-A-LOCAL')
})

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ── Local-first resolution ──

test('a satisfying local install runs, and npx is not used', () => {
	const result = run(['tool-a@^1.0.0', 'build'])
	expect(result.stdout).toContain('TOOL-A-LOCAL build')
	expect(result.stdout).not.toContain('NPX-SHIM')
	expect(result.status).toBe(0)
})

test('a local install is preferred over a global one when both satisfy', () => {
	writeStringBinInstall(globalDir, 'tool-a', '1.9.0', 'TOOL-A-GLOBAL')
	const result = run(['tool-a@^1.0.0'])
	expect(result.stdout).toContain('TOOL-A-LOCAL')
	expect(result.stdout).not.toContain('TOOL-A-GLOBAL')
})

test('the nearest of two ancestor local installs wins', () => {
	writeStringBinInstall(ancestorNodeModules(), 'tool-a', '1.5.0', 'TOOL-A-ANCESTOR')
	const result = run(['tool-a@^1.0.0'])
	expect(result.stdout).toContain('TOOL-A-LOCAL')
	expect(result.stdout).not.toContain('TOOL-A-ANCESTOR')
})

// ── Global install ──

test('a satisfying global install runs when there is no local install', () => {
	writeStringBinInstall(globalDir, 'tool-b', '1.4.0', 'TOOL-B-GLOBAL')
	const result = run(['tool-b@^1.0.0', 'unit', 'list'])
	expect(result.stdout).toContain('TOOL-B-GLOBAL unit list')
	expect(result.stdout).not.toContain('NPX-SHIM')
})

// ── Range semantics ──

test.each(['^1.0.0', '~1.2.0', '1.2.3'])('a semver range %s the installed version satisfies runs locally', (range) => {
	const result = run([`tool-a@${range}`])
	expect(result.stdout).toContain('TOOL-A-LOCAL')
	expect(result.stdout).not.toContain('NPX-SHIM')
})

test('a bare package with no range matches any installed version', () => {
	const result = run(['tool-a'])
	expect(result.stdout).toContain('TOOL-A-LOCAL')
	expect(result.stdout).not.toContain('NPX-SHIM')
})

test('a trailing @ with an empty range is treated as bare and matches any installed version', () => {
	const result = run(['tool-a@'])
	expect(result.stdout).toContain('TOOL-A-LOCAL')
	expect(result.stdout).not.toContain('NPX-SHIM')
})

test('a spec after @ that is not valid semver is treated as a dist-tag and goes to npx', () => {
	const result = run(['tool-a@next'])
	expect(result.stdout).toContain('NPX-SHIM tool-a@next')
	expect(result.stderr).toContain('upx: no installed tool-a')
})

test('a dist-tag miss notice names it a dist-tag, not a range being satisfied', () => {
	const result = run(['tool-a@next'])
	expect(result.stderr).toContain('upx: no installed tool-a')
	expect(result.stderr).toContain('dist-tag')
	expect(result.stderr).not.toContain('satisfies')
})

// ── npx fallback ──

test('no installed version satisfying the range falls back to npx with a notice', () => {
	const result = run(['tool-a@^9.0.0'])
	expect(result.stdout).toContain('NPX-SHIM tool-a@^9.0.0')
	expect(result.stderr).toContain('upx: no installed tool-a satisfies')
	expect(result.stderr).toContain('using npx')
})

test('a package installed nowhere falls back to npx with the spec exactly as given', () => {
	const result = run(['cowsay@^1.0.0', 'hello'])
	expect(result.stdout).toContain('NPX-SHIM cowsay@^1.0.0 hello')
})

test('a bare-package miss falls back to npx with the bare spec (no @*)', () => {
	const result = run(['cowsay'])
	expect(result.stdout).toContain('NPX-SHIM cowsay')
	expect(result.stdout).not.toContain('cowsay@')
})

test('the fallback passes through a non-zero npx exit code', () => {
	const result = run(['tool-a@^9.0.0', 'build'], { NPX_SHIM_EXIT_CODE: '7' })
	expect(result.stdout).toContain('NPX-SHIM tool-a@^9.0.0 build')
	expect(result.status).toBe(7)
})

test('a fallback writes nothing into node_modules or the global store', () => {
	const before = { local: snapshotDir(localNodeModules()), global: snapshotDir(globalDir) }
	run(['cowsay@^1.0.0'])
	const after = { local: snapshotDir(localNodeModules()), global: snapshotDir(globalDir) }
	expect(after.local).toEqual(before.local)
	expect(after.global).toEqual(before.global)
})

// ── Transparent passthrough ──

test('arguments after the package spec are forwarded to the child verbatim', () => {
	const result = run(['tool-a@^1.0.0', 'diff', '--format', 'json', 'a.feature', 'b.feature'])
	expect(result.stdout).toContain('TOOL-A-LOCAL diff --format json a.feature b.feature')
})

test('a bare -- and the arguments after it are forwarded verbatim', () => {
	const result = run(['tool-a@^1.0.0', '--', '--raw', 'x'])
	expect(result.stdout).toContain('TOOL-A-LOCAL -- --raw x')
})

test("the child's non-zero exit code becomes upx's exit code", () => {
	const result = run(['tool-a@^1.0.0', 'validate', 'broken.feature'], { LOCAL_BIN_EXIT_CODE: '3' })
	expect(result.status).toBe(3)
})

// ── Bin resolution ──

test('a package whose executable name differs from the package name resolves its bin', () => {
	writeNamedBinInstall(localNodeModules(), 'some-tool', '2.0.0', 'st', 'ST-BIN')
	const result = run(['some-tool@^2.0.0'])
	expect(result.stdout).toContain('ST-BIN')
})

test('a package with multiple bins where one matches the package name resolves that bin', () => {
	writeMultiBinInstall(localNodeModules(), 'multi2', '1.0.0', [{ name: 'x' }, { name: 'multi2', marker: 'MULTI2-BIN' }])
	const result = run(['multi2@^1.0.0'])
	expect(result.stdout).toContain('MULTI2-BIN')
})

test('a package declaring multiple bins none matching its name fails loud', () => {
	writeMultiBinInstall(localNodeModules(), 'multi', '1.0.0', [{ name: 'x' }, { name: 'y' }])
	const result = run(['multi@^1.0.0'])
	expect(result.status).toBe(1)
	expect(result.stderr).toContain('error:')
	expect(result.stderr).toContain('multi')
})

test('a package that declares no bin fails loud', () => {
	writeNoBinInstall(localNodeModules(), 'nobin', '1.0.0')
	const result = run(['nobin@^1.0.0'])
	expect(result.status).toBe(1)
	expect(result.stderr).toContain('error:')
	expect(result.stderr).toContain('nobin')
})

// ── Scoped packages ──

test('a scoped package resolves on the last @ and runs locally', () => {
	writeStringBinInstall(localNodeModules(), '@acme/cli', '1.2.0', 'ACME-CLI')
	const result = run(['@acme/cli@^1.0.0', 'build'])
	expect(result.stdout).toContain('ACME-CLI build')
	expect(result.stdout).not.toContain('NPX-SHIM')
})

// ── Argument boundary ──

test('a flag after the package spec goes to the child, not to upx', () => {
	const result = run(['tool-a@^1.0.0', '--help'])
	expect(result.stdout).toContain('TOOL-A-LOCAL --help')
	expect(result.stdout).not.toContain('Usage: upx')
})

test('an unknown flag before the package spec fails loud', () => {
	const result = run(['--bogus', 'tool-a@^1.0.0'])
	expect(result.status).toBe(1)
	expect(result.stderr).toContain('--bogus')
})

// ── Fail-loud ──

test('no package spec fails loud', () => {
	const result = run([])
	expect(result.status).toBe(1)
	expect(result.stderr).toContain('error:')
	expect(result.stderr).toContain('package')
})

test('an unparseable package spec fails loud', () => {
	const result = run(['@@@bad@@@'])
	expect(result.status).toBe(1)
	expect(result.stderr).toContain('error:')
})

// ── Help ──

test('--help documents the runner', () => {
	const result = run(['--help'])
	expect(result.status).toBe(0)
	expect(result.stdout).toContain('Usage: upx')
	expect(result.stdout).toContain('<pkg>@<range>')
	expect(result.stdout).toContain('npx')
})
