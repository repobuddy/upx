import { spawnSync } from 'node:child_process'
import * as fsNode from 'node:fs'
import * as path from 'node:path'
import type { Install, RunFs } from './run.js'

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

function globalRoot(): string | undefined {
	try {
		const result = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' })
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
	const result = spawnSync(binPath, args, { stdio: 'inherit' })
	if (result.error) throw result.error
	return result.status ?? 1
}

export function spawnNpx(args: string[]): number {
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
