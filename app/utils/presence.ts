export interface AppIdConfig {
	name: string
	icon?: string
}

export type AppIdEntry = string | AppIdConfig

export const appIdNameMapByCategory: Record<string, Record<string, AppIdEntry>> = {
	dev: {
		'code': 'Visual Studio Code',
		'Code': 'Visual Studio Code',
		'code-url-handler': 'Visual Studio Code - URL Handler',
		'micro': 'Micro',
		'org.gnome.Meld': 'Meld',
		'org.kde.kate': 'Kate 编辑器',
		'kate': 'Kate 编辑器',
		'org.kde.kwrite': 'KWrite 记事本',
		'kwrite': 'KWrite 记事本',
		'vim': 'Vim',
	},
	games: {
		'Reload': '女神异闻录３ Reload',
		'steam': 'Steam',
		'the-honkers-railway-launcher': '崩坏：星穹铁道（启动器）',
		'xmcl': 'XMCL Minecraft 启动器',
	},
	media: {
		'com.example.piliplus': 'PiliPlus',
		'echomusic': 'EchoMusic',
		'mpv': 'mpv 媒体播放器',
	},
	network: {
		'firefox': { name: ' Mozilla Firefox', icon: 'logos:firefox' },
		'clash-verge': {
			name: 'Clash Verge',
			icon: 'arcticons:clash',
		},
	},
	office: {
		obsidian: { name: 'Obsidian', icon: 'logos:obsidian-icon' },
		wpsoffice: { name: 'WPS Office', icon: 'arcticons:wpsoffice' },
	},
	social: {
		'Element': 'Element',
		'QQ': 'QQ',
		'io.element.Element': 'Element',
		'qq': 'QQ',
	},
	system: {
		'CherryStudio': 'Cherry Studio',
		'MotrixNext': 'MotrixNext',
		'btop': 'btop++',
		'cachyos-hello': 'CachyOS Hello',
		'cachyos-pi': 'CachyOS Package Installer',
		'cherry-studio': 'Cherry Studio',
		'cherrystudio-url-handler': 'Cherry Studio',
		'dolphin': 'Dolphin 文件管理器',
		'kbd-layout-viewer5': '键盘布局测试器',
		'kcm_fcitx5': '输入法',
		'kcm_trash': '回收站',
		'kcm_webshortcuts': '网页搜索关键词',
		'motrix-next': 'MotrixNext',
		'nautilus-autorun-software': '运行软件',
		'org.cachyos.KernelManager': 'CachyOS Kernel Manager',
		'org.cachyos.hello': 'CachyOS Hello',
		'org.cachyos.scx-manager': 'SchedExt GUI Manager',
		'org.gnome.ColorProfileViewer': '配置查看器',
		'org.gnome.Extensions': '扩展',
		'org.gnome.Nautilus': '文件',
		'org.gnome.OnlineAccounts.OAuth2': 'GNOME OAuth2 Handler',
		'org.gnome.Ptyxis': 'Ptyxis',
		'org.gnome.Settings': '设置',
		'org.gnome.Shell.Extensions': '扩展',
		'org.gnome.Tecla': 'Tecla',
		'org.gnome.Zenity': 'Zenity',
		'org.gnupg.pinentry-qt': 'Pinentry',
		'org.gnupg.pinentry-qt5': 'Pinentry',
		'org.kde.dolphin': 'Dolphin 文件管理器',
		'org.kde.kiod6': 'KIO',
		'org.kde.knewstuff-dialog6': 'KNewStuff 对话框',
		'org.kde.ksecretd': 'KDE 密码库服务',
		'shelly': 'Shelly',
		'thunar': 'Thunar 文件管理器',
		'thunar-bulk-rename': '批量重命名',
		'thunar-settings': 'Thunar 首选项',
		'winetricks': 'Winetricks',
		'zen': 'Zen Browser',
	},
	settings: {
	},
}

export interface AppIdConfig {
	name: string
	icon?: string
}

export const appIdConfigByCategory: Record<string, Record<string, AppIdConfig>> = Object.fromEntries(
	Object.entries(appIdNameMapByCategory).map(([category, mapping]) => [
		category,
		Object.fromEntries(
			Object.entries(mapping).map(([appId, entry]) => {
				if (typeof entry === 'string')
					return [appId, { name: entry }]
				return [appId, entry]
			}),
		) as Record<string, AppIdConfig>,
	]),
)

export const appIdConfig: Record<string, AppIdConfig> = (() => {
	const result: Record<string, AppIdConfig> = {}
	const categories = [
		appIdConfigByCategory.dev,
		appIdConfigByCategory.games,
		appIdConfigByCategory.media,
		appIdConfigByCategory.network,
		appIdConfigByCategory.office,
		appIdConfigByCategory.social,
		appIdConfigByCategory.system,
		appIdConfigByCategory.settings,
	]

	for (const category of categories) {
		if (!category)
			continue

		for (const [appId, config] of Object.entries(category)) {
			if (!result[appId])
				result[appId] = config
			else if (!result[appId].icon && config.icon)
				result[appId] = config
		}
	}

	return result
})()

export const appIdNameMap: Record<string, string> = Object.fromEntries(
	Object.entries(appIdConfig).map(([appId, config]) => [appId, config.name]),
)
