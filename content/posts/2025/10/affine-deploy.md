---
title: Affine 部署：自托管类 Notion 知识库系统
date: 2025-10-23 05:00:00
description: 本文介绍了自托管知识库系统 Affine 的部署流程，涵盖其存储、CPU、内存等配置要求，并对比 Outline 指出其文档更清晰。文章采用 Docker Compose 方式部署，提供从安装 Docker、获取配置文件、修改环境变量到启动服务的完整步骤，适合希望搭建私有知识库的用户参考。
categories: [技术探索]
tags: [自托管,知识库]
image: https://affine.pro/overview/Plan.jpg
---

## 前言

之前我曾经有写过 Outline 的部署教程，不过那篇教程已经年久失修到我自己都没法完整复现部署流程了，况且 Outline 官方对于托管的文档也是写的基本让人看不明白。

![](https://affine.pro/overview/Plan.jpg)

是时候该换个现代的知识库程序了，早年我曾了解到 Affine 这个知识库程序，在我还在用 Outline 的时候已经体验过它了，在当时它的自托管体验是很一般的：功能不完整，中文不完善等。

所以在当时我最终还是选定了 Outline 作为团队知识库程序，现在 Outline 不好用了，那么 Affine 支棱起来了吗？好像还真支棱起来了，至少看宣传资料还是不错的样子，我们来实际部署体验一下吧。

## 要求

首先我们先看看 Affine 的配置要求，看看它是比 Outline 要求高了还是低了。

### 存储

> The necessary storage space largely depends on the size of your workspaces and collaborators, blobs you may upload, and number of total docs.
> Basically, The server itself requires nearly 1.5 GB spare space for installation. The performance of your host's fs significantly affect performance of AFFiNE.

以上内容引用自 Affine 官方文档，大概意思是 Affine 的占用空间很大程度上取决于您的工作空间和协作者的规模、您可能上传的 blob 以及总文档数量。Affine本身需要约 1.5G 的存储空间来进行安装和运行。

然后根据 Affine 官方在他们旗舰实例 affine.pro 收集的使用情况整理来看：

- 每 1000 份文档，Postgres 空间增长 100 MB，平均每份文档 1000 字
- 每 10 GB Blob 存储空间按 1k 个 Blob 增长

总体来说还是需要服务器有足够的安装和使用空间的，太小硬盘的服务器长期使用就不是很推荐部署了，可以选择更轻量的知识库系统。

### CPU

>We recommend the CPU of host to have at least 4 cores, for leverage long CPU holding jobs. AFFiNE's response speed depends on the specification of your CPU.

Affine 官方文档给出的建议是 CPU 至少有四个核心，以便利用长时间运行的 CPU 密集型任务。AFFiNE 的响应速度取决于您的 CPU 规格。

不过按照我长期的部署经验来看，2 Core 的 CPU 应该也是可以负担小团队和个人日常使用的，当然 1 Core 确实就太难为它了。

### 内存

> Memory are mostly consumed by Sync system and Doc merging. The larger the largest doc is, the more Memory will be taken to merge it.
   Memory specifications are various depends on the size of your docs and modification times of each docs.

官方文档介绍，使用内存主要被同步系统和文档合并消耗。文档越大，合并它所需的内存就越多。

Affine 在官方旗舰实例 affine.pro 监测的使用情况：

- 合并一个有 10k 次修改的文档会导致内存使用峰值达到 1 GB

所以官方给出的建议是主机至少有 2GB 内存，如果文档总字数超过了 10k，那么建议内存至少在 4GB 以上。

### 总结

相比 Outline 的占用来说（我上次部署在 2c8g 的服务器上），Affine 相比可以说略轻量但也没轻量多少，不过它文档写的明白啊，Outline 文档我现在想部署都不知道该怎么看😢

在接下来的文章中，我们将使用 Docker Compose 方式进行部署 Affine，这是 Affine 推荐的部署方式。

## 部署

### 安装 Docker

那么首先我们安装 Docker，对于 Linux 用户，我们可以使用 Linuxmirrors 提供的更简单的一键安装 Docker 脚本（可自动判断系统和换源，甚至部分国产系统都可以装）。

什么？你是 Windows 或者想用图形化管理 Docker？Docker Desktop 欢迎你。

```bash
bash <(curl -sSL https://linuxmirrors.cn/docker.sh)
```

等待 Docker 安装完成，我们就可以开始下一步了。

### 新建文件夹

依然是熟悉的新建持久化数据文件夹。

```bash
mkdir affine
cd affine
```

### 获取编排和环境变量文件

接下来我们使用以下命令获取部署需要的 Compose 编排文件和 env 环境变量文件，执行以下命令前，请确保你的终端已经在 affine 目录里了。

```bash
wget -O docker-compose.yml https://github.com/toeverything/affine/releases/latest/download/docker-compose.yml
wget -O .env https://github.com/toeverything/affine/releases/latest/download/default.env.example
```

### 修改环境变量文件

::alert{type="warning" card}
#title
注意！
#default
在初始化并开始使用 Affine 后，请不要随便修改环境变量。
::

这里的`env`文件可能不是最新的，请优先以官方`env`文件内容为准，有关设置项我已经加注了中文注释在下文，请自行参照修改哦。

```yaml
# 选择需要部署的 Affine 版本，稳定（stable），测试（beta），金丝雀（canary）
# 可选值：stable, beta, canary
AFFINE_REVISION=stable

# 服务在容器中向服务器暴露的端口，默认 3010
PORT=3010

# 为对外的链接设置服务器的主机地址
# 默认注释，由反向代理管理
# 启用 HTTPS
# AFFINE_SERVER_HTTPS=true
# 服务器域名
# AFFINE_SERVER_HOST=affine.yourdomain.com
# 或者使用完整的外部 URL
# AFFINE_SERVER_EXTERNAL_URL=https://affine.yourdomain.com

# 数据库持久化数据存放路径
DB_DATA_LOCATION=~/.affine/self-host/postgres/pgdata
# 上传的文件（图片、附件等）持久化存放路径
UPLOAD_LOCATION=~/.affine/self-host/storage
# 配置文件持久化存放路径
CONFIG_LOCATION=~/.affine/self-host/config

# 数据库用户名
DB_USERNAME=affine
# 数据库密码（留空表示不设置密码）
DB_PASSWORD=
# 数据库名称
DB_DATABASE=affine
```

### 启动编排服务器

Affine 相对来说还是简单许多的，需要在文件里配置的就刚才上面这些东西，剩下的配置需要我们启动 Affine 后在后台设置中设置。

```bash
docker compose up -d
```

如果一切顺利，我们将能够通过`http://localhost:3010`在浏览器中访问到 Affine。
