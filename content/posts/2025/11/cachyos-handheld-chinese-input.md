---
title: 在 CachyOS Handheld 下恢复 Steam Input 中文输入
subtitle: Arch 是最好用的 Linux 发行版？
date: 2025-11-24 01:00:00
description: 本文介绍了在 CachyOS Handheld 系统上恢复 Steam Input 中文输入的解决方案。主要步骤包括安装 `ibus`、`ibus-pinyin` 和 `ibus-anthy` 输入法组件，修改 `/usr/share/gamescope-session-plus/gamescope-session-plus` 配置文件，并降级 `libxkbcommon` 组件至 1.11.0 版本以解决中文输入显示为数字的问题。
categories: [技术探索]
tags: [Linux]
image: https://cachyos.org/_astro/handheld.DYNjpH4Q_Z2fmd8a.webp
---

## 前言

我个人目前在 Steamdeck LCD 上使用的系统并非 SteamOS，而是 CachyOS Handheld，它也是基于 Archlinux 发行的版本，支持 SteamOS 的大部分组件，但是相比 SteamOS 它更为自由一些，软件也是跟随 arch 滚动最新的。

它不限制系统分区只读，可以自由使用 pacman 和 aur 安装想要的程序。

不过它毕竟是“仿照” SteamOS 实现的，并且要追求最新组件，所以有些老顽固功能比如 X11 是用 Wayland 替代的，部分应用也不附带，所以经典困扰 Linux 用户的输入法问题又出现了。

## 安装组件

::alert
只恢复了游戏桌面下的游戏内 Steam Input 输入，且需要强制降级部分组件，请注意！
::

安装`ibus`和`ibus-pinyin`以及`ibus-anthy`

```bash
paru -S ibus ibus-pinyin ibus-anthy
```

## 修改文件

打开`/usr/share/gamescope-session-plus/gamescope-session-plus`，找到以下行并修改：

```shell
# Input method support if present
if command -v /usr/bin/ibus-daemon >/dev/null; then
	/usr/bin/ibus-daemon -d -r --panel=disable --emoji-extension=disable # [!code --]
	/usr/bin/ibus-daemon -d -r --panel=/usr/lib/kimpanel-ibus-panel --emoji-extension=disable # [!code ++]
fi
```

重启设备，进入游戏桌面后添加中文键盘即可。

## 输入数字？

如果你不降级`libxkbcommon`组件，会出现中文输入候选输入后为数字的情况，我们可以使用`downgrade`组件来帮助我们快速便捷的降级。

```shell
# 安装 downgrade 组件
paru -S downgrade
# 降级 libxkbcommon 组件
sudo downgrade libxkbcommon
```

稍等片刻，就会出现组件版本列表，我们选择`libxkbcommon`的`1.11.0`版本，安装完成后还会提示你是否需要把包加入到`IgnorePkg`（后续升级也忽略），我们选择`y`

等待降级完成后重启设备，再次尝试应该就是中文了。
