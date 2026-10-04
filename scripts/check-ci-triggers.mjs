#!/usr/bin/env node
/**
 * 部署流水线形状门禁。
 *
 * ## 它盯的是什么
 *
 * 2026-10-03 Astro 接管仓库根之前，这里有两个流水线：`build.yml`（Nuxt，push main 自动发）
 * 与 `build-astro.yml`（Astro，只手动触发）。它们**都往同一个 `PaloMiku/blog-public` 的
 * main 分支部署**，所以「同时自动触发」= 两条流水线互相覆盖对方的产物。
 * 那时这道门禁的判据是「两者不得都自动触发」。
 *
 * 接管后这个前提没了：仓库里只剩一条流水线，它就该是唯一的事实源。因此新不变式是：
 *
 *   1. `.github/workflows/` 下**只有一条**部署流水线（多一条 = 又一次双轨）；
 *   2. 它部署的目录是站点根的 `dist`（不是某个子目录——子目录已经不存在了）；
 *   3. `on.push` 的分支里**有** `main`（接管意味着 push main 即发布；
 *      没有它 = 站点改成手动发布，而没人会注意到）；
 *   4. 部署目标仍是 `PaloMiku/blog-public` / `main`（换目标 = 换托管，静默发生就是事故）；
 *   5. 它调用的每一道 `node scripts/*.mjs` 门禁**在仓库里真实存在**
 *      （CI 里 `run:` 指向不存在的脚本会在那一步才炸，而那一步已经在部署前——
 *      顺序上是安全的，但报错信息离原因很远）。
 *   6. 部署流水线**必须**通过 `scripts/accept.mjs` 跑门禁，而不是手抄一份名单。
 *      手抄那份已经漂过：本地新增的门禁没同步到 CI，而抓到真缺陷最多的
 *      `check-affordances` 就因此只在本地跑。判据从「CI 列了哪些门禁」改成
 *      「CI 有没有调用那个唯一事实源」，漂移就无处可藏。
 *   7. `accept.mjs` 名单里的每一道脚本都真实存在——「写了没接线」在本地就红，
 *      而不是等到某次验收静默 `SKIP`。
 *
 * ## 第 0 条判据是它自己
 *
 * `parse()` 抛异常就退出 1。2026-10-03 实测：`build-astro.yml` 里有 4 个
 * `- name: Gate: …`（冒号后带空格且未加引号），YAML 直接解析失败，
 * 那道流水线**一次都没能跑起来**。这道门禁当时是红的，只是原因看起来像脚本崩了。
 *
 * 用法：node scripts/check-ci-triggers.mjs
 * 退出码：0 = 形状正确；1 = 有问题（含 YAML 解析失败）
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WF_DIR = join(ROOT, '.github', 'workflows')

if (!existsSync(WF_DIR)) {
	console.error('✗ .github/workflows 不存在')
	process.exit(1)
}

const files = readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f)).sort()
if (files.length === 0) {
	console.error('✗ .github/workflows 下没有任何工作流')
	process.exit(1)
}

const problems = []
const report = []

for (const file of files) {
	let doc
	try {
		doc = parse(readFileSync(join(WF_DIR, file), 'utf8'))
	}
	catch (err) {
		// 判据 0：YAML 必须可解析。不加 try/catch 的话，栈会指向 yaml 包内部，
		// 读起来像「门禁自己坏了」——而真实原因是那个文件根本不是合法 YAML。
		problems.push(`${file}: YAML 解析失败：${err.message}`)
		continue
	}

	// YAML 1.1 把裸 `on` 解析成布尔 true；两种拼法都要认
	const on = doc.on ?? doc.true ?? {}
	const triggers = Object.keys(on)
	const pushBranches = on.push?.branches ?? null

	const steps = Object.values(doc.jobs ?? {}).flatMap(j => j.steps ?? [])
	const deploy = steps.find(s => s.uses?.includes('github-pages-deploy-action'))?.with
	const gateRuns = steps
		.map(s => s.run)
		.filter(r => typeof r === 'string')
		.map(r => /node\s+(scripts\/[\w.-]+\.mjs)/.exec(r)?.[1])
		.filter(Boolean)

	report.push({ file, triggers, pushBranches, gateRuns, deploy })

	for (const g of gateRuns) {
		if (!existsSync(join(ROOT, g)))
			problems.push(`${file}: 门禁步骤引用了不存在的脚本 ${g}`)
	}
}

console.log(JSON.stringify(report, null, 2))

// 判据 1：只有一条部署流水线
const deployers = report.filter(r => r.deploy)
if (deployers.length === 0)
	problems.push('没有任何工作流使用 github-pages-deploy-action —— 站点将不再被部署')
if (deployers.length > 1) {
	problems.push(`有 ${deployers.length} 条部署流水线（${deployers.map(d => d.file).join(', ')}），`
		+ '它们都往同一个 blog-public 部署，会互相覆盖产物')
}

for (const d of deployers) {
	// 判据 2：部署目录是站点根
	if (d.deploy.folder !== 'dist')
		problems.push(`${d.file}: 部署目录是 ${JSON.stringify(d.deploy.folder)}，应为 dist`)

	// 判据 3：push main 即发布
	if (!d.triggers.includes('push'))
		problems.push(`${d.file}: 没有 push 触发器 —— 接管后 push main 应直接发布`)
	else if (Array.isArray(d.pushBranches) && !d.pushBranches.includes('main'))
		problems.push(`${d.file}: push 分支是 ${JSON.stringify(d.pushBranches)}，不含 main`)

	// 判据 4：托管目标没被换掉
	if (d.deploy['repository-name'] !== 'PaloMiku/blog-public' || d.deploy.branch !== 'main')
		problems.push(`${d.file}: 部署目标变成 ${d.deploy['repository-name']}@${d.deploy.branch}`)
}

// 判据 6 + 7：门禁名单的唯一事实源是 scripts/accept.mjs。
// CI 必须调它（而不是自己再列一遍），而它列的每一道脚本都必须真实存在——
// 「写了没接线」在本地就红，而不是等到某次验收静默 SKIP。
{
	const wfSteps = Object.values(deployers.length
		? parse(readFileSync(join(WF_DIR, deployers[0].file), 'utf8')).jobs ?? {}
		: {}).flatMap(j => j.steps ?? [])
	const runs = wfSteps.map(s => s.run).filter(r => typeof r === 'string')
	if (!runs.some(r => /node\s+scripts\/accept\.mjs/.test(r))) {
		problems.push('部署流水线没有通过 `node scripts/accept.mjs` 跑门禁。手抄的 `- name: Gate: x` 清单已经漂过一次：'
			+ '本地新增的门禁没同步到 CI，抓到真缺陷最多的 check-affordances 就因此只在本地跑。')
	}
	const { OFFLINE_GATES, FULL_EXTRA, BUILD_WARNING_GATE, gateName, gatePolicy } = await import('./accept.mjs')
	// 名单元素是字符串或 { name, skip, why } 两种形态，必须过 gateName 取名——
	// 直接当字符串拼路径会得到 '[object Object]'，existsSync 一律 false，
	// 于是这道门禁会把名单里**每一道**都报成「不存在」。它自己会暴露，
	// 但那 30 条假问题会把真正的缺失埋掉，所以取名要走同一把尺子。
	for (const g of [...OFFLINE_GATES, ...FULL_EXTRA.map(x => x.script.replace(/\.mjs$/, ''))]) {
		const name = gateName(g)
		if (!existsSync(join(ROOT, 'scripts', `${name}.mjs`)))
			problems.push(`accept.mjs 名单里的 ${name}.mjs 不存在——它在名单里但一次都不会跑`)
		// 顺带把 skip 策略校一遍：非法值、缺 why，gatePolicy 会抛，
		// 抛在这里就是「名单本身写错了」而不是门禁报红，位置更准。
		gatePolicy(g)
	}
	if (!existsSync(join(ROOT, 'scripts', `${BUILD_WARNING_GATE}.mjs`)))
		problems.push(`accept.mjs 要跑的 ${BUILD_WARNING_GATE}.mjs 不存在`)
}

if (problems.length) {
	console.error(`\n✗ 流水线形状有 ${problems.length} 处问题：\n`)
	for (const p of problems)
		console.error(`  - ${p}`)
	process.exit(1)
}

console.log('\nOK: 只有一条部署流水线，push main 触发，部署站点根的 dist，')
console.log('    目标 PaloMiku/blog-public@main，门禁走 scripts/accept.mjs 这一个事实源，')
console.log('    名单里的脚本都存在。')
