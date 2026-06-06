---
title: 用 Codex 写了一个 Noctalia 插件 Process Reporter
subtitle: 扩展了插件开发知识树，也和 Agent 做好了配合
description: 本文作者分享了将主力机系统环境从 Fedora+KDE 更换为 Arch+Niri+Noctalia 后的使用体验，重点围绕借助 AI 完成 Noctalia 自定义插件开发的实践展开。作者为验证 GPT 5.3-Codex 的 Agent 能力，落地了一款窗口与媒体状态上报插件，该插件托管于其个人 GitHub 仓库，可通过 Noctalia 插件商店添加自定义源完成安装与更新。插件核心功能为实时抓取用户当前聚焦的窗口信息、监听系统媒体播放状态，将数据按规范格式封装后，经 token 鉴权与限流处理上报至云函数，最终实现博客端个人在线状态的实时展示。作者表示自身并不熟悉 QT（QML）开发，依托 AI 辅助顺利完成了功能完整的插件开发，此次实践拓展了个人技术能力，同时提及了开发所用的 Qt 跨平台应用框架与 Rust 系统编程语言，后续还计划尝试更多类型的 Noctalia 插件开发。
date: 2026-04-01 14:00:00
image:  https://fastly.jsdelivr.net/gh/PaloMiku/PaloMiku-Noctalia-Plugin@master/process-reporter/screenshot.png
categories: [技术探索]
tags: [Linux, Noctalia, Niri]
---

## 前言

最近主力机从 Fedora+KDE 换到了 Arch+Niri+Noctalia，还是相当好用的，尤其是 Noctalia 的插件系统，功能强大又易用，社区里也有很多现成的插件可以直接使用。

然后最近想试试下新玩具 GPT 5.3-Codex 的 Agent 能力怎么样，于是灵机一动拿它开发一个之前的想法：博客云函数个人状态（视奸）上报插件试试，结果还是挺让人惊喜的。

## 插件功能

插件位于我个人的插件库 https://github.com/PaloMiku/noctalia-plugins 内，可以在 Noctalia 插件商店里添加自定义插件源来安装和更新。

插件功能就是实时获取当前用户正在聚焦的窗口信息，并监听媒体播放状态后合并上报到同一个云函数。

### 上报格式示例

```json
{
  "timestamp": 1775024322885,
  "event": "panel-preview",
  "window": {
    "windowId": "16",
    "appId": "code",
    "appName": "Code"
  },
  "media": {
    "playerIdentity": "EchoMusic",
    "trackTitle": "Mass Destruction -P3fes Reload-",
    "trackArtist": "Lotus Juice, 高橋あず美, アトラスサウンドチーム",
    "trackAlbum": "ペルソナ3 リロード: Episode Aegis オリジナル・サウンドトラック",
    "trackArtUrl": "http://imge.kugou.com/stdmusic/400/20251023/20251023044541872517.jpg",
    "isPlaying": true
  }
}
```

有 token 鉴权和限流防止滥用上传，然后云函数就能处理再呈现在博客上了。

你在本博客的组件栏看到的我的在线状态就是通过它实现的，当然也有对应的云函数实现，不过搞的挺粗糙就是了，后续有机会再优化一下。

## 后记

::project-group
---
title: "框架"
items:
  - title: "QT"
    description: "Cross-platform Application Framework"
    icon: "devicon:qt"
    link: "https://www.qt.io/"
  - title: "Rust"
    description: "Systems Programming Language"
    icon: "devicon:rust"
    link: "https://www.rust-lang.org/"
---
::

现在的 AI 真的很强大了，稍微配合文档就能让我这个不怎么懂 QT（QML）的开发者也能写出功能完整的插件来，感觉这次旅程扩展了我的知识树，也和 Agent 做好了配合，后续有机会还想试试其他类型的插件开发。
