// `getDomainIcon` 可以直接转出：`lib/shared/icon.ts`（迁入自 Nuxt 根
// `shared/utils/icon.ts`）已显式 import 同目录 `./link` 的 `getDomain` 与
// `getMainDomain`，不再依赖 Nuxt 的自动导入。
// 此前这里曾复刻一份 `mainDomainIcons` 常量（模块私有，无法从根项目复用），
// 该复刻已随根项目修复一并删除。
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
