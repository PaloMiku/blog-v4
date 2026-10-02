<script setup lang="ts">
import type { NavItem } from '~/types/nav'
import { watch } from 'vue'
import { useRoute } from 'vue-router'

const appConfig = useAppConfig()
const layoutStore = useLayoutStore()
const searchStore = useSearchStore()

const route = useRoute()
const openMenuKeys = ref<Record<string, boolean>>({})

const itemKey = (groupIndex: number, itemIndex: number) => `g${groupIndex}-i${itemIndex}`

const subnavId = (key: string) => `sidebar-subnav-${key}`

const hasChildren = (item: NavItem) => Boolean(item.children?.length)

/** 叶子项自己也占一行列表，模板才能只保留一份链接标记 */
function linkItems(item: NavItem): NavItem[] {
	return item.children?.length ? item.children : [item]
}

function collectUrls(items: NavItem[]): string[] {
	return items.flatMap((item) => {
		const self = item.url && item.url !== '#' && !isExtLink(item.url) ? [item.url] : []
		return [...self, ...collectUrls(item.children ?? [])]
	})
}

/** 除根路径外的栏目，用于判断当前页面是否属于某个具体栏目 */
const sectionPaths = computed(() =>
	collectUrls(appConfig.nav.flatMap(group => group.items))
		.filter(url => url !== '/'),
)

const inSection = computed(() =>
	sectionPaths.value.some(url => route.path === url || route.path.startsWith(`${url}/`)),
)

function isActive(item: NavItem): boolean {
	if (matchesRoute(item.url))
		return true

	return Boolean(item.children?.some(isActive))
}

function matchesRoute(url: string) {
	if (!url || url === '#' || isExtLink(url))
		return false

	// 根路径会前缀匹配所有路由，指向 `/` 的「文章」只在没有栏目命中时高亮
	if (url === '/')
		return !inSection.value

	return route.path === url || route.path.startsWith(`${url}/`)
}

/** 精确命中当前页才用 page，仅属于某个栏目时用通用的 true */
function currentMark(item: NavItem) {
	if (route.path === item.url)
		return 'page'

	return isActive(item) ? 'true' : undefined
}

function toLink(item: NavItem) {
	return {
		url: item.url,
		icon: item.icon,
		text: item.text,
		active: isActive(item),
		current: currentMark(item),
	}
}

/** 把配置预处理成模板直接可用的行模型，省掉模板里反复计算的 key 与状态 */
const navGroups = computed(() => appConfig.nav.map((group, groupIndex) => ({
	title: group.title,
	rows: group.items.map((item, itemIndex) => {
		const key = itemKey(groupIndex, itemIndex)
		const collapsible = hasChildren(item)

		return {
			key,
			icon: item.icon,
			text: item.text,
			collapsible,
			active: isActive(item),
			// 叶子项的列表恒为展开，只有折叠列表参与动画和 aria-controls
			open: collapsible ? Boolean(openMenuKeys.value[key]) : true,
			listId: collapsible ? subnavId(key) : undefined,
			listClass: collapsible ? 'sidebar-subnav' : 'sidebar-nav-leaf',
			links: linkItems(item).map(toLink),
		}
	}),
})))

function toggleSubMenu(key: string) {
	openMenuKeys.value[key] = !openMenuKeys.value[key]
}

function openActiveMenus() {
	appConfig.nav.forEach((group, groupIndex) => {
		group.items.forEach((item, itemIndex) => {
			if (hasChildren(item) && isActive(item))
				openMenuKeys.value[itemKey(groupIndex, itemIndex)] = true
		})
	})
}

watch(() => route.path, openActiveMenus, { immediate: true })
</script>

<template>
<BlogMask
	:show="layoutStore.state === 'sidebar'"
	class="hide-above-mobile"
	@click="layoutStore.close()"
/>

<!-- 不能用 Transition 实现弹出收起动画，因为半宽屏状态始终显示 -->
<aside id="blog-sidebar" :class="{ show: layoutStore.state === 'sidebar' }">
	<BlogHeader to="/" />

	<nav class="sidebar-nav scrollcheck-y" aria-label="主导航">
		<button
			class="search-btn sidebar-nav-item gradient-card"
			type="button"
			@click="layoutStore.toggle('search')"
		>
			<Icon name="tabler:search" />
			<span class="nav-text">{{ searchStore.label }}</span>
			<Key code="K" cmd prevent @press="layoutStore.toggle('search')" />
		</button>

		<template v-for="(group, groupIndex) in navGroups" :key="groupIndex">
			<h3 v-if="group.title">
				{{ group.title }}
			</h3>

			<menu>
				<li v-for="entry in group.rows" :key="entry.key">
					<button
						v-if="entry.collapsible"
						class="sidebar-nav-item sidebar-nav-item-parent"
						:class="{ open: entry.open, active: entry.active }"
						type="button"
						:aria-expanded="entry.open"
						:aria-controls="entry.listId"
						@click="toggleSubMenu(entry.key)"
					>
						<span class="nav-text-wrap">
							<Icon :name="entry.icon" />
							<span class="nav-text">{{ entry.text }}</span>
						</span>
						<Icon class="nav-toggle-icon" :class="{ open: entry.open }" name="tabler:chevron-down" />
					</button>

					<Transition name="collapse">
						<ul v-show="entry.open" :id="entry.listId" :class="entry.listClass">
							<li v-for="link in entry.links" :key="link.url">
								<UtilLink
									:to="link.url"
									class="sidebar-nav-item"
									:class="{ active: link.active }"
									:aria-current="link.current"
								>
									<Icon :name="link.icon" />
									<span class="nav-text">{{ link.text }}</span>
									<Icon v-if="isExtLink(link.url)" class="external-tip" name="tabler:arrow-up-right" />
								</UtilLink>
							</li>
						</ul>
					</Transition>
				</li>
			</menu>
		</template>
	</nav>

	<footer class="sidebar-footer">
		<BlogThemeToggle />
		<ZIconNavList :list="appConfig.footer.iconNav" />
	</footer>
</aside>
</template>

<style scoped>
#blog-sidebar {
	display: flex;
	flex-direction: column;
	color: var(--c-text-2);

	&:hover {
		color: currentcolor;
	}

	@media (max-width: 768px) {
		position: fixed;
		/* 位移到屏幕外不会退出焦点顺序，收起时必须隐藏，否则 Tab 会进入不可见的导航。 */
		visibility: hidden;
		inset-inline-start: 0;
		width: 320px;
		max-width: 100%;
		background-color: var(--ld-bg-blur);
		backdrop-filter: blur(0.5rem);
		color: currentcolor;
		transform: var(--transform-start-far);
		transition: transform 0.2s, visibility 0.2s;
		z-index: var(--z-index-popover);

		&.show {
			visibility: visible;
			box-shadow: var(--box-shadow-1), var(--box-shadow-3);
			transform: none;
		}
	}
}

.sidebar-nav {
	flex-grow: 1;
	padding: 0 5%;
	font-family: var(--font-basic);
	font-size: 0.9em;

	h3 {
		margin: 2em 0 1em 1em;
		font-family: var(--font-basic);
		font-size: 1em;
		font-weight: 700;
		color: var(--c-text-2);
	}

	li {
		margin: 0.5em 0;
	}
}

.sidebar-nav-item,
.sidebar-nav-item-parent {
	display: flex;
	align-items: center;
	gap: 0.5em;
	padding: 0.5em 1em;
	border: 1px solid transparent;
	border-radius: 0.5em;
	font-family: var(--font-basic);
	transition: all 0.2s;
}

.sidebar-nav-item:not(.search-btn):hover,
.sidebar-nav-item.active,
.sidebar-nav-item-parent.active,
.sidebar-nav-item-parent:hover {
	border-color: var(--c-primary);
	background-color: var(--c-bg-soft);
	color: var(--c-text);
}

.sidebar-nav-item-parent {
	justify-content: space-between;
	width: 100%;
	font-weight: 500;
	text-align: left;
	cursor: pointer;
}

.sidebar-nav-item-parent .nav-text-wrap {
	display: flex;
	flex-grow: 1;
	align-items: center;
	gap: 0.5em;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.sidebar-nav-item-parent .iconify,
.sidebar-nav-item > .iconify {
	font-size: 1.5em;
}

.sidebar-nav-item-parent .nav-text,
.sidebar-nav-item > .nav-text {
	flex-grow: 1;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.sidebar-nav-item-parent .external-tip,
.sidebar-nav-item > .external-tip {
	opacity: 0.5;
	font-size: 1em;
}

.sidebar-nav-item-parent.open {
	background-color: var(--c-bg-soft);
	color: var(--c-text);
}

/* 折叠列表和叶子列表共用同一份链接标记，层级差别只由容器规则给出 */
.sidebar-nav-leaf,
.sidebar-subnav {
	margin: 0;
	padding: 0;
}

.sidebar-subnav {
	margin-block: 0.2em 0;
	margin-inline-start: 1.2rem;
}

.sidebar-subnav li {
	margin: 0.25em 0;
}

/* 子项比顶层项更紧凑；用后代选择器压过 .sidebar-nav-item，不依赖书写顺序 */
.sidebar-subnav .sidebar-nav-item {
	padding-inline-start: 0.5em;
	font-size: 0.9em;
}

.sidebar-subnav .sidebar-nav-item > .iconify {
	font-size: 1.1em;
}

.nav-toggle-icon {
	transition: transform 0.2s;

	&.open {
		transform: scaleY(-1);
	}
}

.search-btn {
	opacity: 0.5;
	width: 100%;
	margin: 1rem 0;
	outline: 2px solid var(--c-border);
	outline-offset: -2px;
	/* button 的 UA 样式是 text-align: center，会被内部文字继承 */
	text-align: start;
	cursor: text;
	user-select: none;

	&:hover,
	&:focus-visible {
		opacity: 1;
		outline-color: transparent;
		background-color: transparent;
	}
}

.sidebar-footer {
	--gap: clamp(0.5rem, 3vh, 1rem);

	display: grid;
	gap: var(--gap);
	position: relative;
	padding: var(--gap);
	font-size: 0.8em;
	text-align: center;
	color: var(--c-text-2);
}

.sidebar-footer > * {
	position: relative;
	z-index: 1;
}
</style>
