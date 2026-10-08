/**
 * `--key=value` 形式的命令行参数读取。
 *
 * ## 为什么能抽
 *
 * `compare-ui-parity.mjs` 有 17 处 `argOf(...)`，`probe-subtree.mjs` 有 9 处，
 * 两边的实现**逐字相同**（抽取前用 `seg(a,56,59) === seg(b,53,56)` 核过）。
 * 一份 4 行的函数复制两份，意味着任何一个「默认值改错」都会让两个仪器的
 * 默认行为**静默分叉**——而这两个仪器的量测对象是同一对站点、同一套视口，
 * 分叉之后两份结果放在一起看时没有任何提示。
 *
 * ## 边界：只抽「读参数」，不碰「参数怎么解释」
 *
 * `argOf` 返回的是**字符串**，`Number(...)` / `!== 'off'` 这些解释动作留在调用点。
 * 理由是默认值散在 26 个调用点里，每一处都带着自己的理由注释（比如
 * `--mode` 的容差为什么离线是 4、在线是 40；`--samples` 为什么 `Math.max(2, …)`）。
 * 把解释也收进 lib 就会把这些注释连同它们的根据一起搬走，而搬走之后
 * 下一个人看到的是一个"合理的默认值"，看不到它为什么是这个值。
 *
 * ## 故意不支持的两种写法
 *
 * 1. `--flag`（无 `=`）：`STYLES` 用的是 `process.argv.includes('--styles')`，
 *    不是 `argOf('styles')`。把布尔开关也塞进来就要发明 `''`/`'true'` 的约定，
 *    那会**改变**现有两个脚本的 CLI 语义——`--styles` 现在必须精确匹配，
 *    `--styles=1` 不生效。保持原样。
 * 2. 短选项 / `--no-xxx` 取反：两个脚本都没用，加进来只是未被证明有用的防御性代码
 *    （与 `compare-ui-parity.mjs:646-654` 记录的那次 `--settle` 回退同一个教训）。
 */

import process from 'node:process'

/**
 * 取 `--<k>=<value>` 的 value；没给就返回 `dflt`。
 *
 * 注意 `process.argv.find` 取的是**第一个**匹配项，所以同名参数重复出现时
 * 静默取先出现的那个。两个脚本都依赖这个行为吗？否——但也不依赖"后者覆盖前者"，
 * 所以别改这个实现细节，除非同时给两个脚本加上重复参数的报错。
 *
 * @param {string} k 参数名，不带 `--` 与 `=`
 * @param {string | null} [dflt] 缺省值，缺省 `null`
 * @returns {string | null} 参数值；没给时是 `dflt`
 */
export function argOf(k, dflt = null) {
	const a = process.argv.find(x => x.startsWith(`--${k}=`))
	return a ? a.slice(k.length + 3) : dflt
}
