export {
	getDomain,
	getMainDomain,
	getDomainType,
	getGithubUsername,
	isExtLink,
	safelyDecodeUriComponent,
	normalizeContentPath,
	currentPageHref,
} from './shared/link'

export {
	formatNumber,
	formatBytes,
	getPromptLanguage,
	joinWith,
	highlightHtml,
	removeHtmlTags,
} from './shared/str'

// `getDomainIcon` 可以直接转出：`lib/shared/icon.ts`（迁入自 Nuxt 根
// `shared/utils/icon.ts`）已显式 import 同目录 `./link` 的 `getDomain` 与
// `getMainDomain`，不再依赖 Nuxt 的自动导入。
// 此前这里曾复刻一份 `mainDomainIcons` 常量（模块私有，无法从根项目复用），
// 该复刻已随根项目修复一并删除。
export {
	getArchIcon,
	ciIcons,
	domainIcons,
	getDomainIcon,
	getFileIcon,
	getLangIcon,
} from './shared/icon'

export {
	isSameUnit,
	isTimeDiffSignificant,
	timeElapse,
	toInstantString,
	toZonedTemporal,
	dateTimeFormat,
	toZdtLocaleString,
} from './shared/time'
