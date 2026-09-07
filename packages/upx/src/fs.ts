import { spawnSync } from 'node:child_process'
import * as fsNode from 'node:fs'
import * as path from 'node:path'
import type { Install, RunFs } from './run.js'

const isWindows = process.platform === 'win32'

function readInstall(dir: string): Install | undefined {
	try {
		const raw = fsNode.readFileSync(path.join(dir, 'package.json'), 'utf8')
		const pkg = JSON.parse(raw) as { version?: string; bin?: string | Record<string, string> }
		if (typeof pkg.version !== 'string') return undefined
		return { dir, version: pkg.version, bin: pkg.bin }
	} catch {
		return undefined
	}
}

function packageDirIn(nodeModulesDir: string, pkg: string): string {
	return path.join(nodeModulesDir, ...pkg.split('/'))
}

/** Every ancestor `node_modules` directory from `startDir` up to the filesystem root, nearest
 *  first. */
function ancestorNodeModulesDirs(startDir: string): string[] {
	const dirs: string[] = []
	let dir = startDir
	for (;;) {
		dirs.push(path.join(dir, 'node_modules'))
		const parent = path.dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return dirs
}

/** Walks `node_modules` from `cwd` up through its ancestors, nearest first, collecting every
 *  install of `pkg` found along the way (an install missing a readable `package.json` version is
 *  skipped, not a match). */
export function findLocalInstalls(pkg: string, cwd: string): Install[] {
	const installs: Install[] = []
	for (const nodeModulesDir of ancestorNodeModulesDirs(cwd)) {
		const install = readInstall(packageDirIn(nodeModulesDir, pkg))
		if (install) installs.push(install)
	}
	return installs
}

// ── Spawning ──
//
// POSIX spawns a file and the kernel honours its `#!` line. Windows has neither: a script is not
// a program there, and `npm`/`npx` are `.cmd` shims only `cmd.exe` can interpret. The helpers
// below are the whole of that difference; every one of them is skipped outright on POSIX.

/** cmd.exe metacharacters — `^` above all, which is in every caret range `upx` forwards. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/** cmd.exe has no argv: it re-parses one command line, so an argument has to survive that pass
 *  intact or `tool-a@^1.0.0` reaches npx as `tool-a@1.0.0`. Quote for the C runtime's parser
 *  first, then `^`-escape cmd's own metacharacters — twice for a `.cmd`/`.bat` target, whose `%*`
 *  expansion parses them a second time. These are `cross-spawn`'s rules, inlined rather than
 *  depended on: `upx` pays for every dependency on every invocation. */
function escapeCmdArgument(arg: string, doubleEscape: boolean): string {
	const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`
	const escaped = quoted.replace(CMD_META, '^$1')
	return doubleEscape ? escaped.replace(CMD_META, '^$1') : escaped
}

/** Resolves `command` on `PATH` the way cmd.exe does — each `PATH` entry crossed with `PATHEXT`,
 *  never the bare name — so `upx` knows whether it holds a `.cmd` shim or a real executable. */
function findOnWindowsPath(command: string): string | undefined {
	const exts = (process.env['PATHEXT'] || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
	for (const dir of (process.env['PATH'] || '').split(path.delimiter).filter(Boolean)) {
		for (const ext of exts) {
			const candidate = path.join(dir, command + ext)
			try {
				if (fsNode.statSync(candidate).isFile()) return candidate
			} catch {
				// Not there, or not readable — keep looking.
			}
		}
	}
	return undefined
}

function isBatchFile(file: string): boolean {
	const ext = path.extname(file).toLowerCase()
	return ext === '.cmd' || ext === '.bat'
}

/** The `cmd.exe` argv that runs `file` with `args`. `cmd.exe` is the only thing that can
 *  interpret a `.cmd`/`.bat` shim; `windowsVerbatimArguments` hands it this line as it stands. */
function cmdArgv(file: string, args: string[]): string[] {
	const doubleEscape = isBatchFile(file)
	const command = path.normalize(file).replace(CMD_META, '^$1')
	const line = [command, ...args.map((arg) => escapeCmdArgument(arg, doubleEscape))].join(' ')
	return ['/d', '/s', '/c', `"${line}"`]
}

function comSpec(): string {
	return process.env['ComSpec'] || 'cmd.exe'
}

function spawnThroughCmd(file: string, args: string[]): number {
	const result = spawnSync(comSpec(), cmdArgv(file, args), { stdio: 'inherit', windowsVerbatimArguments: true })
	if (result.error) throw result.error
	return result.status ?? 1
}

/** The `#!` line's interpreter and its arguments, or `undefined` when `file` has no shebang.
 *  Reads the head of the file only — this is on the hot path of every Windows invocation. */
function readShebang(file: string): string[] | undefined {
	let fd: number | undefined
	try {
		fd = fsNode.openSync(file, 'r')
		const buf = Buffer.alloc(256)
		const read = fsNode.readSync(fd, buf, 0, 256, 0)
		const head = buf.toString('utf8', 0, read)
		if (!head.startsWith('#!')) return undefined
		const line = head.split(/\r?\n/, 1)[0]!
		const parts = line.slice(2).trim().split(/\s+/).filter(Boolean)
		return parts.length > 0 ? parts : undefined
	} catch {
		return undefined
	} finally {
		if (fd !== undefined) fsNode.closeSync(fd)
	}
}

/** Windows never honours a `#!` line, so a package's JavaScript bin cannot be spawned as a
 *  program. `upx` reads the shebang and spawns the interpreter it names itself — `node`, however
 *  the shebang spells it, becomes the Node already running, so the child needs nothing on `PATH`.
 *  A bin with no shebang is already a real executable and is spawned as it stands. */
function windowsBinCommand(binPath: string): [string, string[]] {
	const shebang = readShebang(binPath)
	if (!shebang) return [binPath, []]

	let [interpreter, ...rest] = shebang as [string, ...string[]]
	if (path.basename(interpreter, path.extname(interpreter)) === 'env') {
		// `#!/usr/bin/env node`, or `#!/usr/bin/env -S node --flag`: the interpreter is the first
		// token that is not one of `env`'s own flags.
		while (rest.length > 0 && rest[0]!.startsWith('-')) rest.shift()
		if (rest.length === 0) return [binPath, []]
		interpreter = rest.shift()!
	}
	if (path.basename(interpreter, path.extname(interpreter)) === 'node') interpreter = process.execPath
	return [interpreter, rest]
}

/** `npm root -g` costs a full npm start-up, so it runs only after every local install is ruled
 *  out (see `selectInstall`). On Windows `npm` is a `.cmd` shim and has to go through cmd.exe. */
function globalRoot(): string | undefined {
	try {
		let result: { stdout?: string }
		if (!isWindows) {
			result = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' })
		} else {
			const npm = findOnWindowsPath('npm')
			if (!npm) return undefined
			result = isBatchFile(npm)
				? spawnSync(comSpec(), cmdArgv(npm, ['root', '-g']), { encoding: 'utf8', windowsVerbatimArguments: true })
				: spawnSync(npm, ['root', '-g'], { encoding: 'utf8' })
		}
		const out = result.stdout?.trim()
		return out ? out : undefined
	} catch {
		return undefined
	}
}

export function findGlobalInstall(pkg: string): Install | undefined {
	const root = globalRoot()
	if (!root) return undefined
	return readInstall(packageDirIn(root, pkg))
}

export function spawnBin(binPath: string, args: string[]): number {
	if (isWindows) {
		const [command, prefix] = windowsBinCommand(binPath)
		const spawnArgs = command === binPath ? args : [...prefix, binPath, ...args]
		if (isBatchFile(command)) return spawnThroughCmd(command, spawnArgs)
		const result = spawnSync(command, spawnArgs, { stdio: 'inherit' })
		if (result.error) throw result.error
		return result.status ?? 1
	}
	const result = spawnSync(binPath, args, { stdio: 'inherit' })
	if (result.error) throw result.error
	return result.status ?? 1
}

export function spawnNpx(args: string[]): number {
	if (isWindows) {
		const npx = findOnWindowsPath('npx')
		if (!npx) throw new Error('error: npx was not found on PATH')
		if (isBatchFile(npx)) return spawnThroughCmd(npx, args)
		const result = spawnSync(npx, args, { stdio: 'inherit' })
		if (result.error) throw result.error
		return result.status ?? 1
	}
	const result = spawnSync('npx', args, { stdio: 'inherit' })
	if (result.error) throw result.error
	return result.status ?? 1
}

export function realRunFs(): RunFs {
	return {
		findLocalInstalls: (pkg) => findLocalInstalls(pkg, process.cwd()),
		findGlobalInstall,
		spawnBin,
		spawnNpx,
	}
}
