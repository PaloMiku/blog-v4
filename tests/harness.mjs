import { register } from 'node:module'
// `node --test` 的 `--import` 入口：注册 tests/harness-hooks.mjs 里的 resolve hook，
// 并把时区钉在 Asia/Shanghai（与 blogConfig.timeZone 一致，站点内容按此时区编排，
// time.ts 的本地 getter 分支只有在这个时区下才有确定语义）。
// 在测试子进程启动前执行（test runner 会把 execArgv 传给每个文件进程）。
import process from 'node:process'

process.env.TZ = 'Asia/Shanghai'

register(new URL('./harness-hooks.mjs', import.meta.url))
