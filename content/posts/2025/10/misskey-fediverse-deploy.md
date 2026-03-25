---
title: Misskey 部署：新一代联邦星际微博平台
description: 本文介绍了如何在单台服务器上全量部署联邦宇宙社交平台 Misskey 及其配套组件。文章从准备阶段开始，建议使用至少 2 核 4G 的服务器，并强调部署后不可更换域名。接着详细说明了安装 Docker、Caddy 反向代理的步骤，包括自动 HTTPS 证书的申请与配置。然后逐步指导获取 Misskey 源码、配置数据库（PostgreSQL 与 Redis）、设置全文搜索（使用 sqlPgroonga）以及调整 Docker Compose 文件。最后，通过构建镜像、初始化数据库并启动容器，完成 Misskey 的部署，用户可通过域名访问初始化页面。
date: 2025-10-24 05:00:00
image: https://misskey-hub.net/img/hero/ss/tl.light.webp
categories: [联邦宇宙]
tags: [Fediverse, Website]
---

## 前言

我踏入联邦宇宙的第一个实例是 Misskey....的 Fork 版本 Firefish，这些年过去了，Firefish 已经停止维护，但 Misskey 仍在蓬勃发展，今天我们在这篇文章将详细讲解如何在一台服务器上全量部署 Misskey 和其配套服务。

## 准备

在部署 Misskey 前，你需要有一台性能强悍的服务器，虽然 Misskey 并不像 Mastodon 那么庞大，但依然需要你的服务器有较高的配置，个人建议至少 2c4g 起步。

你可以参见个人文章《自建一个 Fediverse 实例，我们需要准备什么？》，在此篇文章里个人从域名到服务器准备以及对象存储等全面详解了你应该为联邦宇宙实例做什么准备。

::link-banner
---
banner: https://engagemedia.org/wp-content/uploads/2020/07/Fediverse-3D_logojpg.jpg
title: 自建一个 Fediverse 实例，我们需要准备什么？
description:
link: "/2025/06/self-fediverse-prepare"
---
::

在有一台合适的服务器和域名后，我们就可以开始安装 Misskey 的第一步了。

::alert{type="warning" card}
# title
注意！
# default
域名一定要慎重决定，一旦你启动了实例，在此之后不要更改域名！
::

注意因为 Misskey 所使用的 ActivityPub 协议的特殊性，部署后不支持更换域名！所以选择域名一定要慎重选择。

## 安装 Docker

Misskey 官方推荐的部署方式是 Docker Compose，这需要我们在服务器上安装 Docker。

我们使用 Linuxmirrors 提供的 Docker 安装脚本来执行 Docker 的安装，它可以在多种 Linux 系统上安装 Docker。

```bash
bash <(curl -sSL https://linuxmirrors.cn/docker.sh)
```

在遵照脚本步骤完成安装 Docker 后，我们进行下一步操作。

## 安装反向代理服务

### 反向代理

在 Misskey 我个人是推荐使用 Caddy 这款 Web 服务器的，自身占用低且性能不错，而且它能够自动申请 https 证书，接入联邦宇宙是必须要有 https 协议的，所以你肯定是不能用 http 或者 ip 访问 Misskey 实例的，Caddy 就能帮助我们简化这个过程。

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
misskey.example.com {
  reverse_proxy 127.0.0.1:3000
  encode zstd gzip
}
```

这代表 Caddy 会反代`misskey.example.com`的请求，并把请求转发到在本地`3000`端口上暴露的服务，我们这篇教程会让 Misskey 在`3000`端口上部署，如果你想要更换端口，那么在上面的配置文件和后面的配置文件中你都需要更换对应端口。

Caddy 支持通过配置文件启用 Zstandard和 Gzip 压缩功能，这是主流的两种压缩算法。我们只需要把` encode zstd gzip`加入域名配置文件下方即可，后续加入其他配置也是类似这样放置。

同样你也需要更换`misskey.example.com`为你实际想部署的域名，完成配置后，确保域名已经解析到服务器的前提下，使用`systemctl restart caddy`重启 Caddy 服务。

## 安装 Misskey 服务

### 获取 Misskey 和初始化配置文件

使用以下指令从 Github 获取 Misskey 仓库和相关文件，并进入 Misskey 文件夹
```bash
git clone -b master https://github.com/misskey-dev/misskey.git
cd misskey
```

使用以下命令复制各种配置文件的示例到可编辑配置文件：

```bash
cp .config/docker_example.yml .config/default.yml
cp .config/docker_example.env .config/docker.env
cp ./compose_example.yml ./compose.yml
```

### 修改 Misskey 配置文件

进入 Misskey 目录下的`.config`文件夹，首先打开`default.yml`，我们要进行 Misskey 配置文件各项配置的修改。

#### 实例 URL 配置

首先我们需要编辑配置文件的 URL 设置，此处即为你的实例以后对外的 URL，所以再次重申一定要慎重决定，一旦你启动了实例，在此之后不要更改 URL 设置！

```yaml
# 最终用户看到的可访问 URL。
# 你也可以通过环境变量来设置 URL。
url: https://misskey.example.com
```

#### 端口与 TLS 设置

在此处我们需要注意和上文我们预配置反向代理的时候要保持一个端口，此处即`3000`

```yaml
# Misskey 服务器应监听的端口。
port: 3000
```

#### 数据库设置

在此段我们要进行的是数据库连接信息设置，将`example-misskey-user`和`example-misskey-pass`更换为你想使用的账户和密码，如果你的数据库地址开启了 SSL 连接，还需要把`extra`下的`ssl`设为`true`，但我们默认使用的是 Docker Compose 的 PostgreSQL 数据库所以不需要开启 SSL。

```yaml
db:
  host: db
  port: 5432

  # 数据库名称
  # 你也可以通过环境变量来设置数据库名称。
  db: misskey

  # 认证信息
  # 你也可以通过环境变量来设置用户名和密码。
  user: example-misskey-user
  pass: example-misskey-pass

  # 是否禁用查询缓存
  # disableCache: true

  # 额外的连接选项
  # extra:
  #  ssl: true
```

**dbReplications / dbSlaves（读写分离）**

这是一个进阶玩法，适用于超大型实例，简单介绍就是把读，比如搜索，展示 Note 贴文等更多只需要读取的场景路由到只读副本上，可以有效减少主库压力。

小型实例基本用不到，等你用到它起码得万人以上实例才可能显出主库压力问题了，而且使用这个功能注定会有延迟，从库延迟 100~300 ms 很常见，例如刚发的 Note 可能瞬间在个人时间线里看不到，然后刷新一下又有了。

本文仅对此作解释。

```yaml
dbReplications: false

# 你可以在这里配置任意数量的只读副本
# dbSlaves:
#  -
#    host:
#    port:
#    db:
#    user:
#    pass:
#  -
#    host:
#    port:
#    db:
#    user:
#    pass:
```

#### Redis 数据库设置

Redis 作为内存数据库，在搜索查询还有投递等队列操作上都用得到，是必须配置的，如果你连接的外部带加密数据库或者服务器一个 Redis 提供给多个服务那么就需要详细配置它了，使用 Docker Compose 配置保持默认即可。

```yaml
redis:
  host: redis
  port: 6379
  # family: 0  # 0=Both, 4=IPv4, 6=IPv6
  # pass: example-pass
  # prefix: example-prefix
  db: 1
```

#### 全文搜索设置

得益于我在 Sharkey 实例运营上得到的宝贵经验，我们在此处选择 sqlPgroonga 作为数据库全文搜索引擎，它对中文在内的亚洲语言等全文搜索兼容性更好更快，而且不需要部署额外的搜索服务，本身就是在 PostgreSQL 服务上提供的额外支持，因此我们后续也需要在 Compose 文件上做一些小修改来让它使用 sqlPgroonga 作为数据库全文搜索。

```yaml
fulltextSearch:
  provider: sqlPgroonga
```

#### ID 生成设置

这里你可以调整 Misskey 的 ID 生成算法，通常不需要修改它，但你依然可以根据个人调整它。

```yaml
# 可选算法：
# aid   ... 最短，毫秒级
# aidx  ... 毫秒级（默认推荐）
# meid  ... 类似 Mongo ObjectID，毫秒级
# ulid  ... 毫秒级，字典序友好
# objectid ... 仅用于兼容旧实例

# 实例一旦启动，切勿再修改此配置！
id: aidx
```

#### 其他设置

通常不需要修改它，我在这放一下带中文注释翻译的配置文件，你可以按需要修改它。

```yaml
# 是否禁用 HSTS（HTTP 严格传输安全）
# disableHsts: true

# Worker 进程数
# clusterLimit: 1

# 每个 worker 的并发任务数
# deliverJobConcurrency: 128   # 投递（出站）任务并发
# inboxJobConcurrency: 16      # 收件（入站）任务并发

# 任务速率限制（每秒）
# deliverJobPerSec: 128
# inboxJobPerSec: 32

# 任务最大重试次数
# deliverJobMaxAttempts: 12
# inboxJobMaxAttempts: 8

# 对外发起请求时使用的 IP 协议族（ipv4、ipv6 或 dual）
# outgoingAddressFamily: ipv4

# HTTP/HTTPS 代理
# proxy: http://127.0.0.1:3128

# 不走代理的直连白名单
proxyBypassHosts:
  - api.deepl.com
  - api-free.deepl.com
  - www.recaptcha.net
  - hcaptcha.com
  - challenges.cloudflare.com

# SMTP/SMTPS 代理
# proxySmtp: http://127.0.0.1:3128    # 使用 HTTP/1.1 CONNECT
# proxySmtp: socks4://127.0.0.1:1080 # 使用 SOCKS4
# proxySmtp: socks5://127.0.0.1:1080 # 使用 SOCKS5

# 媒体代理（用于隐藏用户真实地址、缓存缩略图等）
# mediaProxy: https://example.com/proxy

# 出于安全考虑，默认禁止从私网地址上传附件。
# 可通过以下设置放行，默认值为“未定义”。
# 详见 12.90.0 (2021/09/04) 更新日志。
# allowedPrivateNetworks: [
#  '127.0.0.1/32'
# ]

# 上传/下载文件大小限制（单位：字节）
# maxFileSize: 262144000    # 约 250 MiB

# 日志相关
# logging:
#   sql:
#     # 是否在日志中输出 SQL 查询参数
#     # 默认：false
#     enableQueryParamLogging: false
#     # 是否禁用 SQL 截断，设为 true 则输出完整 SQL 文本
#     # 默认：false
#     disableQueryTruncation: false
```

### Docker 环境变量文件修改

保存关闭上面的 Misskey 配置文件后，我们打开同目录的`docker.env`文件，这里将决定编排文件启动时的环境变量，一般只需要修改此处数据库的三段内容，和配置文件里配置的一模一样即可。

```yaml
# Misskey 设置
# MISSKEY_URL=https://example.tld/

# 数据库设置
POSTGRES_PASSWORD=example-misskey-pass
# DATABASE_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_USER=example-misskey-user
# DATABASE_USER=${POSTGRES_USER}
POSTGRES_DB=misskey
# DATABASE_DB=${POSTGRES_DB}
DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}}"
```

### Docker 编排文件修改

因为我们前面修改过数据库全文搜索引擎以及我们也需要做一些安全等修改需求，此处我们也需要对 Compose 编排文件做一些修改。

回到 Misskey 主目录，打开目录下的`compose.yml`，内容应该类似如下：

```yaml
services:
  web:
    build: .
    restart: always
    links:
      - db
      - redis
    #     - mcaptcha
    #     - meilisearch
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - '3000:3000'
    networks:
      - internal_network
      - external_network
    # env_file:
    #   - .config/docker.env
    volumes:
      - ./files:/misskey/files
      - ./.config:/misskey/.config:ro

  redis:
    restart: always
    image: redis:7-alpine
    networks:
      - internal_network
    volumes:
      - ./redis:/data
    healthcheck:
      test: redis-cli ping
      interval: 5s
      retries: 20

  db:
    restart: always
    image: postgres:15-alpine
    networks:
      - internal_network
    env_file:
      - .config/docker.env
    volumes:
      - ./db:/var/lib/postgresql/data
    healthcheck:
      test: pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB
      interval: 5s
      retries: 20

#  mcaptcha:
#    restart: always
#    image: mcaptcha/mcaptcha:latest
#    networks:
#      internal_network:
#      external_network:
#        aliases:
#          - localhost
#    ports:
#      - 7493:7493
#    env_file:
#      - .config/docker.env
#    environment:
#      PORT: 7493
#      MCAPTCHA_redis_URL: "redis://mcaptcha_redis/"
#    depends_on:
#      db:
#        condition: service_healthy
#      mcaptcha_redis:
#        condition: service_healthy
#
#  mcaptcha_redis:
#    image: mcaptcha/cache:latest
#    networks:
#      - internal_network
#    healthcheck:
#      test: "redis-cli ping"
#      interval: 5s
#      retries: 20

#  meilisearch:
#    restart: always
#    image: getmeili/meilisearch:v1.3.4
#    environment:
#      - MEILI_NO_ANALYTICS=true
#      - MEILI_ENV=production
#    env_file:
#      - .config/meilisearch.env
#    networks:
#      - internal_network
#    volumes:
#      - ./meili_data:/meili_data

networks:
  internal_network:
    internal: true
  external_network:
```

#### Web 程序本体

我们需要修改容器对外暴露为`127.0.0.1:3000`使得 Misskey 仅对 Caddy 反向代理暴露端口，以及移除掉无用的配置，修改后的配置文件大概如下：

```yaml
web:
  build: .
  restart: always
  links:
    - db
    - redis
  depends_on:
    db:
      condition: service_healthy
    redis:
      condition: service_healthy
  ports:
    - '127.0.0.1:3000:3000'
  networks:
    - internal_network
    - external_network
  volumes:
    - ./files:/misskey/files
    - ./.config:/misskey/.config:ro
```

#### Redis 数据库

此处无需修改，保持原配置即可。

```yaml
redis:
  restart: always
  image: redis:7-alpine
  networks:
    - internal_network
  volumes:
    - ./redis:/data
  healthcheck:
    test: redis-cli ping
    interval: 5s
    retries: 20
```

#### PostgreSQL 数据库

我们需要把数据库镜像更换为`pgroonga`以让它支持 sqlPgroonga 全文搜索。

```yaml
db:
  restart: always
  image: groonga/pgroonga:4.0.1-alpine-17
  networks:
    - internal_network
  env_file:
    - .config/docker.env
  volumes:
    - ./db:/var/lib/postgresql/data
  healthcheck:
    test: pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB
    interval: 5s
    retries: 20
```

保存关闭退出，我们就完成了 Docker Compose 的相关配置了，该准备启动编排了。

### 构建和初始化

执行以下命令进行 Misskey 镜像构建和数据库初始化，需要等待一段时间完成。

```bash
sudo docker compose build
sudo docker compose run --rm web pnpm run init
```

### 启动编排

```bash
sudo docker compose up -d
```

## 完成

在编排启动后，如果你的域名和服务器 Caddy 配置正确，你应该就可以在你设置的域名上看到 Misskey 的初始化页面了！

🎉恭喜你完成了 Misskey 的基本全量部署！
