import { defineNuxtModule } from 'nuxt/kit'
import blogConfig from '../../blog.config'
import handleMirror from './runtime/client'

const blacklist = [
	'dgjlx.com', // blog.revincx.icu
	'dgvhqt.com', // blog.zhilu.cyou
	'hcmsla.com', // thyuu.com
	'wmlop.com', // xaoxuu.com
	'yswjxs.com', // blog.zhilu.cyou
]

export default defineNuxtModule({
	meta: {
		name: 'anti-mirror',
	},
	setup(options, nuxt) {
		(nuxt.options.app.head.script ??= []).push({
			innerHTML: `(${handleMirror.toString()})(${JSON.stringify(blacklist)},${JSON.stringify(blogConfig.url)})`,
		})
	},
})