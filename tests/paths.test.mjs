/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test（vitest 不在本仓库依赖里，见 package.json 的 test 脚本）。 */
// EC-005：`scripts/lib/paths.mjs` 的 toRoute / fileToRoute 契约单测。
// 测的是**合同**而非实现细节：
//   toRoute     —— 去尾斜杠；站点根恒为 `/`（空串/纯斜杠都塌回 `/`）；先 trim。
//   fileToRoute —— dist 产物文件（绝对或相对仓库根）→ 站点路由；
//                  仅根 `index.html` → `/`，目录级 `index.html` 塌缩为目录路由；
//                  其余 `.html` 后缀是文件名的一部分，不剥。
import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { DIST, fileToRoute, REPO_ROOT, toRoute } from '../scripts/lib/paths.mjs'

describe('toRoute', () => {
	it('去掉尾斜杠', () => {
		assert.equal(toRoute('/foo/'), '/foo')
		assert.equal(toRoute('/foo///'), '/foo')
		assert.equal(toRoute('foo/bar/'), 'foo/bar')
	})

	it('无尾斜杠时原样（只去尾，不动前导与中间）', () => {
		assert.equal(toRoute('/foo'), '/foo')
		assert.equal(toRoute('/a/b/c'), '/a/b/c')
	})

	it('站点根：空串与纯斜杠都恒返回 `/`，绝不返回空串', () => {
		assert.equal(toRoute(''), '/')
		assert.equal(toRoute('/'), '/')
		// ⚠️ 比收敛前旧实现更严一档：'///' 这类全斜杠输入旧实现会塌成 ''，
		// 收敛后的不变式是「剥完为空串一律回 /」——这是有意为之的钉。
		assert.equal(toRoute('///'), '/')
	})

	it('先 trim 再判定', () => {
		assert.equal(toRoute('  /foo/  '), '/foo')
		assert.equal(toRoute('   '), '/')
	})

	it('幂等：对已归一的路由再跑一次不变', () => {
		for (const p of ['/foo', '/', '/foo/', '///', '/a/b//'])
			assert.equal(toRoute(toRoute(p)), toRoute(p))
	})
})

describe('fileToRoute', () => {
	it('根 index.html → `/`（不是空串）', () => {
		assert.equal(fileToRoute('dist/index.html'), '/')
	})

	it('目录级 index.html → 目录路由并带前导斜杠', () => {
		assert.equal(fileToRoute('dist/posts/foo/index.html'), '/posts/foo')
		assert.equal(fileToRoute(path.join(DIST, 'games', 'index.html')), '/games')
	})

	it('接受绝对路径（平台原生分隔符经 path.join 归一）', () => {
		const abs = path.join(REPO_ROOT, 'dist', 'posts', 'a', 'b', 'index.html')
		assert.equal(fileToRoute(abs), '/posts/a/b')
	})

	it('非 index 的 .html 文件名：.html 不剥，作为路由的一部分', () => {
		assert.equal(fileToRoute('dist/notes/page.html'), '/notes/page.html')
	})

	it('index.html 只在路径末尾/目录段末尾塌缩，中间或变体名不塌', () => {
		assert.equal(fileToRoute('dist/index.html/foo.html'), '/index.html/foo.html')
		assert.equal(fileToRoute('dist/previews/index-draft.html'), '/previews/index-draft.html')
	})

	it('Windows 反斜杠相对路径按平台分隔符解析（用 path.sep 构造，跨平台同义）', () => {
		const native = ['dist', 'posts', 'x', 'index.html'].join(path.sep)
		assert.equal(fileToRoute(native), '/posts/x')
	})

	it('产物路由与 toRoute 复合一致（尾斜杠输入塌到同一路由）', () => {
		assert.equal(fileToRoute('dist/posts/foo/index.html'), toRoute('/posts/foo/'))
	})
})
