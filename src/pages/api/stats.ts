import type { APIRoute } from 'astro'
import { getStats } from '../../lib/stats'

/**
 * `/api/stats` 预渲染端点（供站外消费）。
 *
 * 计算逻辑已抽到 `src/lib/stats.ts`，与 `BlogStats` 组件的 `stats` prop 共用，
 * 避免两份实现漂移。输出结构与此前逐字节一致，勿改字段名与序列化方式。
 */
export const prerender = true

export const GET: APIRoute = async () => {
	const stats = await getStats()

	return new Response(JSON.stringify(stats, null, 2), {
		headers: { 'Content-Type': 'application/json' },
	})
}
