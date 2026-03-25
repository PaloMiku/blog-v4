---
title: 浅谈个人与 Fediverse 的过往历史和现状
date: 2025-05-20 08:30:00
description: 本文介绍了作者2023年踏入Fediverse的完整历程，从Firefish、纷语驿站到现居Sharkey实例Circlari；本文记录了Misskey、Firefish、Sharkey三大程序的特点与兴衰，并对比Mastodon生态；本文分享了联邦宇宙去中心化、低门槛、跨实例互通的优势，也坦言用户暴涨带来的治理挑战，为新人提供选型与避坑参考。
categories: [联邦宇宙]
tags: [Fediverse,Misskey]
image: https://blog-files.101045700.xyz/Fediverse/fediverse-lila.webp
recommend: 3
---

## 前言

这应该是我博客重新整合后第一次提起 Fediverse，在之前旧博客也有几篇博文有提到这些，但在博客搬迁时丢失的丢失，删除的删除，总之 :tip[大概就是没有了]{tip="这体现了数据备份的重要性"}。

今天这篇文章简单讲讲个人和 Fediverse 吧。

## 历史

个人应该是 23 年踏入的 Fediverse，当时是朋友 :tip[Ice Year]{tip="个人 Fediverse 领路人，包括后提“轻社区”和纷语联合维护者"} 安利进入的，最早是参与已经似掉的一个轻社区建设项目。

当时使用的程序是 :tip[Firefish]{tip="基于 Misskey 的分支版本，现在已经不再维护。"} ，最早只是觉得它很漂亮才去用的，并没有参与 Fedi 社交的感觉。

当时简中这边有关 Misskey 系列的实例和生态都可说比较少见，所以实际上当时还算是 :tip[比较潮流]{tip="看什么新用什么"}吧。

::pic
---
src: https://blog-files.101045700.xyz/Fediverse/2025/Flojoy.webp
caption: 纷语驿站留存的截图，出于隐私保护和其他考虑已处理掉部分信息
---
::

后来那个实例似掉了，然后又有了 :tip[纷语驿站]{tip="23 年上线，应该 24 年暴死的？记忆有些模糊了，现在依旧可以在一些较老的实例里检索到其过往贴文和用户信息"}，虽然也似了吧。

纷语后来的暴似可以说更加可惜，纯属程序不稳定外加当时维护组经验不足，未能及时恢复运行，拖到最后完全无法修复，只能成为一座墓碑。

这两年也有用过自己维护一段时间的“极光星“，友人维护的“轻语湾”等，都是基于 :tip[Sharkey]{tip="基于 Misskey 的分支版本，添加部分特性等，目前绝赞维护中"}建设。

后来自己也在 Misskey 实例 :tip[鸟白岛 Torishiro]{tip="没错，就是 Summer Pockets REFLECTION BLUE 里那个鸟白岛"}建号和活跃了一段时间。

最后大概是定居到了现在的 [Circlari](https://circle.tkg3.top)，由我和朋友 :tip[辰灿汐]{tip="轻语湾站长，在前几个包括纷语在内的社区也是联合维护者"}联合维护，希望 Circlari 能够平安的走下去。

## 介绍

先简单介绍下前文所提到的三个 Fediverse 程序，他们都是基于 :tip[ActivityPub 协议]{tip="基于 Pump.io 的 ActivityPump 协议的一个开放源代码、去中心化的通信协议。"}的。

### Misskey

开发工作由日本开发者 Syuilo （しゅいろ）开始于2014年。

::pic
---
src: https://blog-files.101045700.xyz/Fediverse/MisskeyHome.png
caption: Misskey 官网，绝赞可爱捏
---
::

在最初开发时， Misskey 的主要功能是网络布告板（BBS），最初它也并不是一个去中心化的服务，但是通过在2018年实现 ActivityPub 协议，这使 Misskey 实现了去中心化，并受到了更多人的认可和使用，一直延续至今。

::alert
Misskey这个名称，来自开发者Syuilo当时正在热衷于听的艺术家May'n的歌曲《Brain Diver》的歌词。
::

自那以后，任何人都能参与开发 Misskey 了，直到现在，其开发工作仍然在积极进行当中。

要论个人对 Misskey 的印象，Misskey 是一个相当友好的 Fediverse 程序，其操作难度和部署占用等远低于前辈 :tip[Mastodon]{tip="简中也称“长毛象”，同样基于 ActivityPub 协议的 Fediverse 程序，比 Misskey 出现晚但加入 ActivityPub 早"}，个人感受上论起功能性和 UI 界面是强于长毛象的，个人推荐新人 Fediverse 站长和用户都去使用它，~~当然我不是歧视长毛象，只是 Misskey 真的个人感觉更为简单一些。~~

### Firefish

开发工作始于2022年，基于 Misskey 的魔改分支版本， :tip[已经不再维护]{tip="2025年2月已完全终止维护，程序主站已停止运行"}，其一些魔改甚至影响到了现在的 Misskey 功能和设计。

::pic
---
src: https://blog-files.101045700.xyz/Fediverse/2025/Firefish.webp
caption: 个人在 Firefish 时期留存的截图（当时个人网名与现在也有不同），已处理部分信息
---
::

Firefish 可以说在 Misskey 早期时候是相当不错的分支版本，与 Misskey 有一些设计不同， :tip[一些功能在当时对比 Misskey 还是有很大区别的]{tip="比如 Misskey 在今年4月才加入 Beta 的聊天功能，在很早之前的 Firefish 已经出现"}。

Firefish 的结束维护也有一段很难说的故事，我虽然有记忆但难以整理写出来，有兴趣可以自己去查一下。

现在 Fediverse 仍有部分实例在运行着 Firefish，简中实例代表应该是 DVD Chat。

个人还是喜欢 Firefish 的一些理念和设计的，对它结束维护感到真挺可惜的，现在已经运行最新版 Firefish 的可以通过降级后迁移其他 Misskey 程序。

### Sharkey

具体什么时候开始开发的个人已难以考据，它也是基于 Misskey 的分支版本， :tip[现在相比 Misskey 的最大特色]{tip="Sharkey 在早期相比 Misskey 有着许多突出变化和优势，随着 Misskey 的更新，已逐渐追平"}应该是“兼容 Mastodon 的 API，包括 OAuth2”。

::pic
---
src: https://blog-files.101045700.xyz/Fediverse/2025/Circlari.webp
caption: 现在的 Circlari 是基于 Sharkey Stelpolva 运行的
---
::

总体来说作为 Misskey 系的分支版本可能对 Mastodon 系兼容会更好，开发相对激进，现在用户量也不少。

## 个人，与联邦宇宙

### 个人

认真谈无法在这里谈太多原因，个人更多是把它作为微博客来使用的，分享些许短篇生活方面的帖子等，也能够通过它与更多联邦宇宙中的人进行交流。

个人也无法忍受中心化平台所带来的一些问题等。

### 联邦宇宙

联邦宇宙的使用没有门槛！你只需要有某一个实例的账号，就可以关注、评论、点赞其他实例上的用户及其文章。

这些账号的域名不一样也没有关系，只要 :tip[使用协议相同，就能通信]{tip="协议不同也不是完全不能通信，比如 Bluesky（AT协议）和 ActivityPub 协议程序之间也有人维护了连通网站，本质是转换协议的机器人账号"}。

加入联邦宇宙的门槛并不高，除了有开放注册的大量实例外，自己也可以轻松自建实例加入它。

相对于传统平台的所有人“共聚一堂”，联邦宇宙以各个实例为点，连点成线。

:tip[如宇宙中的星星之间，互相联系和通讯]{tip="那么中继应该就是空间站了，乐"}。

## 现状

因为某些平台的抽象操作，联邦宇宙在这两年的用户上涨速度飞快。

::pic
---
src: https://blog-files.101045700.xyz/Fediverse/2025/FediDBHome.webp
caption: 数据来自 FediDB，图片截取日期为 2025年5月20日
---
::

在程序用户占比方面，截至目前， :tip[老大哥 Mastodon 的用户占比为 72.2%，而 Misskey 的占比则为 1.2%]{tip="这里对比不是很公平，Misskey 这里不包括 Misskey 的分支版本，而 Mastodon 的分支版本很少"}

总之来说，看到这个趋势我是感到喜忧参半的，喜的当然是用户越来越多，但忧的也是用户越来越多。

早年的联邦宇宙小的时候， :tip[可能秩序还好一些]{tip="实际上联邦宇宙本身特性就注定了它的一些问题"}，现在除了新增用户大量涌入单一实例外，也要小心部分无规则用户，对于只是想简单交流的我，最大感受就是实例管理上黑名单越来越长。
