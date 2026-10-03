/**
 * MDX 内容组件映射表。
 *
 * 为什么需要它：转换后的 `.mdx` 文件里使用未 import 的组件名（如 `<Alert />`），
 * Astro 的 `<Content components={...} />` 会在渲染时注入。
 * 这样 63 个 MDX 文件无需各自写 import，组件表在此集中维护。
 * 已实测该机制可用（见 `src/spike-content/probe.mdx`）。
 *
 * ⚠️ 尚未移植的组件不会出现在此表中。MDX 引用到未注册的组件名时
 * **构建会直接报错**（而不是静默渲染成空白），这正是我们想要的失败方式。
 */
import Alert from '../components/content/Alert.astro'
import Badge from '../components/content/Badge.astro'
import Blur from '../components/content/Blur.astro'
import CardList from '../components/content/CardList.astro'
import Chat from '../components/content/Chat.astro'
import Copy from '../components/content/Copy.astro'
import EmojiClock from '../components/content/EmojiClock.astro'
import Folding from '../components/content/Folding.astro'
import InfoCard from '../components/content/InfoCard.astro'
import Key from '../components/content/Key.astro'
import LinkBanner from '../components/content/LinkBanner.astro'
import LinkCard from '../components/content/LinkCard.astro'
import Mermaid from '../components/content/Mermaid.astro'
import Music from '../components/content/Music.astro'
import MusicScore from '../components/content/MusicScore.astro'
import Pic from '../components/content/Pic.astro'
import Poetry from '../components/content/Poetry.astro'
import ProjectGroup from '../components/content/ProjectGroup.astro'
import Quote from '../components/content/Quote.astro'
import ResourceList from '../components/content/ResourceList.astro'
import SeriesGroup from '../components/content/SeriesGroup.astro'
import Tab from '../components/content/Tab.astro'
import Timeline from '../components/content/Timeline.astro'
import Tip from '../components/content/Tip.astro'
import VideoEmbed from '../components/content/VideoEmbed.astro'
/*
 * BlogHeader 现在**只有这一份**，即 `components/blog/BlogHeader.astro`。
 * index / link / BlogSidebar / MDX 的 `::blog-header` 都指向它。
 *
 * 仓库里曾并存第二份同名同职责的 `components/BlogHeader.astro`：它从未渲染出
 * 任何元素（产物里所有 `.blog-header` 的 cid 都是**调用方**的），但样式仍随
 * import 打进产物，留下一条永不匹配的 scoped 死规则。已删除。
 */
import BlogHeader from '../components/blog/BlogHeader.astro'

/** 按 MD 中的指令出现次数降序，便于判断移植优先级 */
export const contentComponents = {
	Alert,
	Folding,
	Tab,
	Pic,
	LinkCard,
	LinkBanner,
	Key,
	Copy,
	VideoEmbed,
	CardList,
	Quote,
	Music,
	ProjectGroup,
	Badge,
	Blur,
	InfoCard,
	Poetry,
	Chat,
	ResourceList,
	Timeline,
	Tip,
	EmojiClock,
	MusicScore,
	SeriesGroup,
	Mermaid,
	BlogHeader,
}
