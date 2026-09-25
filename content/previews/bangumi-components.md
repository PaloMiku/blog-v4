---
title: Bangumi 组件展示
date: 2025-12-30 12:00:00
---

## 说明

本文用于展示 [bangumi-clarity](https://github.com/) 模块提供的全部组件：条目卡片（五种类型 + 矮身形态 + 错误态）、放送日历、收藏列表。数据来自模块自带的 Worker 节点，走真实 Bangumi API。

## 条目卡片（`::bgm-card`）

按条目类型自动匹配形态：动画 / 书籍 / 音乐 / 游戏 / 三次元。音乐类型带 CD 侧封竖条与艺术家署名。

### 动画

::bgm-card
---
id: 219200
---
::

### 书籍

::bgm-card
---
id: 114189
---
::

### 音乐

::bgm-card
---
id: 616
---
::

### 游戏

::bgm-card
---
id: 13
---
::

### 三次元

::bgm-card
---
id: 30619
---
::

## 矮身形态（文章内嵌用 `compact: true`）

完整信息、更低高度，适合文章末尾「相关条目」区。

::bgm-card
---
id: 219200
compact: true
---
::

::bgm-card
---
id: 616
compact: true
---
::

## 错误态

Bangumi 对未登录的 R18 条目详情接口返回 404，卡片会展示「未找到该条目」并提供重试按钮（示例：拔作岛 游戏）。

::bgm-card
---
id: 243475
---
::

## 放送日历（`::bgm-calendar`）

近 7 天放送安排，今天高亮；可切换「全部 / 仅在看」。

::bgm-calendar
---
filter: all
---
::

## 收藏列表（`::bgm-collection`）

分类 × 状态的收藏网格，带进度 / 评分遮罩与「加载更多」。

::bgm-collection
---
cate: anime
type: watched
---
::

::bgm-collection
---
cate: music
type: watched
---
::

以上第二个列表当前为空（「听过」暂无数据），用于展示空态。
