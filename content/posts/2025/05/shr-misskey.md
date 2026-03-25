---
title: 我又用了一段时间 Misskey，发现和 Sharkey 存在一些区别和不足
date: 2025-05-22 11:30:00
description: 本文记录了作者重新体验 Misskey 后，相较 Sharkey 感受到的不足：缺少直接编辑、单帖私密化、注册审批；并列出 ListenBrainz 集成、Mastodon API 兼容、UI 风格等差异，倾向继续使用 Sharkey。
categories: [联邦宇宙]
tags: [Fediverse,Misskey,Sharkey]
---

## 前言

最近在 Fediverse 的其他实例（咪社）开了一个自己的“分身”：

账号信息：@NukiMiku@misskey.site

先不解释开这个分身的目的是什么，之前在个人实例一直是使用 Sharkey 作为个人使用程序，借着开分身我也算是重新体验了原汁原味的 Misskey。

不过在使用之后，却发现与 Sharkey 相比存在了一些区别和不足（可能自己被 Sharkey 惯坏了）。

## 不足

我所说的任何不足都没有批判 Misskey 的意思，毕竟 Sharkey 是它的分支版本，做出自己的任何更改 Misskey 都没有义务去遵守合并。

### 缺失直接编辑

我在发帖的时候有时可能比较着急和欠考虑，发出去之后就可能想改一下。

于是我打开 Misskey 的帖子额外菜单寻思再“编辑”一下。

然后我发现只有“删除并编辑”，之前在使用 Sharkey 时是有直接编辑这个选项的。

没有直接编辑功能分别是存在好处和坏处的：

好处：
- 与其他程序（Gotosocial，Mastodon）的兼容效果会更好，这些程序也没有直接意义上的“编辑”选项。
- ~~不会有别人知道你曾经写错了帖子。~~

坏处：
- 对于一些发布时间较久的帖子，你如果发现错误想要修改，你再选择“删除并编辑”就有点突兀了。

总之在这点上个人还是站 Sharkey 这边的，尤其是最近发现自己比较久远帖子有个错误时候（也没有不承认错误“毁尸灭迹”的意思，实际上 Sharkey 会展示这个帖子的历史编辑，当然也可能会略占用更多数据库资源）。

### 缺失单独“私密化”（

如果说上面没有直接编辑还能找理由的话， Misskey 有关这个帖子没有单独的“私密化”设置我就有点想不通了。

::alert{type="question"}
# title
什么是“私密化”？
# default
似乎是在 Misskey 系列中出现的功能，用户可以把“私密化”标签打到帖子上，然后这个帖子就会进入“私密”状态，只有用户自己才能看到这个帖子的内容。

不过实际上可能只有 Misskey 系列程序会遵守“私密化”，聊胜于无吧。
::

在 Misskey 里只能为某个时间段之前的帖子做出“私密化”，也就是“一私私一片”。

而在 Sharkey 里，我们就可以单独为帖子“私密化”，而不是群体私密化。

这点 Misskey 还是不大舒服的其实。

### 缺失注册审批

这点我其实现在也不是很清楚 Misskey 是否已经完善了，总之 Sharkey 还是有的，当多管理员或者审批组时会很有用，即“开放注册”但需要“填写注册理由”然后等待“管理审核”，这样相对来说比直接使用邀请码注册开放，也更安全。

## 差异

差异包含了一些“不那么重要”或者说“低使用率”的需求。

### ListenBrainz 集成

个人不是十分了解这个集成方式，同实例的朋友之前有使用过：

贴文：https://circle.tkg3.top/notes/a60lb602rznr000m

### 兼容 Mastodon API

Sharkey 在他们文档里有表示他们兼容 Mastodon 的 API，直观点理解就是可以使用 Mastodon 的客户端程序登陆和管理你的 Sharkey。

这点个人其实用不大上，为了去验证也拿 Mastodon 的客户端试了下，确实可以登录并且发帖等。

当然其实还是用处不大，毕竟 Misskey 的特色功能全都无法正常使用，MfM 语法也无法正常显示，插入表情可能也会出现差异问题。

### “像猫一样说话”与“是猫”分开

其实就是可以设定获得猫耳但不学猫说话（）

但是 Misskey 确实只能同时获得。

### UI 风格变化

Sharkey 的风格明显方正，而 Misskey 则是圆润。

这点影响也不大，但个人应该更喜欢 Sharkey 的风格（在 Sharkey 设置中可以随时切回 Misskey 风格）。

简单放个对比图（上为 Sharkey，下为 Misskey）

![Sharkey Use](https://blog-files.101045700.xyz/Fediverse/SharkeyUse.webp)

![Misskey Use](https://blog-files.101045700.xyz/Fediverse/MisskeyUse.webp)

## 其他小细节差异

- Sharkey 的发帖时的所有输入框高度大小均可调（包括注解等在内），Misskey 只有部分输入框可调高度（不足）
- 可以导入你从 Mastodon 导出的帖子，也包括 Pleroma / Akkoma和 Misskey / Firefish 及其分支、Twitter、Instagram、Facebook，包括附件。
- 可以自定义前端使用字体。

## 后言

也有参考 Sharkey 官方列举差异文档：https://docs.joinsharkey.org/docs/comparison/misskey

目前个人可能还是更为喜欢 Sharkey 的设计，本文将持续更新 Sharkey 和 Misskey 个人使用对比供犹豫使用什么程序的站长和用户参考！
