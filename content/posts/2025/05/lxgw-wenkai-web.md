---
title: 更换网站字体为霞鹜文楷屏幕阅读版（LXGW WenKai Screen）
date: 2025-05-28 18:24:26
categories: [技术探索]
tags: [Web,Fonts]
description: 本文介绍了如何为网站全局替换开源“霞鹜文楷”字体，记录从选字、CDN引入到CSS调用的完整流程，分享LXGW WenKai Screen版针对屏幕阅读优化的1.7.0样式文件与font-family写法，附赠Zstatic CDN链接与缓存清除技巧，一步到位实现中文楷体美化的同时保障加载速度。
image: https://blog-files.101045700.xyz/Web/WenKai-Demo.webp
---

## 前言

霞鹭文楷一直是我很喜欢的中文开源字体，我在我的电脑上全局都使用了它的屏幕阅读版。

最近打算在博客上也全局使用它，简单记录下我的更换流程。

## 简介

2020 年 12 月，日本著名字体厂商 FONTWORKS 在 GitHub 上发布了 7 款日文字体，分别为 Train、Klee、Stick、Rock-n-Roll、Reggae、Rampart 和 DotGothic16，根据 SIL Open Font License 1.1 授权许可开源。7 款开源日文字体各有各的特点，而这 7 款字体中，字符数量最多的是 Klee。

这是一款有着日本教科书体风格的字体，兼有仿宋和楷体的特点。一些 DIY 字体爱好者曾先后用仿宋等字体补全这款字体，作为手机系统的美化字体移植在 iOS、Android 等手机系统中，受到很多玩机发烧友的欢迎。不过这样补全的字体有一些不足之处。

第一，原有字体和后补字体之间有着一定的差异，致使一些不同的文字（如 Klee 原有汉字与后补简体字）混排之后会有一定的违和感。

第二，由于补字所用的字体为商业版权字体，补全之后不可用于商业用途，还会有侵权的风险。此外，目前现有的开源中文字库里，楷体类寥寥无几，仿宋类则几乎没有。

鉴于此，也为了丰富开源中文字体中的楷体门类，2021 年 1 月 20 日起， LXGW 开始了为 Klee One 这一高质量的日文开源字体补全简繁常用字的尝试。

因该字体具有一定的「文艺气息」，命名 「霞鹜文楷」（其实当初是感觉这款字体适合正文阅读定名「文楷」，后来发现这款字体可能并不太适合大段正文排版，相比之下更加适合诗词之类的中等长度文本排版，或者注释排版）。

由于 Klee One 字体的 Regular 字重太细不太适合阅读，选取原字体 SemiBold 字重作为 Regular 字重。经过长时间的积累，目前已发展成简繁日韩均支持的 3 字重字体家族 （虽然拙劣粗糙了点） 。

## 引入

在网页的`<head>`标签内适当位置引入字体 CSS。

你可以选择屏幕阅读优化版或者其他版本。

::alert
此处使用了[Zstatic CDN](https://www.zstatic.net/)，你可以自由更换为其他`CDNJS`的 CDN，但请注意不要选择被投毒的其他几款 CDN。
::

```javascript
<link rel="stylesheet" href="https://s4.zstatic.net/ajax/libs/lxgw-wenkai-screen-webfont/1.7.0/style.min.css" />
```

```javascript
<link rel="stylesheet" href="https://s4.zstatic.net/ajax/libs/lxgw-wenkai-webfont/1.7.0/style.min.css" />
```

## 使用

在你的站点 CSS 中设置字体。

```css
body {
    /* 原版 */
    font-family: "LXGW WenKai", sans-serif;
    /* 屏幕优化版 */
    font-family: "LXGW WenKai Screen", sans-serif;
}
```

## 预览

对于动态博客：刷新网站并清除浏览器缓存。

对于静态博客：可能需要重启热开发服务器和清除本地缓存文件以及重新构建等。
