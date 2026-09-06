// @ts-check
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

export default defineConfig({
	site: 'https://repobuddy.github.io',
	base: '/upx',
	integrations: [
		starlight({
			title: 'upx',
			description:
				'A local-first package runner — resolve a semver range against installs that already exist and run them directly, falling back to npx.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/repobuddy/upx' }],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Installation', slug: 'getting-started/installation' },
					],
				},
				{
					label: 'Concepts',
					items: [
						{ label: 'Why upx exists', slug: 'concepts/why-upx' },
						{ label: 'Measurements', slug: 'concepts/measurements' },
						{ label: 'Tradeoffs', slug: 'concepts/tradeoffs' },
					],
				},
				{
					label: 'Reference',
					items: [{ label: 'Resolution', slug: 'reference/resolution' }],
				},
			],
		}),
	],
})
