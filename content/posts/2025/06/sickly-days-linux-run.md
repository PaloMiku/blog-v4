---
title: 《痴情哥哥与病弱妹妹的乡间生活》 Steam 版在 Linux/Deck 下的运行问题修复
date: 2025-06-22 05:30:00
description: |
  文章记录了《痴情哥哥与病弱妹妹的乡间生活》Steam版在Linux/SteamDeck因Krkr2引擎兼容失败而无法启动的问题。
  修复步骤：1.用Protontricks安装WMP9/11；2.把d2d1.dll补丁放进游戏根目录；3.在Steam启动项加WINEDLLOVERRIDES="d2d1.dll=n,b" %command%。完成后游戏可正常运行。
categories: [旮瘩给木]
tags: [Galgame]
image: https://static.hikarifield.co.jp/images/shop/sickly_days/thumb/012.jpg
recommend: 9
---

::alert
本文是为解决游戏的 Steam 版运行问题特化写的文章，如果你是其他版本或其他方式运行可以参照[本文参考的原 Wiki 资料](https://www.vnwiki.xyz/visual-novels/sickly-sister.html)去解决。
::

## 前言

最近《痴情哥哥与病弱妹妹的乡间生活》在 HIKARIFIELD 的推动下在 Steam 正式发售了，说实话还是有些意外的。

我个人 :tip[也算妹抱社和其前身 Lose 的半个粉丝]{tip="喜欢他们作品但还不够了解他们，正所谓“半个粉丝”"}了，在之前听说此游戏的相关消息和发售信息后，还是比较喜欢和期待的，但当时获取 DLSite 版本后发现在 Linux 上无法正常游玩，当时个人也不想为此大动干戈使用 Windows ，所以最后干脆就没玩。

最近看到 Steam 版正式上线了，从 HIKARIFIELD 官网购入了双平台版本支持一下，也觉得都上 Steam 了，应该对 Steamdeck 等 Linux 在内应该有改变和优化了...吧？然后事实证明还是我天真了，打开之后成功赏给了我跟 DLSite 版差不多的报错。

实话说已经有些心冷了，甚至打算打开 Windows 玩了，然后我想起了 ProtonDB，都上 Steam 了，可能会有大佬在上面分享下自己的运行方式解决？上次爱上火车的视频播放问题我也是从这得到的解决办法，一翻果然是有的，虽然不是上面用户原创的但是上 Steam 版的好处就在这：有更多关注度和交流平台了。

## 解决

### 原因和思路

大致来说还是出在 Wine 系列对 Krkr2 引擎游戏的兼容问题上，作为 Wine 的衍生品，这个问题 Proton 也同样不例外甚至更严重。

不过之前的事情教给我的经验是：优先用 Wine 跑 Krkr2 引擎的游戏。

但按照玩家报告来看，直接使用 Wine 也会崩溃或者无法很好的运行游戏。

![](https://blog-files.101045700.xyz/2025/06/sickly-days-linux-run/G-Error.webp)

所以有大佬为解决 Wine 下的 Krkr2 的引擎问题而制作了补丁，打上补丁再配上运行配置，基本就可以正常打开了，但事实是后面可能还会遇到报错问题（Proton 环境下），例如上图。

::alert
此处存在争议，也有说法是使用 WMP9 （Windows Media Player 9），都可以正常运行游戏，但版本不同貌似会影响游戏内视频播放，我个人是选择 WMP9。
::

目前可参考的解决办法是安装 Protontricks 后修补 WMP11 （Windows Media Player 11） 后即可。

有关 Protontricks 和 WMP9 的安装可参考个人之前文章“《爱上火车》在 Linux 下的视频播放修复”进行安装。

Protontricks 快速修补执行命令参考：

```bash
# 使用 wmp11
protontricks 3682050 wmp11
# 使用 wmp9
protontricks 3682050 wmp9
```

::link-banner
---
banner: https://blog-files.101045700.xyz/MaitetsuVideoFix/Home.webp
title: 《爱上火车》在 Linux 下的视频播放修复
description: 本文介绍了《爱上火车》系列在 Linux Proton 环境下播放游戏内视频的修复
link: "/2025/05/maitetsu-video-fix"
---
::

### 下载补丁和安装

我们来说说这件事和之前《爱上火车》事件的不同之处吧——那个神秘的 Krkr2 修复补丁。

当然游戏本身的额外内容是肯定要下载安装的，但这并不是本文讨论的那个补丁。

我们[通过此处](https://www.vnwiki.xyz/dlls/d2d1.dll)下载补丁的最新版本。

把补丁`d2d1.dll`放在游戏根目录里，然后在 Steam 中为其添加启动项 `WINEDLLOVERRIDES="d2d1.dll=n,b" %command%`

确保 WMP 已经得到修补后，我们即可启动游戏，可以看到游戏可以正常运行了。

![](https://blog-files.101045700.xyz/2025/06/sickly-days-linux-run/Game-Main.webp)

## 后记

还是要非常感谢大佬们的交流和不放弃，我们才能在 Linux 上正常玩到我们想玩的 Galgame，当然个人执着于此可能跟个人电脑是 Linux 以及平常使用 Steamdeck 玩 Galgame 吧。

## 参考资料

- [Visual Novel Wiki](https://www.vnwiki.xyz/visual-novels/sickly-sister.html)
