---
title: Decky Loader——Linux下 Steamdeck 和大屏幕模式的最佳伴侣
date: 2025-06-08 05:30:00
description: 本文介绍了 Decky Loader 在 Linux/SteamDeck 下的两种快速安装法：官方一键脚本（含中文版）与 OhMyDeck 手动方案，并给出启用开发者模式、CEF 调试、设密码、开终端等关键步骤，手柄玩家即刻升级大屏体验。
categories: [技术探索]
tags: [Deckyloader,Steamdeck]
image: https://imgheybox1.max-c.com/web/bbs/2025/06/07/ce8c92b3c8eb1c750f02a1ef2aaa418e.png
---

::alert
::alert
[本文类似版本](https://www.xiaoheihe.cn/app/bbs/link/156323352)个人首发于小黑盒，你在此看到的版本为基于小黑盒发布版本的二次修订版。

本次修订版本发布于个人博客，目前仅在小黑盒和个人博客发布过本文。
::

## 前言

自 Steamdeck 发售以来，得益于 Valve 对软硬件的开放态度以及社区持续不断的热情，deck 的「折腾」氛围一直很浓厚，甚至这种行为的本身有时都成了一种乐趣。

作为随 Steamdeck 一同出现的“插件商店”， Decky Loader 无疑也为这种行为带来了很大的便利，它用最简单的“插件”为用户实现了很多小功能，美化，强化和拓展 Steam 本身。

不过实际上它的出现并不只造福了 Steamdeck 玩家，实际上也顺带造福了 Linux Steam 玩家（或者说 SteamOS 的出现就很好的推进了 Linux Steam 玩游戏的重大发展），毕竟 deck 的“主角”——SteamOS 3.0 的本身是基于 Arch Linux 开发的，而它的游戏桌面本质还是在 Steam 的大屏幕模式上使用 Gamescope 拓展而来的。

而碰巧，我就是一个“全沾”玩家，手里有 Steamdeck LCD，电脑也在用 Arch Linux 并且也用 Linux 下的 Steam 玩游戏。

我除了部分 FPS 游戏以外，大多数情况下都会使用手柄游玩游戏，可以说我就是这玩意的“最佳目标用户”而 Steam 的大屏幕模式也是对此”锦上添花“，所以哪怕没有 Steamdeck，如果你是一个 PC Linux Steam 手柄玩家（都是比较常见的属性，但合在一起就不常见了），那么配上 Decky Loader 来游玩大屏幕模式，绝对是你最正确的选择！

## 条件

你应当具备以下条件：

::card-list
- 首先得是 Linux 用户，这也包括了 Steamdeck 或其他 Win 掌机可用的 SteamOS 和 Bazzite，CachyOS Handheld 等 Linux 掌机系统。
- 最好是手柄用户，而且喜欢用 Steam 大屏幕模式，没有手柄的 Steam 大屏幕模式其实也不咋好用。
- 有基本的英语知识，毕竟仍有不少插件是英文界面。如果你没有足够的英文知识，那么配上翻译软件进行翻译阅读就需要你有基本的阅读理解和整合思维了。
- 有着比较良好的网络环境，下载文件需要连接 Github 等。
::

## 安装

Decky Loader 发展到现在，已经有了很多的安装方式可选。

### 官方脚本

::card-list
- 优点：
  - 官方提供的安装方式，维护和更新等问题解决最快。
  - 图形安装引导页面和后期维护工具附带。
  - 对于基础较差的 Linux 用户最为简单的安装方式
  - 支持平台多，非 Steamdeck 定制版 Steam 也能顺利安装。
- 缺点：
  - 相关文件需要从 Github 获取，需要有良好的网络环境。
::

#### 使用

需要在终端执行命令，如果找不到终端，KDE Plasma（SteamOS 默认桌面）用户可以参考下文终端部分。

在终端执行以下命令使用英文版安装脚本：

```bash
sh -c 'rm -f /tmp/user_install_script.sh; if curl -S -s -L -O --output-dir /tmp/ --connect-timeout 60 h
ttps://github.com/SteamDeckHomebrew/decky-installer/releases/latest/download/user_install_script.sh; then
bash /tmp/user_install_script.sh; else echo "Something went wrong, please report this if it is a bug"; r
ead; fi'
```
个人也简单汉化了一个中文版安装脚本，可以通过在终端执行以下命令来使用：

```bash
sh -c 'rm -f /tmp/user_install_script.sh; if curl -S -s -L -O --output-dir /tmp/ --connect-timeout 60 h
ttps://raw.githubusercontent.com/PaloMiku/Scripts/refs/heads/main/DeckyLoader/install_zh_CN.sh; then bash
/tmp/install_zh_CN.sh; else echo "下载安装脚本失败，请检查您的网络环境！"; read; fi'
```

![](https://imgheybox.max-c.com/web/bbs/2025/06/07/9b599276c487b459f141d6b4b3c33af1.png?imageMogr2/format/webp/quality/50/auto-orient/ignore-error/1)

使用脚本安装 Decky Loader 非常简单，遵循脚本操作步骤安装即可。

### 手动使用 OhMyDeck 脚本安装

部分图片和内容来自 Steamdeck 中文网，本方式更适合 Steamdeck 配合 SteamOS 安装。

操作步骤相比官方脚本更为繁琐。

#### 启用开发者模式

**按STEAM键 – 设置 – 系统 – 启用开发者模式**

![](https://imgheybox.max-c.com/web/bbs/2025/06/07/ea394e16f536e0c257592ce474db8804.png?imageMogr2/format/webp/quality/50/auto-orient/ignore-error/1)

#### 启用 CEF 远程调试

**按STEAM键 – 设置 – 开发者 – 启用CEF远程调试**

![](https://imgheybox.max-c.com/web/bbs/2025/06/07/31318051c5bfc57f62c96ca3886e2b08.png?imageMogr2/format/webp/quality/50/auto-orient/ignore-error/1)

#### 切换到桌面模式

在游戏模式，**按下STEAM键 – 电源 – 切换到桌面模式**

![](https://imgheybox.max-c.com/web/bbs/2025/06/07/42ffc3f837c4b2c9ca3f46e7f4e5b631.png?imageMogr2/format/webp/quality/50/auto-orient/ignore-error/1)

#### 打开应用程序启动器

一般位于桌面左下角，单击打开它。

![](https://imgheybox.max-c.com/web/bbs/2025/06/07/c32dd1c914646525220dc57ba93f9573.png?imageMogr2/format/webp/quality/50/auto-orient/ignore-error/1)

#### 设置管理员密码

已经设置过密码的可以跳过这一步。

![](https://imgheybox.max-c.com/web/bbs/2025/06/07/b5e549926d2895e4bfaed959380dc83e.png?imageMogr2/format/webp/quality/50/auto-orient/ignore-error/1)

点击开始菜单左上角用户头像打开系统设置页面（如果忘记了密码，需要制作系统引导盘来重置密码）

![](https://imgheybox.max-c.com/web/bbs/2025/06/07/d199c971268909c67b3d346c6d4fe267.png?imageMogr2/format/webp/quality/50/auto-orient/ignore-error/1)

点击 “修改密码” 以设置管理员密码。

#### 打开终端

![](https://imgheybox.max-c.com/web/bbs/2025/06/07/85d4a824c4b065d5155ec8caa1c25797.png?imageMogr2/format/webp/quality/50/auto-orient/ignore-error/1)

回到应用程序启动器，选择“所有应用程序”

![](https://imgheybox.max-c.com/web/bbs/2025/06/07/122987e981607f15dd8176817e333ef1.png?imageMogr2/format/webp/quality/50/auto-orient/ignore-error/1)

下滑找到 Konsole 终端并打开。

#### 禁用系统只读（SteamOS）

**仅限 SteamOS，在终端粘贴并执行以下命令以解除系统分区只读**

```bash
sudo steamos-readonly disable
```

#### 执行安装

**粘贴并执行以下命令（Steamdeck 按手柄 A 代替 Enter 执行）**

```bash
curl -L http://dl.ohmydeck.net | sh
```

**国内部分地区（如福建地区）会屏蔽安装链接，可以使用下面的命令安装**

```bash
curl -L https://www.mhhf.com/Deck/install.sh | sh
```

之后会弹出密码输入提示，这里输入刚才设置的管理员密码（Steamdeck 使用 :key[STEAM+X]{code="steam+x"} 键打开虚拟键盘，输入密码时为盲输，不会有任何显示），输入完毕后按虚拟键盘上的回车开始安装，安装速度视网络情况。

安装完成后进入游戏模式，按 Steamdeck 右边的三个点按钮就可以看见插件商店了。

## 后言

通过以上两种步骤，我们就可以在 Steamdeck 或者其他 Linux 系统下正确安装 Decky Loader 啦！

## 参考资料

- [Decky Loader：让你的 Steam Deck 更好用](https://sspai.com/post/85809)
- [SteamDeck 插件商店安装教程（必装）](https://deck.mhhf.com/?p=1290)
