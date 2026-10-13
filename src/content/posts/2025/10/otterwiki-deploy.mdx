---
title: OtterWiki 部署：基于 Python 的轻量知识库系统
date: 2025-10-24 22:00:00
description: 本文介绍了轻量级知识库系统 OtterWiki 的完整部署流程。系统基于 Python Flask 开发，采用 Markdown 语法，支持 Git 协议管理内容，最低仅需 100MiB 内存。部署步骤包括：使用一键脚本安装 Docker，通过官方仓库安装 Caddy 并配置自动 HTTPS 反向代理，创建专用目录后编写 docker-compose.yml 启动服务，默认监听 8080 端口。首次注册账户将自动获得管理员权限，适合资源有限的个人或小团队快速搭建私有 Wiki。
categories: [技术探索]
tags: [自托管,知识库]
image: https://blog-files.101045700.xyz/2025/10/otterwiki.png
---

## 前言

前两天我简单介绍了下 Affine 知识库系统，然后有人可能就有疑问了，Affine 占用那么高，我只是想部署一个小知识库，也不需要那么多复杂的特性，有没有轻巧一点的系统呢？

还真有，在之前个人写小 Wiki 在线整理时曾经了解并使用过 OtterWiki 这个知识库系统，使用 Flask 框架，基于 Python 编写，使用 Markdown 作为标记语言，总体来说还是比较舒服的，页面设计不算十分前卫但也不算落后。

![](https://blog-files.101045700.xyz/2025/10/otterwiki.png)

且自身还支持 Git Http 服务器，可以通过 Git 协议拉取和管理知识库内容。还是有点意思的。

## 要求

OtterWiki 的 CPU 需求非常低，你甚至可以在树莓派上运行它。所需的 RAM 大约为 100MiB，官方给出的推荐部署方式是使用 Docker 部署。

需要使用专用域名，例如`wiki.example.com`，不能使用子目录`example.com/wiki`，浏览器需要启用 Javascript。

## 安装 Docker

我们使用 Linuxmirrors 提供的 Docker 安装脚本来执行 Docker 的安装，它可以在多种 Linux 系统上安装 Docker。

```bash
bash <(curl -sSL https://linuxmirrors.cn/docker.sh)
```

在遵照脚本步骤完成安装 Docker 后，我们进行下一步操作。

## 反向代理服务

我个人推荐使用 Caddy 作为反向代理服务的选择，它和 OtterWiki 一样占用的性能极低，且可以自动为域名申请 Https 证书。

Caddy 的部署和安装可以参见[官方文档](https://caddyserver.com/docs/install)，我们在这里仅介绍 Debian/Ubuntu 环境下的安装和使用方式。

### 安装 Caddy

使用以下命令在 Debian/Ubuntu 环境下一键安装和启动 Caddy 本身以及需求的组件以及配置 Caddy 官方软件包仓库（稳定版）：

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

执行此安装操作后，Caddy 将自动启动并作为名为 `caddy` 的 systemd 服务运行 Caddy。

### 配置 Caddy 反向代理

我们打开`/etc/caddy/`目录下的`Caddyfile`文件，在最下面首先添加如下配置：

```json
wiki.example.com {
  reverse_proxy 127.0.0.1:8080
  encode zstd gzip
}
```

这代表 Caddy 会反代`wiki.example.com`的请求，并把请求转发到在本地`8080`端口上暴露的服务，我们这篇教程会让 OtterWiki 在 8080 端口上部署，这是官方给出的默认配置端口，如果你想要更换端口，那么在上面的配置文件和后面的配置文件中你都需要更换对应端口。

Caddy 支持通过配置文件启用 Zstandard和 Gzip 压缩功能，这是主流的两种压缩算法。我们只需要把` encode zstd gzip`加入域名配置文件下方即可，后续加入其他配置也是类似这样放置。

同样你也需要更换`wiki.example.com`为你实际想部署的域名，完成配置后，确保域名已经解析到服务器的前提下，使用`systemctl restart caddy`重启 Caddy 服务。

## 安装 OtterWiki

我们先新建放置 OtterWiki 数据的文件夹，然后终端进入其中。

```bash
mkdir otterwiki
cd otterwiki
```

在`otterwiki`目录下新建`docker-compose.yml`文件并填入如下内容

```yaml
services:
  otterwiki:
    image: redimp/otterwiki:2
    restart: unless-stopped
    ports:
      - 127.0.0.1:8080:80
    volumes:
      - ./app-data:/app-data
```

接下来使用以下命令拉取和启动编排镜像文件：

```bash
docker compose up -d
```

如果你的域名解析和 Caddy 配置正确，稍等片刻你就可以在域名上看到 OtterWiki 了。
## 结束

OtterWiki 启动后注册的第一个账户将作为管理员账户，所以部署启动后请尽快先注册账户哦。
