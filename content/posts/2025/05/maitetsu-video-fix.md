---
title: 《爱上火车》在 Linux 下的视频播放修复
date: 2025-05-19 18:30:00
description: 本文介绍了《爱上火车》Linux Proton 环境视频播放修复方案，记录从黑屏卡死到正常播放的排查过程，分享用 Protontricks 补 DirectShow+WMP9 的完整命令与 Flatseal 权限配置，提供 Arch/Flatpak 双安装路径与镜像加速技巧，一站式解决 Steam 中文版动画无法播放痛点，助力 Linux 玩家零切换畅玩 Galgame。
categories: [旮瘩给木]
tags: [Galgame]
image: https://blog-files.101045700.xyz/MaitetsuVideoFix/Home.webp
recommend: 10
---

::alert
[本文类似版本](https://www.xiaoheihe.cn/app/bbs/link/153105496)个人首发于小黑盒，你在此看到的版本为基于小黑盒发布版本的二次修订版。

本次修订版本发布于个人博客，目前仅在小黑盒和个人博客发布过本文。
::

## 前言

之前文章也提到过，我是一个 Steamdeck Gal 玩家，而且是用 Linux 跑 Galgame 的“勇者”。

既然都用 Linux 跑 Gal 了，那么会遇到各种奇奇怪怪问题都算正常了。

在 Linux 游玩《爱上火车 LastRun!!》时，我就遇到了相关组件缺失问题，使用环境为Proton 9.0，会出现人物线开场动画无法正常播放问题。

![Maitetsu Home](https://blog-files.101045700.xyz/Gal2025Up/Maitetsu/Home.webp)

一开始我尝试使用Proton GE环境再次运行进行尝试，但单纯使用ProtonGE环境后反而问题更加严重，到剧情线开场动画会直接黑屏卡死。

![ProtonDB](https://blog-files.101045700.xyz/MaitetsuVideoFix/ProtonDB.webp)

在四处寻找解决方法时，发现ProtonDB下的一位用户提出了解决方案，使用Protontricks进行补丁修补，经过验证，问题得到了很好的解决。

## 为什么不用 Wine？

这个综合原因是有很多的，但简单来说就是笔者是购买的 Steam 官方中文版，使用 Steam Proton 进行运行游戏，很难切换 Proton 以外的第三方兼容层。

使用第三方版本在 Deck 的 Gamescope 游戏桌面启动和切换也不方便和不美观。

::alert{type="question"}
#title
值得注意！
#default
:tip[笔者使用的 Linux 发行版为 Arch Linux]{tip="似乎很多 Linux Galgame 玩家都使用它（雾）"}，桌面环境为 GNOME，后文教程也主要围绕其进行，对于其他发行版，大部分情况下也就是安装方式和软件包存在差异。
::

## 安装 Protontricks

对于 Steam 官方中文版，我们需要先安装 Protontricks 来实现对其补丁和环境修复。

### Arch Linux 命令安装

对于 Arch Linux 且非 Flathub 用户来说，安装 Protontricks 相当简单，而且不需要额外的权限配置。

:copy{code="sudo pacman -S protontricks"}

### Flathub 安装

对于其他 Linux 发行版，首先你先去安装 Flatpak，然后我们可以通过 Flathub 来安装 Protontricks。

#### 切换国内 Flathub 官方源

我们可以通过以下指令为 Flatpak 切换中国大陆地区的下载源提高下载速度。
##### 上海交通大学

:copy{code="sudo flatpak remote-modify flathub --url=https://mirror.sjtu.edu.cn/flathub"}

##### 中国科学技术大学

:copy{code="sudo flatpak remote-modify flathub --url=https://mirrors.ustc.edu.cn/flathub"}

#### 获取 Protontricks 和 Flatseal

##### 软件中心安装

前往 GNOME 软件中心搜索并获取 Protontricks 和 Flatseal

![](https://blog-files.101045700.xyz/MaitetsuVideoFix/Fl_Protontricks.webp)

##### 命令安装

我们也可以通过以下命令从 Flatpak 安装程序：

:copy{code="flatpak install flathub com.github.Matoking.protontricks"}
:copy{code="flatpak install flathub com.github.tchx84.Flatseal"}

![](https://blog-files.101045700.xyz/MaitetsuVideoFix/Sh_Protontricks.webp)

## 权限配置

我们需要通过 Flatseal 为 Protontricks 配置相关权限保证它能读写文件和正常运行，首先打开 Flatseal 并找到 Protontricks。

![](https://blog-files.101045700.xyz/MaitetsuVideoFix/Flatseal01.webp)

向下翻找到文件系统相关配置，把这四个全部打开（勾选），为程序分配全部文件系统访问权限，然后关闭 Flatseal，此处配置操作结束。

![](https://blog-files.101045700.xyz/MaitetsuVideoFix/Flatseal02.webp)

## 修补组件

接下来打开 Protontricks，会出现一个提示框让我们选择需要打补丁的游戏，我们以爱上火车做例子，在此处选择对应的游戏并且选择 OK

如果报错请先确定你是否已经通过 Proton 启动过一次游戏，不然此处可能会报错找不到游戏相关 Proton 文件。

![](https://blog-files.101045700.xyz/MaitetsuVideoFix/Protontricks-01.webp)

在一番确定（可能有选择默认 Proton 容器）操作后，我们可以来到如下页面。

![](https://blog-files.101045700.xyz/MaitetsuVideoFix/Protontricks-02.webp)

在此处我们选择“安装Windows DLL 或组件”来为游戏安装缺失的相关组件，以爱上火车为例，需要安装 DirectShow 和 WMP9 组件来修补视频播放。

::alert
如果下载组件失败，你可能需要配置海外网络环境。
::

选定完需要修补的组件后，单击“确定“开始修补安装，期间可能会弹窗和出现安装页面，全部遵循其标准顺序确定或安装。

![](https://blog-files.101045700.xyz/MaitetsuVideoFix/Protontricks-03.webp)

## 测试

我们关闭Protontricks然后启动游戏测试效果，测试发现游戏内开场动画已经可以正常得到播放，很显然我们修补成功了！

![](https://blog-files.101045700.xyz/MaitetsuVideoFix/MaitetsuGames.webp)
