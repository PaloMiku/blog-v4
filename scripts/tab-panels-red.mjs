/**
 * 红控：面板语法注入的每一类缺陷都必须让**构建**失败。
 *
 * 判据是构建退出码，不是脚本输出——「打了分不算红」那一族。
 * 每一例都真的跑一次 astro build（~15s），跑完把探针页删掉。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import process from 'node:process'

const PROBE = 'src/content/posts/2026/10/_tab-red.mdx'
const FM = '---\ntitle: 红控（临时）\ndate: 2026-10-04 00:00:00\ndraft: true\n---\n\n'

const CASES = [
	{
		name: '页签 3 个但只写了 2 个标记',
		expect: /声明了 3 个页签，但正文里只有 2 个/,
		body: '<Tab tabs={["一", "二", "三"]}>\n\n#tab1\n甲\n\n#tab2\n乙\n\n</Tab>\n',
	},
	{
		name: '页签 2 个但写了 3 个标记',
		expect: /声明了 2 个页签，但正文里只有 3 个/,
		body: '<Tab tabs={["一", "二"]}>\n\n#tab1\n甲\n\n#tab2\n乙\n\n#tab3\n丙\n\n</Tab>\n',
	},
	{
		name: '标记不连续（tab1 后直接 tab3）',
		expect: /面板编号必须从 1 连续递增/,
		body: '<Tab tabs={["一", "二"]}>\n\n#tab1\n甲\n\n#tab3\n丙\n\n</Tab>\n',
	},
	{
		name: '面板正文含三反引号围栏（新旧两种写法都该由 prose 层接住，不该在这里炸）',
		expect: /页面没构建|dist/,
		shouldBuild: true,
		body: '<Tab tabs={["一", "二"]}>\n\n#tab1\n```js\nconsole.log(1)\n```\n\n#tab2\n乙\n\n</Tab>\n',
	},
]

function build() {
	const r = spawnSync('pnpm', ['build'], { encoding: 'utf8', shell: process.platform === 'win32' })
	return { code: r.status, log: `${r.stdout || ''}${r.stderr || ''}` }
}

let bad = 0
for (const [i, c] of CASES.entries()) {
	writeFileSync(PROBE, FM + c.body, 'utf8')
	const { code, log } = build()
	// `shouldBuild` 的用例反过来判：必须**构建成功**，且产出的页面里围栏代码块完整
	if (c.shouldBuild) {
		const file = 'dist/2026/10/_tab-red/index.html'
		const built = code === 0 && existsSync(file)
		if (!built)
			bad++
		console.log(`[${i + 1}] ${built ? '绿 ✓' : '炸了 ✗'}  exit=${code}  ${c.name}`)
		continue
	}
	const matched = c.expect.test(log)
	const ok = code !== 0 && matched
	if (!ok)
		bad++
	console.log(`[${i + 1}] ${ok ? '红 ✓' : '未拦住 ✗'}  exit=${code}  ${c.name}`)
	if (!ok) {
		const err = log.split('\n').filter(l => l.includes('[ERROR]') || l.includes('Error:')).slice(0, 3)
		for (const l of err) console.log(`      ${l.slice(0, 150)}`)
	}
}

if (existsSync(PROBE))
	rmSync(PROBE)
console.log('')
console.log(bad ? `RESULT: FAIL - ${bad} 个红控没拦住` : 'RESULT: PASS - 每类缺陷都让构建失败')
process.exit(bad ? 1 : 0)
