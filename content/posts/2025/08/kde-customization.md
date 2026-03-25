---
title: 我的 KDE Plasma 6 美化方案分享
subtitle: 其实并不是很难的吧😆
date: 2025-08-28 05:30:00
updated: 2025-11-04T18:30:00
description: 本文分享了作者将主力系统换至Fedora 43 KDE后的桌面美化方案：采用上下双面板布局，上方空面板配应用启动器、全局菜单等，下方图标任务管理器作Dock；引入Panel-colorizer插件，为上下面板分别设置ChromeOS透明与Translucent预设；主题选Fedora全局主题+Moe配色+Colloid图标，时钟用Redmi Clock插件，全套均可在KDE商店获取。
categories: [技术探索]
tags: [KDE,Linux]
image: https://blog-files.101045700.xyz/2025/08/kde-customization/preview.webp
recommend: 10
---

## 前言

个人把主力 Linux 系统从 CachyOS（Arch Linux）更换到了 Fedora 43（KDE Plasma Desktop Edition）。

对桌面也重新做了整理和美化，个人还是很喜欢 KDE Plasma 的，使用 Linux 也已有一年有余，今天分享下我目前使用的桌面美化方案。

::alert
本文内容已于 2025.11.04 更新，删减壁纸和部分内容，新增 Panel-colorizer 插件效果。
::

一个好的美化方案不仅可以让自己赏心悦目，也可以通过组件位置合理放置提升个人的工作效率，本文使用到的插件和配色方案等均可在 KDE 商店下载到。

::pic
---
src: https://blog-files.101045700.xyz/2025/08/kde-customization/preview.webp
caption: 桌面效果图
---
::

## 方案

### 上下布局

上方使用空面板，从左到右组件分别为“应用程序启动器”，“窗口列表”、“全局菜单”、“面板间隙”、“数字时钟”、“面板间隙”、“系统托盘”。

下方放置应用程序菜单栏，使用“图标任务管理器”实现类似 Dock 栏的效果。

### Panel-colorizer

在 2025 年 10 月系统升级 Fedora 43 后发现了 Panel-colorizer 这个插件，可以对 KDE 面板进行颜色和透明度的更多自定义设置。

桌面的上下面板均使用了本插件，设置了不同的透明度和颜色。

Github 地址：https://github.com/luisbocanegra/plasma-panel-colorizer

KDE 商店链接：https://store.kde.org/p/2130967

若是从 KDE 商店安装本插件，需要先检查系统是否已安装相关依赖包，可在项目 Github README 中查看不同系统需求的依赖包安装方式。

在面板激活本插件十分简单，安装后添加在需要使用的面板添加 Panel Colorizer 挂件，然后进入挂件配置即可对目前附加的面板进行修改。

这里只是提供了个人的一种选择思路，你可以根据插件设置自定义属于自己的更强大的主题配色方案。

#### 上面板

配置透明效果的步骤其实很简单。

首先使用插件内置的 ChromeOS 预设，然后打开外观设置，翻到侧边外观选项卡，下翻找到“Color”然后禁用它的颜色即可（如下图）。

::pic
---
src: https://blog-files.101045700.xyz/2025/08/kde-customization/config.webp
caption: Panel-colorizer 上面板配置
---
::

#### 下面板

下面板的配置就更简单了，直接使用插件内置的 Translucent 预设即可。

### 主题方案

前往 系统设置 > 全局主题 设置

|类型|名称|
|---|---|
|全局主题|Fedora|
|颜色|Moe|
|应用程序外观样式|Breeze 微风|
|Plasma 外观样式|Moe|
|窗口装饰元素|Breeze 微风|
|图标|Colloid|
|光标|Hoshino Swimsuit|
|欢迎屏幕|Lagtrain|

### 桌面时钟

使用 Redmi Clock 插件

插件 KDE 商店链接：https://store.kde.org/p/2175475
