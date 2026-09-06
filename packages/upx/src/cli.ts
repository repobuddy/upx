#!/usr/bin/env node
// Hand-rolled entry — deliberately NOT commander. `upx`'s whole value proposition is fast
// cold-start, so it must not pay an argument parser's parse/require cost on every invocation.
// Keep this package dependency-light for the same reason.
import { realRunFs } from './fs.js'
import { runUpx } from './run.js'

const outcome = runUpx(process.argv.slice(2), realRunFs())

if (outcome.kind === 'help') {
	process.stdout.write(outcome.text)
	process.exit(0)
}

if (outcome.kind === 'error') {
	process.stderr.write(`${outcome.message}\n`)
	process.exit(1)
}

if (outcome.notice) process.stderr.write(`${outcome.notice}\n`)
process.exit(outcome.code)
