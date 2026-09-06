import { describe, expect, it } from 'vitest'
import type { Install, RunFs } from './run.js'
import {
	distTagNotice,
	fallbackNotice,
	isSemverRange,
	isValidPackageName,
	parseArgv,
	parseSpec,
	resolveBinPath,
	runUpx,
	selectInstall,
} from './run.js'

// ── parseSpec ──

describe('parseSpec', () => {
	it('splits pkg and range on the last @', () => {
		expect(parseSpec('tool-a@^1.0.0')).toEqual({ ok: true, spec: { pkg: 'tool-a', range: '^1.0.0', bare: false } })
	})

	it('parses a scoped package spec on the last @', () => {
		expect(parseSpec('@acme/cli@^1.0.0')).toEqual({
			ok: true,
			spec: { pkg: '@acme/cli', range: '^1.0.0', bare: false },
		})
	})

	it('treats a bare package (no @) as range *', () => {
		expect(parseSpec('tool-a')).toEqual({ ok: true, spec: { pkg: 'tool-a', range: '*', bare: true } })
	})

	it('treats a trailing @ with empty range as bare', () => {
		expect(parseSpec('tool-a@')).toEqual({ ok: true, spec: { pkg: 'tool-a', range: '*', bare: true } })
	})

	it('fails loud on an empty spec', () => {
		const result = parseSpec('')
		expect(result.ok).toBe(false)
	})

	it('fails loud on an unparseable package name', () => {
		const result = parseSpec('@@@bad@@@')
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.error).toMatch(/error:/)
	})
})

describe('isValidPackageName', () => {
	it('accepts a plain name', () => {
		expect(isValidPackageName('tool-a')).toBe(true)
	})
	it('accepts a scoped name', () => {
		expect(isValidPackageName('@acme/cli')).toBe(true)
	})
	it('rejects an empty name', () => {
		expect(isValidPackageName('')).toBe(false)
	})
})

// ── isSemverRange (range classification) ──

describe('isSemverRange', () => {
	it.each(['^1.0.0', '~1.2.0', '1.2.3', '*'])('accepts %s as a semver range', (range) => {
		expect(isSemverRange(range)).toBe(true)
	})

	it.each(['next', 'latest'])('rejects dist-tag %s as a semver range', (tag) => {
		expect(isSemverRange(tag)).toBe(false)
	})
})

// ── selectInstall (local-first, nearest wins, global fallback) ──

describe('selectInstall', () => {
	function install(version: string, dir = `/x/${version}`): Install {
		return { dir, version, bin: 'bin.js' }
	}

	it('picks the nearest local install that satisfies the range', () => {
		const nearest = install('1.2.3', '/near')
		const farther = install('1.5.0', '/far')
		expect(selectInstall('^1.0.0', [nearest, farther], () => undefined)).toBe(nearest)
	})

	it('falls through to a later local install when the nearest does not satisfy', () => {
		const nearest = install('0.9.0', '/near')
		const farther = install('1.5.0', '/far')
		expect(selectInstall('^1.0.0', [nearest, farther], () => undefined)).toBe(farther)
	})

	it('prefers a satisfying local install over a satisfying global one', () => {
		const local = install('1.2.3', '/local')
		const global = install('1.9.0', '/global')
		expect(selectInstall('^1.0.0', [local], () => global)).toBe(local)
	})

	it('uses the global install when no local install satisfies', () => {
		const global = install('1.4.0', '/global')
		expect(selectInstall('^1.0.0', [], () => global)).toBe(global)
	})

	it('returns undefined when nothing satisfies', () => {
		expect(selectInstall('^9.0.0', [install('1.2.3')], () => install('1.4.0'))).toBeUndefined()
	})

	it('does not look up the global install when a local one satisfies', () => {
		// Locating the global root shells out to `npm root -g`, a full npm start-up. It is the single
		// most expensive thing `upx` can do, and a local hit must never pay for it.
		let calls = 0
		const local = install('1.2.3')
		expect(
			selectInstall('^1.0.0', [local], () => {
				calls++
				return undefined
			}),
		).toBe(local)
		expect(calls).toBe(0)
	})

	it('looks up the global install at most once when no local satisfies', () => {
		let calls = 0
		selectInstall('^9.0.0', [install('1.2.3'), install('2.0.0')], () => {
			calls++
			return undefined
		})
		expect(calls).toBe(1)
	})
})

// ── resolveBinPath (bin resolution) ──

describe('resolveBinPath', () => {
	it('resolves a string bin', () => {
		expect(resolveBinPath('tool-a', 'bin/tool-a.js')).toEqual({ ok: true, bin: 'bin/tool-a.js' })
	})

	it('resolves a single-entry object bin whose name differs from the package', () => {
		expect(resolveBinPath('some-tool', { st: 'bin/st.js' })).toEqual({ ok: true, bin: 'bin/st.js' })
	})

	it('resolves a multi-bin object keyed by the package name', () => {
		expect(resolveBinPath('multi2', { x: 'bin/x.js', multi2: 'bin/multi2.js' })).toEqual({
			ok: true,
			bin: 'bin/multi2.js',
		})
	})

	it('resolves a scoped package by its unscoped name among several bins', () => {
		expect(resolveBinPath('@acme/cli', { x: 'bin/x.js', cli: 'bin/cli.js' })).toEqual({
			ok: true,
			bin: 'bin/cli.js',
		})
	})

	it('fails loud on multiple bins with no match', () => {
		const result = resolveBinPath('multi', { x: 'bin/x.js', y: 'bin/y.js' })
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error).toMatch(/error:/)
			expect(result.error).toContain('multi')
		}
	})

	it('fails loud when there is no bin field', () => {
		const result = resolveBinPath('nobin', undefined)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error).toMatch(/error:/)
			expect(result.error).toContain('nobin')
		}
	})
})

// ── parseArgv (argument boundary) ──

describe('parseArgv', () => {
	it('treats the first non-flag token as the spec and forwards the rest as child args', () => {
		expect(parseArgv(['tool-a@^1.0.0', 'build'])).toEqual({
			ok: true,
			args: { help: false, spec: 'tool-a@^1.0.0', childArgs: ['build'] },
		})
	})

	it('forwards a flag after the spec to the child untouched', () => {
		expect(parseArgv(['tool-a@^1.0.0', '--help'])).toEqual({
			ok: true,
			args: { help: false, spec: 'tool-a@^1.0.0', childArgs: ['--help'] },
		})
	})

	it('forwards a bare -- and args after it verbatim', () => {
		expect(parseArgv(['tool-a@^1.0.0', '--', '--raw', 'x'])).toEqual({
			ok: true,
			args: { help: false, spec: 'tool-a@^1.0.0', childArgs: ['--', '--raw', 'x'] },
		})
	})

	it('recognizes --help before the spec', () => {
		expect(parseArgv(['--help'])).toEqual({ ok: true, args: { help: true, spec: undefined, childArgs: [] } })
	})

	it('fails loud on an unknown flag before the spec', () => {
		const result = parseArgv(['--bogus', 'tool-a@^1.0.0'])
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.error).toContain('--bogus')
	})

	it('fails loud when there is no package spec', () => {
		const result = parseArgv([])
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error).toMatch(/error:/)
			expect(result.error).toContain('package')
		}
	})
})

describe('fallbackNotice', () => {
	it('has the fixed prefix and mentions npx', () => {
		const notice = fallbackNotice('tool-a', '^9.0.0')
		expect(notice).toBe('upx: no installed tool-a satisfies "^9.0.0", using npx')
	})
})

describe('distTagNotice', () => {
	it('keeps the fixed prefix, names the dist-tag, and never claims "satisfies"', () => {
		const notice = distTagNotice('tool-a', 'next')
		expect(notice).toMatch(/^upx: no installed tool-a/)
		expect(notice).toContain('dist-tag')
		expect(notice).toContain('npx')
		expect(notice).not.toContain('satisfies')
	})
})

// ── runUpx orchestration (fake RunFs, no spawning) ──

function fakeRunFs(
	overrides: Partial<RunFs> = {},
): RunFs & { spawnBinCalls: [string, string[]][]; spawnNpxCalls: string[][] } {
	const spawnBinCalls: [string, string[]][] = []
	const spawnNpxCalls: string[][] = []
	return {
		findLocalInstalls: () => [],
		findGlobalInstall: () => undefined,
		spawnBin: (binPath, args) => {
			spawnBinCalls.push([binPath, args])
			return 0
		},
		spawnNpx: (args) => {
			spawnNpxCalls.push(args)
			return 0
		},
		...overrides,
		spawnBinCalls,
		spawnNpxCalls,
	}
}

describe('runUpx', () => {
	it('spawns the nearest local install directly and does not touch npx', () => {
		const fs = fakeRunFs({
			findLocalInstalls: () => [{ dir: '/proj/node_modules/tool-a', version: '1.2.3', bin: 'bin.js' }],
		})
		const outcome = runUpx(['tool-a@^1.0.0', 'build'], fs)
		expect(outcome).toEqual({ kind: 'exit', code: 0 })
		expect(fs.spawnBinCalls).toEqual([['/proj/node_modules/tool-a/bin.js', ['build']]])
		expect(fs.spawnNpxCalls).toEqual([])
	})

	it('falls back to npx with a notice when nothing satisfies the range', () => {
		const fs = fakeRunFs()
		const outcome = runUpx(['tool-a@^9.0.0', 'build'], fs)
		expect(outcome).toEqual({
			kind: 'exit',
			code: 0,
			notice: 'upx: no installed tool-a satisfies "^9.0.0", using npx',
		})
		expect(fs.spawnNpxCalls).toEqual([['tool-a@^9.0.0', 'build']])
	})

	it('falls back to npx with the bare spec (no @*) on a bare-package miss', () => {
		const fs = fakeRunFs()
		runUpx(['cowsay'], fs)
		expect(fs.spawnNpxCalls).toEqual([['cowsay']])
	})

	it('sends a dist-tag spec straight to npx without a local lookup', () => {
		const fs = fakeRunFs()
		const outcome = runUpx(['tool-a@next'], fs)
		expect(fs.spawnNpxCalls).toEqual([['tool-a@next']])
		expect(outcome.kind === 'exit' && outcome.notice).toMatch(/^upx: no installed tool-a/)
		// a dist-tag is not a range — the notice must not claim versions failed to "satisfy" it
		expect(outcome.kind === 'exit' && outcome.notice).not.toContain('satisfies')
		expect(outcome.kind === 'exit' && outcome.notice).toContain('dist-tag')
	})

	it('passes through the child exit code', () => {
		const fs = fakeRunFs({
			findLocalInstalls: () => [{ dir: '/x', version: '1.2.3', bin: 'bin.js' }],
			spawnBin: () => 3,
		})
		const outcome = runUpx(['tool-a@^1.0.0'], fs)
		expect(outcome).toEqual({ kind: 'exit', code: 3 })
	})

	it('fails loud when bin resolution fails for a matched install', () => {
		const fs = fakeRunFs({ findLocalInstalls: () => [{ dir: '/x', version: '1.0.0', bin: { x: 'a', y: 'b' } }] })
		const outcome = runUpx(['multi@^1.0.0'], fs)
		expect(outcome.kind).toBe('error')
	})

	it('returns help outcome for --help', () => {
		const outcome = runUpx(['--help'], fakeRunFs())
		expect(outcome.kind).toBe('help')
		if (outcome.kind === 'help') {
			expect(outcome.text).toContain('Usage: upx')
			expect(outcome.text).toContain('<pkg>@<range>')
			expect(outcome.text).toContain('npx')
		}
	})

	it('returns an error outcome for a missing package spec', () => {
		const outcome = runUpx([], fakeRunFs())
		expect(outcome.kind).toBe('error')
	})
})
