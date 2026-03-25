---
title: Misskey/Sharkey 工具栏：强大且精心的小功能
date: 2025-05-20 11:30:00
description: 本文分享了 Misskey/Sharkey 侧边栏小工具的完整功能清单，涵盖便签、RSS、时钟、活动、服务器指标、AiScript 控制台等 30+ 组件，可自由拖拽、调高度、设透明，即刻把桌面版 Fediverse 变成你的个性化信息仪表盘。
categories: [联邦宇宙]
tags: [Fediverse,Misskey]
image: https://blog-files.101045700.xyz/Fediverse/2025/Circlari-Set.webp
---
## 前言

Misskey是一个十分强大的 Fediverse 程序，今天我们来讲解一下里面特有的一个 :tip[侧边栏小工具功能]{tip="提起来我博客也有 Sidebar Tools（雾）"}，它还是十分的强大且易用的。

::alert{type="warning"}
# title
注意！
# default
本文基于 Sharkey 2025.4.2-rc-stelpolva 进行组件和功能示例讲解，可能不适用于所有 Misskey/Sharkey 版本。
::

## 组件

默认情况下，小工具位于 PC/Pad 模式 :tip[右侧侧边栏]{tip="Deck模式下需要手动调出“小工具”页面"}部分。

### 个人资料（profile）
#### 简介
非常简单的展示个人资料的组件，分别展示了头像，昵称，个人资料横幅，实例用户地址信息。
#### 示例
![profile](https://blog-files.101045700.xyz/Fediverse/Sidebar/profile.webp)
#### 设置
此组件无额外设置。

### 服务器信息（instanceInfo）
#### 简介
整体样式与个人资料一致，展示了服务器（实例）LOGO，名称，资料横幅背景，实例地址。
#### 示例
![instanceInfo](https://blog-files.101045700.xyz/Fediverse/Sidebar/instanceInfo.webp)
#### 设置
此组件无额外设置。

### 便签（memo）
#### 简介
一个可以随时记录的便签小组件，自动保存，用来做备忘不错。
#### 示例
![memo](https://blog-files.101045700.xyz/Fediverse/Sidebar/memo.webp)
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。
##### height
通用数值设置，控制组件在小工具栏的展示高度，默认值为 100。

### 通知（notifications）
#### 简介
展示收到的通知，与“通知”页面展示内容一致。
#### 示例
![notifications](https://blog-files.101045700.xyz/Fediverse/Sidebar/notifications.webp)
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。
##### height
通用数值设置，控制组件在小工具栏的展示高度，默认值为 300。

### 时间线（timeline）
#### 简介
展示实例时间线，与“时间线”功能一致，有“首页”，“本地”、“社交”、“全局”页面。
#### 示例
![timeline](https://blog-files.101045700.xyz/Fediverse/Sidebar/timeline.webp)
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。
##### height
通用数值设置，控制组件在小工具栏的展示高度，默认值为 300。

### 日历（calendar）
#### 简介
通过进度条形式展示年月日进度，左侧为大标题醒目显示日历信息。
#### 示例
![calendar](https://blog-files.101045700.xyz/Fediverse/Sidebar/calendar.webp)
#### 设置
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为关闭（不透明）。

### RSS 阅读器（rss）
#### 简介
采集指定地址的 RSS 信息并以列表展示。
#### 示例
此处使用个人博客（5月20日）RSS 信息作为示例展示。
![rss](https://blog-files.101045700.xyz/Fediverse/Sidebar/rss.webp)
#### 设置
##### url
控制组件采集的 RSS 地址，如本博客的 /atom.xml 。
##### refreshIntervalSec
（应当）是控制组件采集信息的间隔时间，单位为 Sec（秒），默认值为 60。
##### maxEntries
控制组件采集的 RSS 信息条目数，默认值为 15（条）。
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。

### RSS Tricker（rssTicker）
#### 简介
与 RSS 阅读器组件一样都是采集制定 RSS 信息后展示，但展示方式为滚动横条。
#### 示例
![rssTicker](https://blog-files.101045700.xyz/Fediverse/Sidebar/rssTicker.webp)
#### 设置
##### url
控制组件采集的 RSS 地址。
##### shuffle
开关控件，控制组件滚动展示的信息（是否）随机排序，默认为开启（随机排序）。
##### refreshIntervalSec
（应当）是控制组件采集信息的间隔时间，单位为 Sec（秒），默认值为 60。
##### maxEntries
控制组件采集的 RSS 信息条目数，默认值为 15（条）。
##### duration
控制组件信息滚动速度，数值越大则滚动越慢，反之则越快，默认值为 70。
##### reverse
开关控件，控制组件滚动信息滚动方向，默认为从右向左滚动（关闭），开启则反之。
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为关闭（不展示）。
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为关闭（不透明）。

### 趋势（hashtags）
#### 介绍
展示（本地/远程）服务器上标签引用趋势。
#### 示例
![hashtags](https://blog-files.101045700.xyz/Fediverse/Sidebar/hashtags.webp)
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。

### 时钟（clock）
#### 介绍
以“模拟时钟”形式向用户展示用户设备时间。
#### 示例
![clock](https://blog-files.101045700.xyz/Fediverse/Sidebar/clock.webp)
#### 设置
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为关闭（不透明）。
##### size
控制模拟时钟展示大小，有大，中，小三个选项，默认为：中。
##### thickness
控制模拟时钟指针粗细，有 thin, medium, thick 三个选项，默认为“medium”。
##### graduations
控制模拟时钟对时间数字的展示形式，有 None（无）, Dots（点）, Numbers（数字），默认为 Numbers（数字）。
##### fadeGraduations
开关控件，（测试推测）控制模拟时钟遮罩阴影动态显示，开启时，目前时间无关的时间数值不会显示，默认为开启。
##### sAnimation
控制秒针动画效果，有 None（无，不显示秒针），Elastic（一弹一弹的），Ease out（平滑，石英钟？），默认为Elastic（一弹一弹的）。
##### twentyFour
开关控件，控制模拟时钟展示 :tip[12/24 小时制]{tip="真有 24 小时制的表嘛？是我孤陋寡闻了。"}效果，默认为关闭（12 小时制）
##### label
控制模拟时钟是否展示数字时钟和用户设备时区，有 None（不展示），Time（仅展示数字时钟），TZ（仅展示时区），Time + TZ（数字时钟和时区都展示），默认为 None（不展示）
##### timezone
控制时钟时区，列表选择个人时区，默认为 auto（ :tip[自动检测时区]{tip="应该是跟随用户浏览器设备时区吧"}）

### 活动（activity）
#### 介绍
（大概）是展示用户活动（发帖，表情回应等）活动信息。
#### 示例
![activity](https://blog-files.101045700.xyz/Fediverse/Sidebar/activity.webp)
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为关闭（不透明）。

### 照片（photos)
#### 介绍
展示用户云盘内上传（或者）用户帖子使用图片？
#### 示例
出于个人隐私需求此处无示例，组件展示效果为缩略图展示图片。
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为关闭（不透明）。

### 数字时钟（digitalClock）
#### 介绍
以“数字时钟”形式向展示用户设备时间。
#### 示例
![digitalClock](https://blog-files.101045700.xyz/Fediverse/Sidebar/digitalClock.webp)
#### 设置
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为关闭（不透明）。
##### fontSize
控制数字时钟显示字体大小，默认值为 1.5。
##### showMs
开关控件，控制是否展示 Ms（毫秒），默认为开（展示）
##### showLabel
开关控件，控制是否展示用户设备时区，默认为开（展示）
##### timezone
控制时钟时区，列表选择个人时区，默认为 auto（ :tip[自动检测时区]{tip="应该是跟随用户浏览器设备时区吧"}）

### UNIX时钟
#### 介绍
:tip[以 Unix 时间戳格式展示 UTC 时间]{tip="感觉实用性几乎接近0"}
#### 示例
![unixClock](https://blog-files.101045700.xyz/Fediverse/Sidebar/unixClock.webp)
#### 设置
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为关闭（不透明）。
##### fontSize
控制数字时钟显示字体大小，默认值为 1.5。
##### showMs
开关控件，控制是否展示 Ms（毫秒），默认为开（展示）
##### showLabel
开关控件，控制是否展示用户设备时区，默认为开（展示）
##### timezone
控制时钟时区，列表选择个人时区，默认为 auto（ :tip[自动检测时区]{tip="应该是跟随用户浏览器设备时区吧"}）

### 投稿窗口（postForm）
#### 介绍
字面意思，就是“撰写帖子”的投稿窗口。
#### 示例
![postForm](https://blog-files.101045700.xyz/Fediverse/Sidebar/postForm.webp)
#### 设置
此组件无额外设置。

### 幻灯片展示（slideshow）
#### 介绍
幻灯片展示，暂时还没搞明白展示哪的幻灯片？
#### 设置
##### height
通用数值设置，控制组件在小工具栏的展示高度，默认值为 300。

### 服务器指标（serverMetric）
#### 介绍
（需要服务器支持）展示服务器 CPU 和 Mem（内存）占用指标信息。
#### 示例
![serverMetric](https://blog-files.101045700.xyz/Fediverse/Sidebar/serverMetric.webp)
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为关闭（不透明）。

### 在线用户（onlineUsers）
#### 介绍
（大概）展示实例本地当前在线用户
#### 示例
![onlineUsers](https://blog-files.101045700.xyz/Fediverse/Sidebar/onlineUsers.webp)
#### 设置
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为开启（透明）。

### 作业队列（jobQueue）
#### 介绍
展示实例当前作业队列（工作队列信息）
#### 示例
![jobQueue](https://blog-files.101045700.xyz/Fediverse/Sidebar/jobQueue.webp)
#### 设置
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为开启（透明）。
##### sound
开关控件，（应该）队列新工作提示音效开关，默认为关（无音效）

### 按钮（button）
#### 介绍
展示一个可编程，可编辑信息的按钮
#### 示例
![button](https://blog-files.101045700.xyz/Fediverse/Sidebar/button.webp)
#### 设置
##### label
设置按钮展示文字，默认为 BUTTON（按钮）
##### colored
开关控件，设置按钮是否渲染颜色，默认为开（跟随主题颜色）
##### script
可编程语法，默认为：
```
Mk:dialog("hello" "world")
```
### AiScript 控制台（aiscript）
#### 介绍
展示一个 AiScript 控制台
#### 示例
![aiscript](https://blog-files.101045700.xyz/Fediverse/Sidebar/aiscript.webp)
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。

### AiScript APP（aiscriptApp）
#### 介绍
展示 AiScript APP 页面
#### 设置
##### script
可编程语法，默认为空。
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。

### 小蓝（ai）
#### 介绍
展示小蓝的Live2D形象（可爱捏）
#### 示例
![ai](https://blog-files.101045700.xyz/Fediverse/Sidebar/ai.webp)
#### 设置
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为关闭（不透明）。

### 用户列表（userList）
#### 介绍
展示用户指定的用户列表，单击上方“选择列表”以选定用户指定的用户列表（需要先自己配置过）
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。

### 点击器
#### 介绍
~~就是隐藏的Misskey Cookies 小游戏~~
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为关闭（不展示）。

### 搜索（search）
#### 介绍
展示一个搜索框,实际调用的还是“搜索”页面。
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为关闭（不展示）。

### 今天是他们的生日（ :tip[今天是他们的生日]{tip="设置里写的英文函数区就是中文（雾）"} ）
#### 介绍
:tip[展示本地实例今天是哪个用户的生日]{tip="对于小实例和个人实例实用性基本接近 0"}
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。

### 聊天(chat)
#### 介绍
聊天是 Misskey 2025.04 后新增的功能，此处也是调用的“聊天”页面。
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。

### 联合(federation)
#### 介绍
展示与本地实例联合的服务器信息。
#### 设置
##### showHeader
通用开关控件，控制组件是否在小工具栏展示组件标题，默认为开启（展示）。

### 服务器云（instanceCloud）
#### 介绍
花里胡哨的展示与本地实例联合的服务器信息。
#### 设置
##### transparent
通用开关控件，控制组件背景是否为全透明，默认为关闭（不透明）。
