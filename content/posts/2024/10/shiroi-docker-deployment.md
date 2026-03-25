---
title: GitHub Action 构建 Shiroi Docker 镜像
description: 本文介绍了如何利用 GitHub Actions 为 Mix-Space 的闭源前端 Shiroi 构建 Docker 镜像并推送至 GitHub Packages，解决低配服务器本地构建内存不足的问题。本文记录了完整 Workflow 配置，包括定时触发、哈希去重、登录 ghcr.io、构建与推送 latest 镜像等关键步骤，并说明在 1Panel 或命令行拉取私有镜像的方法。本文分享了避免在服务器安装 Node、PM2 等依赖、无需暴露 SSH 密钥即可实现安全拉取与更新的实践经验，适合希望将 Shiroi 容器化部署到个人服务器的用户。
date: 2024-10-21 19:24:26
updated: 2025-06-02T22:00:00
categories: [技术探索]
tags: [Mix-Space,Docker]
image: https://mx-space.js.org/assets/images/preview/shiro.png
recommend: 4
---

## 前言

Mix-Space 是一个前后端分离的博客系统，你可以将前端和后端分别部署在不同的位置。此前，你可以将前端部署在 Vercel 云函数上，以缓解服务器压力并提升访问速度。

但随着 Vercel 调整 Hobby 免费套餐的额度，免费额度已越来越不够用。此时，我们可以通过 Docker 将 Shiro 部署到自己的服务器上来解决问题。然而，在使用 Shiroi（Shiro 的闭源捐赠版）时，原作者 innei 并未提供可用的 Docker 镜像。

这意味着你需要在自己的服务器上构建 Shiroi，但对于配置较低（低于 2G 内存）的云服务器来说，这很困难，基本会导致服务器爆内存假死。

Innei 给出的解决方案是使用 Github Action 完成构建，并将构建产物直接推送到你的服务器上，从而减轻服务器压力。

不过，这个方案在我看来有以下局限性：

::card-list
- 需要在服务器安装相关依赖：Node.js、PM2、Sharp，但部分用户（比如我）使用的是 1Panel 管理服务器，不希望安装额外依赖
- 输出目录被固定在服务器的 `root` 目录，不易更改
- 需要在 Github 仓库存储服务器登录信息，如 SSH 密钥等
- 项目本身有回滚功能，但一般用户可能不需要，也会占用大量服务器空间
::

总之，我并不想折腾这套方案。那么，有没有更好的办法？

欸，你说 Docker 部署不就行了？虽然 Innei 没给 Docker 镜像，但我们可以自己造！

## 思路

我们当然不能直接在自己的服务器上构建镜像，构建 Docker 镜像的资源占用并不会比直接构建站点静态文件少。

那我们可以借鉴 innei 的思路，用 Github Action 进行 Docker 镜像构建，不就可以了吗？

但仅仅构建还不够，还需要有地方存放镜像。我也不想用直接推送到服务器的办法，这同样需要在 Github 存储服务器登录信息。虽然用 `secret` 存储理论上安全，但谁能保证呢？

而且部分用户的服务器在国内，Github Action 主动推送的速度也未必理想。

## 选择

最终，我选择用 Github Action 构建镜像，然后上传到 Github Packages。Github Packages 默认会对私有库镜像进行私有保护，保障镜像不会泄露。

Docker 对镜像仓库的管理分为 3 个层级：命名空间（namespace）、镜像仓库（repository）、标签（tag）：

- 命名空间以名称为标识，一个命名空间可管理多个镜像仓库
- 镜像仓库通过名称标识，一个仓库可保存一个镜像的多个版本
- 镜像版本通过标签区分

基于以上层级关系，一个完整的镜像路径 `{namespace}/{repository}:{tag}` 可以唯一确定一个镜像。

新建一个私有库，并在 `.github/workflows` 目录下新建 yml 工作流文件，填入如下内容：

::alert{type="warning"}
# title
请注意新建的仓库权限，一定要为私有仓库！
# default
若为公开仓库则所有人都可下载本镜像。
::

```yaml
name: Docker Build

on:
  push:
    branches:
      - main
  schedule:
    - cron: '0 3 * * *'

  repository_dispatch:
    types: [trigger-workflow]

permissions: write-all
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  PNPM_VERSION: 9.x.x
  HASH_FILE: build_hash

jobs:
  prepare:
    name: Prepare
    runs-on: ubuntu-latest
    if: ${{ github.event.head_commit.message != 'Update hash file' }}

    outputs:
      hash_content: ${{ steps.read_hash.outputs.hash_content }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Read HASH_FILE content
        id: read_hash
        run: |
          content=$(cat ${{ env.HASH_FILE }}) || true
          echo "hash_content=$content" >> "$GITHUB_OUTPUT"
  check:
    name: Check Should Rebuild
    runs-on: ubuntu-latest
    needs: prepare
    outputs:
      canceled: ${{ steps.use_content.outputs.canceled }}

    steps:
      - uses: actions/checkout@v4
        with:
          repository: innei-dev/shiroi
          token: ${{ secrets.GH_PAT }}
          fetch-depth: 0
          lfs: true

      - name: Use content from prev job and compare
        id: use_content
        env:
          FILE_HASH: ${{ needs.prepare.outputs.hash_content }}
        run: |
          file_hash=$FILE_HASH
          current_hash=$(git rev-parse --short HEAD)
          echo "File Hash: $file_hash"
          echo "Current Git Hash: $current_hash"
          if [ "$file_hash" == "$current_hash" ]; then
            echo "Hashes match. Stopping workflow."
            echo "canceled=true" >> $GITHUB_OUTPUT
          else
            echo "Hashes do not match. Continuing workflow."
          fi

  build:
    name: Build artifact
    runs-on: ubuntu-latest
    needs: check
    if: ${{needs.check.outputs.canceled != 'true'}}

    outputs:
      sha_short: ${{ steps.store.outputs.sha_short }}
      branch: ${{ steps.store.outputs.branch }}

    steps:
      - uses: actions/checkout@v4
        with:
          repository: innei-dev/shiroi
          token: ${{ secrets.GH_PAT }}
          fetch-depth: 0
          lfs: true

      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build Docker Image
        run: |
          docker build -t ghcr.io/${{ secrets.DOCKER_NAMESPACE }}/shiroi:latest .

      - name: Push Docker Image to Github
        run: |
          docker push ghcr.io/${{ secrets.DOCKER_NAMESPACE }}/shiroi:latest

      - name: Store artifact commit version
        shell: bash
        id: store
        run: |
          sha_short=$(git rev-parse --short HEAD)
          branch_name=$(git rev-parse --abbrev-ref HEAD)
          echo "sha_short=$sha_short" >> "$GITHUB_OUTPUT"
          echo "branch=$branch_name" >> "$GITHUB_OUTPUT"
  store:
    name: Store artifact commit version
    runs-on: ubuntu-latest
    needs: [build]
    steps:

      - name: Checkout
        uses: actions/checkout@v4
        with:
          persist-credentials: false
          fetch-depth: 0

      - name: Use outputs from build
        env:
          SHA_SHORT: ${{ needs.build.outputs.sha_short }}
          BRANCH: ${{ needs.build.outputs.branch }}
        run: |
          echo "SHA Short from build: $SHA_SHORT"
          echo "Branch from build: $BRANCH"

      - name: Write hash to file
        env:
          SHA_SHORT: ${{ needs.build.outputs.sha_short }}

        run: |
          echo "SHA_SHORT: $SHA_SHORT"
          echo $SHA_SHORT > ${{ env.HASH_FILE }}

      - name: Commit files
        run: |
          git config --local user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git config --local user.name "github-actions[bot]"
          git add ${{ env.HASH_FILE }}
          git status
          git commit -a -m "Update hash file"

      - name: Push changes
        uses: ad-m/github-push-action@master
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          branch: ${{ github.ref }}
```

这样就可以实现简单的构建并上传 Github Registry 镜像。你需要在仓库的 `secret` 设置中配置以下机密变量：
::card-list
- `GH_PAT`：有权限访问 Shiroi 仓库的 Github Access Token
- `DOCKER_NAMESPACE`：镜像命名空间，全部小写，建议用个人 Github 用户名
::

::alert
# title
注意！
# default
由于 Github Action 的限制，仓库 3 个月无活动时，工作流会被禁用。
@innei
::

我们采用 innei 的办法，每次构建结束后上传一个存储哈希值的文件，保持仓库活跃。同时，构建前对仓库哈希值进行对比，避免重复构建。

参考上述修改环境 `secret` 后，运行工作流（注意先开启仓库设置中 Github Action 写入文件的权限），即可生成哈希值文件并构建镜像。

## 使用

保存工作流文件，等待运行完毕后，你应该可以在仓库侧边栏的 `Packages` 或个人 Github 主页的 `Package` 里找到镜像文件。

在服务器上拉取镜像前，需要先配置 Docker 私有仓库。注意，Gitea 实例必须为 HTTPS 地址，否则 Docker 会拒绝拉取不安全的私有仓库。

在服务器上输入以下指令登录 Github Registry 私有仓库：

```bash
docker login ghcr.io
```

输入账号和有访问权限的 Github Access Token，确认登录后即可拉取私有仓库镜像。如果你用的是 1Panel，可以在容器仓库设置中直接配置私有仓库。

你也可以用如下 compose 文件配置安装 Shiroi：

```yaml
services:
  shiro:
    container_name: Shiroi
    image:
    restart: always
    environment:
      - NEXT_SHARP_PATH=/usr/local/lib/node_modules/sharp
      - NEXT_PUBLIC_API_URL=https://api.example.com/api/v2
      - NEXT_PUBLIC_GATEWAY_URL=https://api.example.com
    ports:
      - 127.0.0.1:2323:2323
    networks:
      - mx-network
```

`image` 填写你在软件包仓库看到的容器镜像信息。

## 后话

这样你就算是简单完成了，本文本质上偏专业系，而非喂饭文。

如有疑问，欢迎在评论区提问或结合搜索引擎查阅本文。
