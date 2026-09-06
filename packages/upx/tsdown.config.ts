import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: { upx: 'src/cli.ts' },
	outDir: 'dist',
	format: 'esm',
	platform: 'node',
	clean: true,
})
