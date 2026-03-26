---
title: Lemmy 部署：Rust Fediverse 社区系统
description: 本文介绍了如何以Docker方式自建Fediverse实例Lemmy：先装Docker，拉取官方compose文件，替换域名、数据库密码与邮箱参数；按需调优PostgreSQL，修正挂载路径，赋权pictrs目录；启动后用Caddy/Nginx反代10633端口即可上线。文末给出升级命令与故障排查示例，助你轻松拥有Rust驱动、150 MB内存占用、贴吧般的去中心化社区。
date: 2025-10-22 06:00:00
image: https://join-lemmy.org/static/assets/images/main_screen_2.webp
categories: [联邦宇宙]
tags: [Fediverse, Website]
---

## 前言

::alert{type="warning" card}
#title
注意！
#default
考虑到目前个人的实际应用场景，本文仅为 Lemmy 的部署教程，个人暂未实际上线可用 Lemmy 公共实例。
::

最近个人打算补全 Fediverse 各种程序部署和配置教程，若对此类题材有兴趣欢迎持续订阅本博客。你可以通过 Folo 等 RSS 阅读器持续订阅本博客更新！

最近这两年个人社交的琢磨方向逐渐回到和倾向于 Fediverse 上，然后又恰逢个人最近了解到了 Rust 这门神奇的语言，上手使用后它安全而且占用小，确实“真香”了。

然后最近就在看把这俩结合起来的项目是什么样子的，于是 Lemmy 就进入了我的视野，它的定位更像是 Fediverse 版的 Reddit，如果你不了解 Reddit 是什么也没关系，我要是说百度贴吧，我相信你一定认识吧？Lemmy 整体就像是此类社区，用户在不同板块交流的社区。

在某个交流二次元的 Lemmy 实例中我简单上手使用和交流后感觉还是比较有趣的，不过整体来说 Lemmy 的圈子性更为偏一些，如果你没有足够的用户在某个大方向上，我不是很建议你选择部署它。

当然自部署 Fediverse 并非全是为了像建设传统社区一样给一堆人用，也有些人是为了把安全可用性和数据掌握在自己手中，总之如果你决定好了，那么你就可以跟随我的步伐，开始尝试部署 Lemmy 了。

## 介绍

> Lemmy是一个自托管的社交链接聚合与讨论平台。它完全是自由和开放的，不受任何公司控制。这意味着不会有广告、追踪或秘密算法。内容按社群进行组织，因此您可以轻松订阅感兴趣的话题，而忽略其他话题。通过赞踩将最有趣的条目推至顶部。

这是来自[官方网站](https://join-lemmy.org/)的中文介绍，好，过。

总之很多特性你都可以去找个实例注册体验一下或者部署好自己用，那才是真实体验，我们先简单说一下很多人关心的性能问题（来自官方部署文档）：

> 在默认的 Docker 安装中，Lemmy 大约使用 150 MB 的 RAM。CPU 使用率可以忽略不计。

Rust 嘛，很正常，谁用谁知道（当然写那是另一码事了）。

## 安装和升级

没错，正如上面文档所言，Lemmy 默认且建议你使用 Docker 部署它，我其实也很认同这样部署，Rust 手动编译目前似乎在各个系统中的支持仍较玄学，所以如非必要，我也不建议使用 Rust 手动编译部署。

### 安装 Docker

那么首先我们安装 Docker，对于 Linux 用户，我们可以使用 Linuxmirrors 提供的更简单的一键安装 Docker 脚本（可自动判断系统和换源，甚至部分国产系统都可以装）。

什么？你是 Windows 或者想用图形化管理 Docker？Docker Desktop 欢迎你。

人嘛，总归是懒的，开源，社区证明的好用的项目为什么不用呢？哪怕是去 Docker 官网，你得到的推荐也是来自官方的兼容更少系统的 Docker 一键安装脚本。

```bash
bash <(curl -sSL https://linuxmirrors.cn/docker.sh)
```

等待 Docker 安装完成，我们就可以开始下一步了。

### 新建 Lemmy 项目文件夹和下载配置文件

##### 新建文件夹

新建文件夹我相信你一定还是会的，不过该给指令咱还是要给的，能少打一个字是一个字😋

```bash
mkdir lemmy
cd lemmy
```

接下来下载默认配置文件。

有人可能会问了：“为什么不给 Github 镜像下载链接？”

咱觉得吧，很少有纯国内服务器用户部署这种 Fediverse 服务还要大规模互联的吧:(

总之真有这需求可以自行转换解决。

##### 下载配置文件

切换到 Lemmy 所在的目录并在终端执行：

```bash
wget https://raw.githubusercontent.com/LemmyNet/lemmy-docs/main/assets/docker-compose.yml
wget https://raw.githubusercontent.com/LemmyNet/lemmy-ansible/main/examples/config.hjson -O lemmy.hjson
wget https://raw.githubusercontent.com/LemmyNet/lemmy-ansible/main/templates/nginx_internal.conf
wget https://raw.githubusercontent.com/LemmyNet/lemmy-ansible/main/files/proxy_params
```

### 下载，安装，启动

随着时间的推移，本文提供的示例文件不一定是最新文件的样子，如果有变化并且你还不明白欢迎随时评论区提醒或咨询。

#### Docker 编排文件

首先咱打开 Lemmy 目录下的`docker-compose.yml`文件，大概应该是下面这个样子：

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: 50m
    max-file: '4'

services:
  proxy:
    image: nginx:1-alpine
    ports:
      # Listen for outside connections on port 10633. You can freely change the left-side
      # number to a different port, eg using port 80 if you don't need a reverse proxy.
      - '10633:8536'
    volumes:
      - ./nginx_internal.conf:/etc/nginx/nginx.conf:ro,Z
      - ./proxy_params:/etc/nginx/proxy_params:ro,Z
    restart: always
    logging: *default-logging
    depends_on:
      - pictrs
      - lemmy-ui

  lemmy:
    image: dessalines/lemmy:0.19.13
    hostname: lemmy
    restart: always
    logging: *default-logging
    environment:
      - RUST_LOG="warn"
    volumes:
      - ./lemmy.hjson:/config/config.hjson:Z
    depends_on:
      - postgres
      - pictrs

  lemmy-ui:
    image: dessalines/lemmy-ui:0.19.13
    environment:
      - LEMMY_UI_LEMMY_INTERNAL_HOST=lemmy:8536
      - LEMMY_UI_LEMMY_EXTERNAL_HOST={{ domain }}
      - LEMMY_UI_HTTPS=true
    volumes:
      - ./volumes/lemmy-ui/extra_themes:/app/extra_themes
    depends_on:
      - lemmy
    restart: always
    logging: *default-logging

  pictrs:
    image: asonix/pictrs:0.5.19
    # this needs to match the pictrs url in lemmy.hjson
    hostname: pictrs
    # we can set options to pictrs like this, here we set max. image size and forced format for conversion
    # entrypoint: /sbin/tini -- /usr/local/bin/pict-rs -p /mnt -m 4 --image-format webp
    environment:
      - PICTRS_OPENTELEMETRY_URL=http://otel:4137
      - PICTRS__SERVER__API_KEY={{ postgres_password }}
      - RUST_BACKTRACE=full
      - PICTRS__MEDIA__VIDEO__VIDEO_CODEC=vp9
      - PICTRS__MEDIA__ANIMATION__MAX_WIDTH=256
      - PICTRS__MEDIA__ANIMATION__MAX_HEIGHT=256
      - PICTRS__MEDIA__ANIMATION__MAX_FRAME_COUNT=400
    user: 991:991
    volumes:
      - ./volumes/pictrs:/mnt:Z
    restart: always
    logging: *default-logging

  postgres:
    image: pgautoupgrade/pgautoupgrade:18-alpine
    hostname: postgres
    environment:
      - POSTGRES_USER=lemmy
      - POSTGRES_PASSWORD={{ postgres_password }}
      - POSTGRES_DB=lemmy
    shm_size: 1g
    volumes:
      - ./volumes/postgres:/var/lib/postgresql/data:Z
      - ./customPostgresql.conf:/etc/postgresql.conf
    restart: always
    logging: *default-logging

  postfix:
    image: mwader/postfix-relay
    environment:
      - POSTFIX_myhostname={{ domain }}
    restart: always
    logging: *default-logging
```

别看这样一大堆，你要改的地方也很简单，主要是`{{ domain }}`和`{{ postgres_password }}`这俩东西。

`{{ domain }}`就是你 Lemmy 需要提供服务的域名，在部署 Fediverse 前首先就得需要有一个可以公网访问的域名，这是必须条件，而且以后这个域名都不能改了，所以请慎重决定。

`{{ postgres_password }}`就是 PostgreSQL数据库的密码，也请慎重决定，一个安全的随机值可以保障你的服务数据库安全，请不要随便使用`123456`或者`lemmy`这样的密码摆烂，这是对你自己和你用户的数据安全不负责。

把以下内容删除，在下文我们自行配置邮箱服务。

```yaml
postfix:
  image: mwader/postfix-relay
  environment:
    - POSTFIX_myhostname={{ domain }}
  restart: always
  logging: *default-logging
```
#### Lemmy 主配置文件

##### 基础配置

然后是 Lemmy 的主配置文件，我们打开`lemmy.hjson`这个文件，内容大致如下：

```yaml
{
  database: {
    host: postgres
    password: "{{ postgres_password }}"
    # Alternative way:
    #uri: "postgresql://lemmy:{{ postgres_password }}@postgres/lemmy"
  }
  hostname: "{{ domain }}"
  pictrs: {
    url: "http://pictrs:8080/"
    api_key: "{{ postgres_password }}"
  }
  email: {
    smtp_server: "postfix:25"
    smtp_from_address: "noreply@{{ domain }}"
    tls_type: "none"
  }
}

```

`{{ domain }}`和`{{ postgres_password }}`眼熟吧？把你在上面设置好的这俩变量填进去就行。

我们说点不一样的，邮箱配置。

##### 发信邮箱配置

所谓邮箱配置就是 Lemmy 的通知发信邮箱配置，官方默认给的配置实在是太简单，是适用于服务器本身部署邮箱服务的方案，很显然不大适合大部分用户。

也就是上面配置文件中的这一段：

```yaml
  email: {
    smtp_server: "postfix:25"
    smtp_from_address: "noreply@{{ domain }}"
    tls_type: "none"
  }
```

我们把他删掉，然后使用以下配置：

```yaml
# 邮件发送配置。除登录名/密码外，所有选项均为必填
email: {
  # SMTP 服务器的主机名和端口
  smtp_server: "localhost:25"

  # 登录 SMTP 服务器的用户名
  smtp_login: "string"

  # 登录 SMTP 服务器的密码
  smtp_password: "string"

  # 发件地址，例如 "noreply@your-instance.com"
  smtp_from_address: "noreply@example.com"

  # SMTP 连接是否使用 TLS。可设为 none、tls 或 starttls
  tls_type: "none"
  }
```

是不是瞬间直观了？我相信你基本能填明白。

认识不全也没关系，我们生活在一个互联网发达的时代，请使用你的搜索引擎搜索相关信息或者把本文此段内容复制然后去找 AI 问也行，只要你不随便直接复制粘贴到你自己站点上然后发出去说这文章是你自己的，本站不限制你复制任何内容。

我只说一点，如果你的发信服务商只提供了 465 端口连接方式，那么你除了上面主机名和端口写的是`服务商端口:465`以外，下面使用的`tls_type`填写`tls`。

##### Lemmy Nginx 配置

Lemmy 自身是用自带的 Nginx 容器把前后端混合起来合成一个端口提供给你服务的，所以你需要配置它，除非你想要使用其它的 Lemmy 前端，但这是进阶操作了，本文不会提供此内容。

在系列文末期个人会考虑补全 Lemmy 常用的更为进阶的玩法，也就是更换前端。

现在，请打开目录下的`nginx_internal.conf`文件，内容大概如下：

```yaml
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    # Docker internal DNS IP so we always get the newer containers without having to
    # restart/reload the docker container / nginx configuration
    resolver {{ nginx_internal_resolver }} valid=5s;

    # set the real_ip when from docker internal ranges. Ensuring our internal nginx
    # container can always see the correct ips in the logs
    set_real_ip_from 10.0.0.0/8;
    set_real_ip_from 172.16.0.0/12;
    set_real_ip_from 192.168.0.0/16;

    # We construct a string consistent of the "request method" and "http accept header"
    # and then apply soem ~simply regexp matches to that combination to decide on the
    # HTTP upstream we should proxy the request to.
    #
    # Example strings:
    #
    #   "GET:application/activity+json"
    #   "GET:text/html"
    #   "POST:application/activity+json"
    #
    # You can see some basic match tests in this regex101 matching this configuration
    # https://regex101.com/r/vwMJNc/1
    #
    # Learn more about nginx maps here http://nginx.org/en/docs/http/ngx_http_map_module.html
    map "$request_method:$http_accept" $proxpass {
        # If no explicit matches exists below, send traffic to lemmy-ui
        default "http://lemmy-ui:1234";

        # GET/HEAD requests that accepts ActivityPub or Linked Data JSON should go to lemmy.
        #
        # These requests are used by Mastodon and other fediverse instances to look up profile information,
        # discover site information and so on.
        "~^(?:GET|HEAD):.*?application\/(?:activity|ld)\+json" "http://lemmy:8536";

        # All non-GET/HEAD requests should go to lemmy
        #
        # Rather than calling out POST, PUT, DELETE, PATCH, CONNECT and all the verbs manually
        # we simply negate the GET|HEAD pattern from above and accept all possibly $http_accept values
        "~^(?!(GET|HEAD)).*:" "http://lemmy:8536";
    }

    server {
        set $lemmy_ui "lemmy-ui:1234";
        set $lemmy "lemmy:8536";
        # this is the port inside docker, not the public one yet
        listen 1236;
        listen 8536;

        # change if needed, this is facing the public web
        server_name localhost;
        server_tokens off;

        # Upload limit, relevant for pictrs
        client_max_body_size 20M;

        # Send actual client IP upstream
        include proxy_params;

        # frontend general requests
        location / {
            proxy_pass $proxpass;
            rewrite ^(.+)/+$ $1 permanent;
        }

        # security.txt
        location = /.well-known/security.txt {
            proxy_pass "http://$lemmy_ui";
        }

        # backend
        location ~ ^/(api|pictrs|feeds|nodeinfo|.well-known|version|sitemap.xml) {
            proxy_pass "http://$lemmy";

            # Send actual client IP upstream
            include proxy_params;
        }
    }
}

```

看着这么一大串，实际上你只需要修改一个东西：`{{ nginx_internal_resolver }}`。

把它替换为 `127.0.0.11`。

##### 数据库调优（进阶）

这里是一个比较进阶的步骤，我不会仔细讲它，因为这是对新手的一个挑战项，主要还是让阅读本文的进阶技术玩家们了解有这个选项的存在，让他们进行更好的性能追求。

如果你觉得你玩不明白这一步，请选择跳过这一步:(

使用如下指令下载 Lemmy 提供的 `customPostgresql.conf`

```bash
wget https://raw.githubusercontent.com/LemmyNet/lemmy-ansible/main/examples/customPostgresql.conf
```

接下来前往网站：https://pgtune.leopard.in.ua/ ，填写你的设备或服务器配置，生成文件，然后覆盖掉里面类似下面这一段保存即可：

```yaml
# DB Version: 15
# OS Type: linux
# DB Type: web
# Total Memory (RAM): 8 GB
# CPUs num: 4
# Data Storage: ssd

max_connections = 200
# This needs to match your shm_size in docker-compose.yml
shared_buffers = 2GB
effective_cache_size = 6GB
maintenance_work_mem = 512MB
checkpoint_completion_target = 0.9
checkpoint_timeout = 86400
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 5242kB
min_wal_size = 1GB
max_wal_size = 30GB
max_worker_processes = 4
max_parallel_workers_per_gather = 2
max_parallel_workers = 4
max_parallel_maintenance_workers = 2
```

#### 文件夹权限配置

经过了漫长的配置文件修改步骤，我们终于来到下一步了（喜）

这一步很简单，为 pictrs 文件夹设置正确的权限。

切换到 Lemmy 所在的目录并在终端执行：

```bash
mkdir -p volumes/pictrs
sudo chown -R 991:991 volumes/pictrs
```

#### 启动编排

终于，我们完成了前面配置 Lemmy 本身的步骤，该启动编排了。

```bash
docker compose up -d
```

等待编排完成启动，你就可以在 `http://localhost:{{ lemmy_port }}` 访问到 Lemmy 了。

#### 故障排除

个人启动的时候遇到了一个问题，出现报错：

```text
error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: error mounting "/home/palomiku/Fediverse/Lemmy/volumes/postgres" to rootfs at "/var/lib/postgresql/data": change mount propagation through procfd: open o_path procfd: open /var/lib/docker/overlay2/08cdf58059859f223d2c577d44b22a74ef0b5e908620fd89c05fae3e71879e3f/merged/var/lib/postgresql/data: no such file or directory: unknown
```

原因是 Docker 在为 Lemmy 的 postgres 容器挂载本地目录 `/home/palomiku/Fediverse/Lemmy/volumes/postgres` 时，发现容器镜像里 **根本不存在挂载点 `/var/lib/postgresql/data`**，于是 mount 失败，容器启动被中止。

我们回头看看 Lemmy 的 `docker-compose.yml` 编排文件中有关 PostgreSQL 的这一段：

```yaml
postgres:
  image: pgautoupgrade/pgautoupgrade:18-alpine
  hostname: postgres
  environment:
    - POSTGRES_USER=lemmy
    - POSTGRES_PASSWORD=0d000721
    - POSTGRES_DB=lemmy
  shm_size: 1g
  volumes:
    - ./volumes/postgres:/var/lib/postgresql/data
    - ./customPostgresql.conf:/etc/postgresql.conf
  restart: always
  logging: *default-logging
```

相关错误：https://github.com/pgautoupgrade/docker-pgautoupgrade?tab=readme-ov-file#error-message-when-mounting-data-to-varlibpostgresqldata-on-postgres-v18

想解决也很简单，把宿主机目录改挂到 **真正的父目录** `/var/lib/postgresql`。

这段改成这样：

```yaml
volumes:
  - ./volumes/postgres:/var/lib/postgresql
```
### 配置反向代理

这一步实话说是简单又麻烦，你要是不懂，我建议你直接装个服务器面板配置反代或者复制修改以下内容去问 AI：

```markdown
在服务器使用 Caddy 或 Nginx 反代 10633 端口上的服务该怎么做，我的系统是 XXX
```

我个人更推荐使用 Caddy，还能减少配置 SSL 证书的时间，多好:)

本文不赘述反向代理步骤。

### 升级 Lemmy

前往 Lemmy 官网或者 Github 了解最新版本号和相关信息。

如果你已经有一个运行的 `Lemmy` 实例，要更新到最新版本，通常更改 `docker-compose.yml` 中的版本号就足够了，例如将 `dessalines/lemmy:0.19.4` 改为 `dessalines/lemmy:0.19.5` 。如果需要额外的步骤，这些步骤会在相应的发布公告中解释。

更改配置文件中的版本号后，在 Lemmy 的目录下执行以下命令：

```bash
docker compose pull
docker compose up -d
```

## 完成

配置完反向代理访问域名，我们即可看到 Lemmy 的初始化页面。
