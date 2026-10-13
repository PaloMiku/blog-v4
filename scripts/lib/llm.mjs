/**
 * OpenAI 兼容 chat/completions 的 fetch 封装——**零依赖**。
 *
 * ## 为什么不用 Vercel AI SDK
 *
 * 整个用法就一个 POST。引入一棵依赖树只为省一次 fetch，与仓库「零 LLM 依赖」
 * 的约定不符（CLAUDE.md 技术栈），CI 装包也变慢。而 OpenAI 兼容格式已经是事实
 * 标准：Moonshot / DeepSeek / OpenAI / Ollama 都吃同一套 body，换 provider
 * 只改 `LLM_BASE_URL` 与 `LLM_MODEL` 两行环境变量。
 *
 * ## 配置
 *
 * 读 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT_MS`（可选）。
 * 由 node 原生的 `--env-file-if-exists=.env` 注入（package.json 的 summary 脚本
 * 已带），本文件不读 .env、不装 dotenv。缺变量时由 `readConfig` 抛可读的错误，
 * **不是**让请求带着 undefined 的 Authorization 头出去拿一个 401。
 *
 * ## 密钥不出现在任何输出里
 *
 * ⚠️ 错误路径只抛状态码与 provider 返回的 message，**不打 request body /
 * request headers**。日志会被贴进 issue、被 CI 收集进 artifact，一旦带上
 * Authorization 就是明文泄露。整个仓库唯一读 key 的地方只有 `authHeaders`。
 */
import process from 'node:process'

/** 429 / 5xx 才值得重试：4xx 是请求本身不对，重试一万次也是同样结果 */
function isRetryable(status) {
	return status === 429 || status >= 500
}

const RETRYABLE = new Set([408, 409, 425])

function shouldRetry(status) {
	return isRetryable(status) || RETRYABLE.has(status)
}

/**
 * 从 provider 的错误体里掏出可读消息。
 *
 * 只在**响应体是 JSON 且形状认识**时才解析，否则退回状态码——
 * 网关返回的 HTML 错误页不该变成几百字符的噪音。
 */
function readErrorMessage(bodyText) {
	try {
		const parsed = JSON.parse(bodyText)
		return parsed?.error?.message ?? parsed?.message ?? null
	}
	catch {
		return null
	}
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 从 env 读配置。三个必填项缺任何一个都在这里报清楚，而不是发一个注定失败的请求。
 *
 * @returns {{ baseUrl: string, apiKey: string, model: string, timeoutMs: number }} 归一后的配置；缺必填项时抛错
 */
export function readConfig(env = process.env) {
	const missing = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'].filter(k => !env[k])
	if (missing.length) {
		throw new Error(
			`缺少模型配置：${missing.join('、')}。`
			+ '\n复制 .env.example 为 .env 并填入；或不用 --write，只跑预览。',
		)
	}
	const timeout = Number(env.LLM_TIMEOUT_MS)
	return {
		baseUrl: String(env.LLM_BASE_URL).replace(/\/+$/, ''),
		apiKey: env.LLM_API_KEY,
		model: env.LLM_MODEL,
		// Number('') 是 0、Number('abc') 是 NaN，两者都会让 AbortSignal 立刻触发
		timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 60000,
	}
}

function authHeaders(apiKey) {
	return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
}

/**
 * 调一次 chat/completions，返回原始响应对象（形状解析在 summary-core 里）。
 *
 * 对 429 / 5xx / 网络错误退避重试 3 次（指数退避 + 抖动，避免并发请求同步撞上限流）。
 *
 * @param {{ system: string, user: string }} messages
 * @param {ReturnType<typeof readConfig>} config
 * @param {{ retries?: number }} [opts]
 * @returns {Promise<unknown>} API 响应 JSON
 */
export async function complete({ system, user }, config, opts = {}) {
	const retries = opts.retries ?? 3
	const url = `${config.baseUrl}/chat/completions`
	const body = JSON.stringify({
		model: config.model,
		messages: [
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		],
		response_format: { type: 'json_object' },
		temperature: 0.3,
	})

	let lastError
	for (let attempt = 0; attempt <= retries; attempt++) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), config.timeoutMs)
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: authHeaders(config.apiKey),
				body,
				signal: controller.signal,
			})
			const text = await res.text()

			if (res.ok) {
				try {
					return JSON.parse(text)
				}
				catch {
					throw new Error(`HTTP ${res.status}：响应不是合法 JSON（${text.slice(0, 200)}）`)
				}
			}

			const detail = readErrorMessage(text)
			const err = new Error(
				`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
			)
			err.status = res.status
			if (!shouldRetry(res.status) || attempt === retries)
				throw err
			lastError = err
		}
		catch (err) {
			// 已耗尽重试或不可重试的状态码：直接上抛
			if (err.status !== undefined && !shouldRetry(err.status))
				throw err
			if (attempt === retries)
				throw err
			lastError = err
		}
		finally {
			clearTimeout(timer)
		}

		const backoff = 1000 * 2 ** attempt + Math.floor(Math.random() * 500)
		await sleep(backoff)
	}

	throw lastError ?? new Error('请求失败且没有留下错误信息')
}
