export interface AppIdConfig {
	name: string
	icon?: string
}

export type AppIdEntry = string | AppIdConfig

export const appIdNameMapByCategory: Record<string, Record<string, AppIdEntry>> = {
	dev: {
		'code': { name: 'Visual Studio Code', icon: 'vscode-icons:file-type-vscode' },
		'micro': { name: 'Micro', icon: 'logos:micro-icon' },
		'org.gnome.Meld': { name: 'Meld', icon: 'logos:gnome-icon' },
		'org.kde.kate': { name: 'Kate 编辑器', icon: 'logos:kate' },
		'kate': { name: 'Kate 编辑器', icon: 'logos:kate' },
		'org.kde.kwrite': { name: 'KWrite 记事本', icon: 'logos:kwrite' },
		'kwrite': { name: 'KWrite 记事本', icon: 'logos:kwrite' },
		'vim': { name: 'Vim', icon: 'logos:vim' },
	},
	games: {
		'Reload': { name: '女神异闻录３ Reload', icon: 'https://p3re.jp/resources/img/favicon.ico' },
		'steam': { name: 'Steam', icon: 'logos:steam' },
		'the-honkers-railway-launcher': { name: '崩坏：星穹铁道（启动器）', icon: 'logos:HonkersRailway' },
		'xmcl': { name: 'XMCL Minecraft 启动器', icon: 'logos:xmcl' },
	},
	media: {
		'com.example.piliplus': { name: 'PiliPlus', icon: 'arcticons:bilibili' },
		'echomusic': { name: 'Echo KuwoMusic', icon: 'token-branded:music' },
		'mpv': { name: 'mpv 媒体播放器', icon: 'logos:mpv' },
	},
	network: {
		'firefox': { name: ' Mozilla Firefox', icon: 'logos:firefox' },
		'clash-verge': {
			name: 'Clash Verge Rev',
			icon: 'arcticons:clash',
		},
	},
	office: {
		obsidian: { name: 'Obsidian', icon: 'logos:obsidian-icon' },
		wpsoffice: { name: 'WPS Office', icon: 'arcticons:wpsoffice' },
	},
	social: {
		Element: { name: ' Matrix Element', icon: 'ph:matrix-logo-bold' },
		QQ: { name: 'Linux QQ', icon: 'cib:tencent-qq' },
	},
	system: {
		'CherryStudio': { name: 'Cherry Studio', icon: 'fluent-emoji:cherry-blossom' },
		'MotrixNext': { name: 'MotrixNext' },
		'btop': { name: 'btop++' },
		'cachyos-hello': { name: 'CachyOS Hello' },
		'cachyos-pi': { name: 'CachyOS Package Installer' },
		'cherry-studio': { name: 'Cherry Studio' },
		'cherrystudio-url-handler': { name: 'Cherry Studio' },
		'dolphin': { name: 'Dolphin 文件管理器' },
		'motrix-next': { name: 'MotrixNext' },
		'nautilus-autorun-software': { name: '运行软件' },
		'org.cachyos.KernelManager': { name: 'CachyOS Kernel Manager' },
		'org.cachyos.hello': { name: 'CachyOS Hello' },
		'org.cachyos.scx-manager': { name: 'SchedExt GUI Manager' },
		'org.gnome.ColorProfileViewer': { name: '配置查看器' },
		'org.gnome.Extensions': { name: '扩展' },
		'org.gnome.Nautilus': { name: '文件' },
		'org.gnome.OnlineAccounts.OAuth2': { name: 'GNOME OAuth2 Handler' },
		'org.gnome.Ptyxis': { name: 'Ptyxis' },
		'org.gnome.Settings': { name: '设置' },
		'org.gnome.Shell.Extensions': { name: '扩展' },
		'org.gnome.Tecla': { name: 'Tecla' },
		'org.gnome.Zenity': { name: 'Zenity' },
		'org.gnupg.pinentry-qt': { name: 'Pinentry' },
		'org.gnupg.pinentry-qt5': { name: 'Pinentry' },
		'org.kde.dolphin': { name: 'Dolphin 文件管理器' },
		'org.kde.kiod6': { name: 'KIO' },
		'org.kde.knewstuff-dialog6': { name: 'KNewStuff 对话框' },
		'org.kde.ksecretd': { name: 'KDE 密码库服务' },
		'shelly': { name: 'Shelly' },
		'thunar': { name: 'Thunar 文件管理器' },
		'winetricks': { name: 'Winetricks' },
		'zen': { name: 'Zen Browser' },
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
