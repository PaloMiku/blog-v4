---
title: Waline-Mini 部署体验：基于 Rust 的 Waline 评论系统？
date: 2025-10-25 03:00:00
description: 本文介绍了作者因 GitHub 上的 waline-mini 项目而产生的惊喜与实测过程。作为一款使用 Rust 重写的 Waline 评论系统，waline-mini 据称内存占用仅为 Node.js 原版的 1/25（约 5.5MB）。文章记录了作者通过 Zeabur 平台使用 Docker 快速部署的体验：配置简洁、支持 SQLite、默认监听 8360 端口，首个注册账户即成为管理员。实测后台 UI 与原版高度一致，平均内存仅 3.48 MB，验证了 Rust 带来的极致轻量，适合对资源占用敏感的站点。
categories: [技术探索]
tags: [自托管,评论系统]
---

## 前言

最近逛 Github 也是看到个离谱的东西：waline-mini，上面描述是使用 Rust 实现的高性能 Waline 评论系统，作者是[jQiue](https://github.com/JQiue)。

Github 开源地址：https://github.com/JQiue/waline-mini

说实话给我看懵了，Waline 我是认识的，也是很早期开始发展的 Node.js 评论系统了，在早期因为我的一些个人原因我的大部分站点最终选定的是 Twikoo 作为评论系统。

不过 Waline 确实是一个还不错的评论系统，本身也能在各路云函数上运行，配置要求已经可以说是很低了，但是我是真没想到如今还有大佬写出了 Rust 实现的版本。

文档介绍其内存占用只有 Node.js 版本 Waline 内存占用的 1/25（5612kb=5.48mb 内存占用），我只能说不愧是 Rust。

## 部署

我们选择一种更快速，更经济的尝试来部署下 Waline-mini，今天我们使用 Zeabur 来进行尝试，看看部署后 Zeabur 给出的消耗预算是多少，本质其实还是使用 Docker 来部署。

项目给出的 Docker Compose 文件如下，不一定是最新的，建议查看官方文档。

```yaml
services:
  waline:
    image: jqiue/waline-mini:latest
    container_name: waline-mini
    ports:
      - '8360:8360'
    volumes:
      - waline-db:/app/db
    environment:
      - DATABASE_URL=${DATABASE_URL:-sqlite:////app/db/waline.sqlite?mode=rwc}
      - JWT_TOKEN=${JWT_TOKEN}
      - SITE_NAME=${SITE_NAME}
      - SITE_URL=${SITE_URL}
    restart: unless-stopped

volumes:
  waline-db:
    driver: local
```

前往 Zeabur，创建项目，选择使用“Docker 容器镜像”部署，本文主要是部署体验文，不详细撰述该如何部署，且目前项目仍是开发状态，未来部署方式也可能会有变化。

![](https://blog-files.101045700.xyz/2025/10/r-waline/zeabur-docker.webp)

部署后我们可以通过`waline.example.com/ui`访问后台并注册账号，第一个注册的用户即为 Waline 管理员

![](https://blog-files.101045700.xyz/2025/10/r-waline/waline-ui.webp)

可以看到 Waline 还原完整度确实很高了，后台基本 100% 还原。

还有你们最关心的资源占用图，可以看到平均内存使用量为 3.48MB，确实很低了。
![](https://blog-files.101045700.xyz/2025/10/r-waline/zeabur-used.webp)
