---
title: Love Love School Days 在 Linux 下游戏汉化补丁安装使用
subtitle: 莳苗是真可爱啊，这游戏整体恐怖氛围也没有那么重。
date: 2025-12-12 04:00:00
description: 《Love Love School Days》是一款发行于2023年的 Unity 游戏，本文介绍了在 Linux 下安装和使用其汉化补丁的方法。 该补丁基于 BepInEx 和 Reipatcher 制作，适用于使用 Proton 兼容层运行的 Windows 游戏。文章详细说明了通过 Protontricks 配置 DLL 转发以确保补丁正常工作的方法。
categories: [旮瘩给木]
tags: [Games,Linux,Proton]
image: https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1305300/ss_6891b1714e4aa5e290276a8328653611fba47c56.1920x1080.jpg
recommend: 3
---

## 前言

今天新入手了一款 Steam 游戏《Love Love School Days》，这游戏不算新游戏了，发行于 2023 年，之前看鲤鱼等主播玩过，是一款 Unity 游戏，没有官方中文。

![](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1305300/ss_6891b1714e4aa5e290276a8328653611fba47c56.1920x1080.jpg)

那既然咱要玩这个游戏了，我也不打算啃英文，那肯定要去汉化它才能正常玩。

::game-card
---
appid: 1305300
---
::

B 站的一位 UP 主制作了汉化补丁，它是基于 BepInEx 和 Reipatcher 的。

B 站专栏链接：https://www.bilibili.com/opus/760358594853994533

### 个人测试环境
- Fedora Workstation 43，Proton CachyOS Latest（20251115-Fix）
- Bazzite 43，Proton GE Latest（10-26）

下载补丁之后，按照作者文章教程，我覆盖了解压后目录的 BepInEx 文件夹中的所有文件到游戏目录，然后满怀期待的启动游戏，然后游戏还是英文（

于是乎去网上简单查询了下资料，然后看到 BepInEX 官方文档[是这样解释的](https://docs.bepinex.dev/articles/advanced/proton_wine.html)

>If you are playing a Windows game on an Unix system (Linux/Mac/SteamOS/etc.) the game will have to run through a compatibility layer (Proton, or its predecessor Wine) which at the moment will likely prevent BepInEx from starting.
>
>This is because UnityDoorstop relies on dll files inside the game directory being loaded instead of system dlls, but under Proton/Wine this behavior does not happen by default. To make BepInEx work it's necessary to configure this DLL forwarding to work correctly.

### 中文翻译

如果你在 Unix 系统（Linux/Mac/SteamOS 等）上玩 Windows 游戏，游戏将需要通过一个兼容层（Proton 或其前身 Wine）来运行，目前这很可能阻止 BepInEx 启动。

这是因为 UnityDoorstop 依赖于游戏目录中的 dll 文件被加载而不是系统 dll 文件，但在 Proton/Wine 下这种行为默认不会发生。为了让 BepInEx 正常工作，必须配置 DLL 转发以使其正确运行。

## 解决？

解决的办法也很简单，只需要请出我们的老朋友 Protontricks。

::video-embed
---
type: raw
id: https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1305300/extras/9a4ce49e4dc935a0378067ac79c788a5.webm
---
::

在个人文章 [《爱上火车》在 Linux 下的视频播放修复](/2025/05/maitetsu-video-fix) 中已经介绍了如何在 Linux 下安装并启动 Protontricks，此处不再赘述。

::link-banner
---
banner: https://blog-files.101045700.xyz/MaitetsuVideoFix/Home.webp
title: 《爱上火车》在 Linux 下的视频播放修复
link: "/2025/05/maitetsu-video-fix"
---
::

那么首先我们依然打开 Protontricks，然后选择游戏并点击确定（需要启动过一次游戏才能在列表里找到它）。

![](https://imgheybox.max-c.com/web/bbs/2025/12/10/2c14e8599eaad2224500270f4d1fba5e/thumb.png)

然后选择“选择默认的 Wine 容器”，可能接下来会有报错，但只要不直接崩溃就没问题。

![](https://imgheybox.max-c.com/web/bbs/2025/12/10/9d9a8d2eacc2d13f7413c6258fa5c304/thumb.png)

然后我们选择“运行 Wine 配置程序”，然后在新打开的 Wine 配置窗口中选择“函数库”。

![](https://imgheybox.max-c.com/web/bbs/2025/12/10/6a1c2382f5e71bc3bf9e6e87f05d35e9/thumb.png)

然后新增函数库顶替（填入winhttp）并“添加”。

![](https://imgheybox.max-c.com/web/bbs/2025/12/10/e60fd9fab8441a7143aae2bc1c278d1b/thumb.png)

然后单击确定保存退出即可，接下来确保补丁文件已经安装的情况下再次打开游戏应该就是中文了。

![](https://imgheybox.max-c.com/web/bbs/2025/12/10/0525420d3f1716dab43f38af72d172c0/thumb.png)

## 或者？

其实还有个更简单的办法，也可以直接在补丁文件已经安装的前提下直接使用 Steam 启动参数来启动游戏，跟 Protontricks 的修改实际上是一样的。

```yaml
WINEDLLOVERRIDES="winhttp=n,b" %command%
```
