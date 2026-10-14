// `getDomainIcon` 可以直接转出：`lib/shared/icon.ts`（迁入自 Nuxt 根
// `shared/utils/icon.ts`）已显式 import 同目录 `./link` 的 `getDomain` 与
// `getMainDomain`，不再依赖 Nuxt 的自动导入。
// 此前这里曾复刻一份 `mainDomainIcons` 常量（模块私有，无法从根项目复用），
// 该复刻已随根项目修复一并删除。
import blogConfig from '../config/blog'
import { configureTime } from './shared/time'

// 时区/语言的站点绑定：time.ts 本身是零配置纯模块（默认值与站点配置一致），
// 在这里把真实配置灌进去，消费方无感。侧作用只在构建期执行（本 barrel 不进浏览器）。
configureTime({ timeZone: blogConfig.timeZone, language: blogConfig.language })

export {
	ciIcons,
	domainIcons,
	getArchIcon,
	getDomainIcon,
	getFileIcon,
	getLangIcon,
} from './shared/icon'

export {
	currentPageHref,
	getDomain,
	getDomainType,
	getGithubUsername,
	getMainDomain,
	isExtLink,
	normalizeContentPath,
	safelyDecodeUriComponent,
} from './shared/link'

export {
	formatBytes,
	formatNumber,
	getPromptLanguage,
	highlightHtml,
	joinWith,
	removeHtmlTags,
} from './shared/str'

export {
	dateTimeFormat,
	isSameUnit,
	isTimeDiffSignificant,
	timeElapse,
	toInstantString,
	toZdtLocaleString,
	toZonedTemporal,
} from './shared/time'
