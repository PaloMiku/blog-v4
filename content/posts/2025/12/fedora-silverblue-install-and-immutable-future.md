---
title: Fedora Silverblue 安装记录和不可变 Linux 个人杂谈
subtitle: 这就是未来！既见未来，为何...不好意思走错了😅
date: 2025-12-10 05:00:00
description: |
   本文记录了作者由 Steam Deck 上的 Bazzite 体验延伸，深入探索 Fedora Silverblue 这一原子化不可变发行版的使用心得。文章首先提供了详细的“入坑指南”，涵盖从镜像刻录、系统安装到 Flathub 配置及 GNOME 扩展推荐的全流程，并总结出“优先 Flatpak、次选 Distrobox 容器、最后才用 rpm-ostree 叠加”的软件管理逻辑。

   在技术探讨部分，作者生动地解析了不可变系统的核心优势。不同于传统的 A/B 分区，Silverblue 利用类似 Git 的 ostree 机制实现了版本控制与高效存储。文章指出，不可变系统并非剥夺控制权，而是通过锁定系统核心、解耦应用层，有效剥夺了用户“搞坏系统”的风险。结合 OCI 容器镜像技术，用户甚至可以像写代码一样“定义”自己的操作系统。这种极度稳定且易于维护的形态，极有可能是 Linux 桌面的未来主流。
categories: [技术探索]
tags: [Fedora,Linux]
image: https://blog-files.101045700.xyz/2025/12/fedora-silverblue.webp
recommend: 1
---

## 前言

前段时间看见有人说：“容器化和原子化不可变（Immutable）Linux 极有可能是 Linux 桌面系统的未来主流形态。”

这倒是让我感到有些新鲜，我之前已经对这方面略有了解了。也曾经使用过“不可变发行版”，比如我手头的 Steamdeck 上的 SteamOS，它于个人用户来说其实确实做到了一句话：“到手即用，玩家只管玩游戏，不用担心系统滚挂，一般也不必担心需要自己处理各种系统层级上的问题。”

然后前段时间因为我对系统层级的不当操作，我 Steamdeck 上的 CachyOS Handheld 声卡软件层级方面炸掉了😢，我查询资料也没有解决这个问题，遂打算重装系统，在重装新系统时，这次其实是打算选择一些稳定的体验的，但是我个人并不是很想继续在触屏设备上使用 KDE Plasma 了。

KDE 很好，但对触屏来说个人感觉不如 GNOME 更加开箱即用，更别提 CachyOS Handheld 在 KDE 桌面环境下会因为 Wayland 而无法使用 Steam Input 键盘输入中文内容而丧失了一部分屏幕键盘体验。

是的，SteamOS 在 5202 年哪怕它的 KDE Plasma 版本已经更替到最新的 6.x，却还在继续使用 X11 模式运行，所以没有做 Wayland 适配的它在第三方发行版上就很抓瞎，无法正常使用中文输入。

所以说这次我为我的 Steamdeck 更换系统为 Bazzite，它也是类似 SteamOS 的游戏发行版，底层是 Fedora Silverblue，选择了 GNOME 作为桌面环境。

安装后的体验其实出乎意料的还不错，对于只是拿 Steamdeck 打游戏的用户来说，它真的已经足够了，预装跟 SteamOS 一样的`Gamescope`等组件，并且也有便捷的 `ujust`可以用，相比 SteamOS 它其实是为了适配更多掌机和设备存在的。

那么结合这次还算愉悦的体验，我重新燃起了对 Fedora Silverblue 的兴趣，并且打算从一个基本的个人用户角度（比如我只想用 Linux 上网、看视频、办公、写代码，打游戏，不想折腾系统），来简单写一下在 2025 年使用它的体验，也来看看这个“未来主流形态”对于现在的 Linux 用户来说是否触手可及。

不可变，原子更新的发行版其实也很多，甚至 NixOS 也可以包括在其中，但我选择 Fedora Silverblue 更多是考虑它的易用性和文档资料以及社群的完善性，结合我个人也算是比较熟悉 Fedora 的用户所以做出的一个综合选择。

首先本文会先介绍 Silverblue 的安装记录等，如果你对个人后面有关不可变系统的个人杂谈更感兴趣可以[点此直接前往](#原子化不可变linux的未来和个人杂谈)

## 下载和刻录启动盘

获取 Fedora Silverblue 的镜像非常简单，前往 Fedora 官网就能下载，理论上它还可以自动到国内的镜像站下载镜像（当然，理论上是离你最近，但不一定是最快的镜像站😅）

Silverblue 官方（zh-Hans）介绍页：https://www.fedoraproject.org/zh-Hans/atomic-desktops/silverblue/

实际上还有基于 KDE Plasma 的 Fedora Kinoite 可以选择，如果你更喜欢 Windows 风格的 KDE 桌面，也可以选择它，和 Silverblue 一样，它也是旗舰发行版，可以获得的支持并不比 Silverblue 少，在下文大部分在 Silverblue 使用的特性等它一样是可以使用的。

Kinoite 官方（zh-Hans）介绍页：https://www.fedoraproject.org/zh-Hans/atomic-desktops/kinoite/

在国内的大部分校园镜像站，比如 [北京外国语大学开源软件镜像站（bfsu）](https://mirrors.bfsu.edu.cn/)，[中国科学技术大学开源软件镜像站](https://mirrors.ustc.edu.cn/) 也都可以轻松下载到 Fedora Silverblue 的 ISO 镜像文件。

获取镜像以后使用 Ventoy，Rufus 或者官方的 Fedora Media Writer（多平台支持，可视化刻录，自动下载 Fedora 版本镜像）都可以轻松刻录并准备好一个你自己的 Silverblue 安装启动盘。

## 安装

Silverblue 使用的是传统的 Anaconda 安装器，不是基于 Web 的，邪恶的，高占用的 Anaconda WebUI 安装器。当然，也没有 LiveCD 试用。

Anaconda 的安装器并不难用，新版的 WebUI 安装器个人也已经体验过了，简单是确实简单了一些，但是相比传统的 Anaconda 安装器它会残缺功能也是必然的，比如分区功能。

所以耐心等待部署完成，拔出 U 盘重启就好，目前的流程也不需要你在安装时调整用户信息，新建用户等是在安装完成进入系统后进行。

## 基本配置

### 镜像源与更新系统

Fedora 默认使用 [Metalink](https://zh.fedoracommunity.org/2018/04/05/fedora-secures-package-delivery.html) 给出推荐的镜像列表，保证用户使用的镜像仓库足够新，并且能够尽快拿到安全更新，从而提供更好的安全性。所以通常情况下使用默认配置即可，无需更改配置文件。

由于 Metalink 需要从国外的 Fedora 项目服务器上获取元信息，所以对于校园内网、无国外访问等特殊情况，Metalink 并不适用，而 Fedora Silverblue 在传统的 Fedora 上还要更特殊一层，它的系统更新管理器是基于事务处理的`rpm-ostree`，所以为它要使用的软件镜像源也是特殊的。

对于 ostree，目前国内似乎只有 SJTUG 提供了相关高校镜像仓库，可以查看[相关文档](https://mirrors.sjtug.sjtu.edu.cn/docs/fedora-ostree)替换 fedora-ostree 为国内高校源。

对于系统额外软件所使用的 rpm 软件仓库，若也需要替换，可以参见 [MirrorZ Help](https://help.mirrorz.org/fedora/)获取相关文档。

总之不论你是否配置了镜像源，都需要在第一次开机后更新一次系统，使用以下指令更新系统：

```shell
sudo rpm-ostree update
```

执行系统更新之后，还需要重启设备，应用系统更新。

```shell
systemctl reboot
```

### 配置 Flathub 应用商店

Fedora Silverblue 是只读系统分区，也一般不建议你使用传统的 rpm 软件包安装应用程序，除非确实没得选，官方更建议你使用 Flatpak 来安装应用程序。

打开 GNOME 应用商店，会提示你是否配置“第三方软件仓库”，也就是 Flathub，所以我们选择是，错过了也没关系，我们使用以下指令也可以添加官方的 Flathub 软件商店：

```shell
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
```

一般来说如果没有什么对国际互联网访问问题，我们不需要配置 Flathub 国内源。

如果需要配置，参见 [MirrorZ Help 的 Flathub 文档](https://help.mirrorz.org/flathub/)来替换 Flathub 远程源为国内的高校镜像源。

如果配置完成后应用商店未刷新，可以注销重新登录或手动杀死相关进程解决。

## 安装 GNOME 扩展（可选）

GNOME 的一些默认逻辑是比较“极简”的，甚至可以说“极简”过了头，有一些东西个人感觉本身其实就是应该要有的，我们安装一些 GNOME 扩展可以缓解一些问题。

在应用商店搜索 Extension Manager，也就是 GNOME 的扩展管理器进行安装，安装后在“浏览”里就可以搜索我们想要的扩展，在“已安装”来管理我们安装的扩展。

列出一些个人比较推荐的扩展，可以按自己的需求选择安装。

| 扩展名称                                                                                                             | 个人建议 | 个人介绍                                            |
| ---------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------- |
| [AppIndicator and KStatusNotifierItem Support](https://extensions.gnome.org/extension/615/appindicator-support/) | 必装   | 如果你需要应用能够显示托盘图标，那么这个扩展它是必不可少的。                  |
| [Caffeine](https://extensions.gnome.org/extension/517/caffeine/)                                                 | 可选   | 安装后可以在控制中心开关功能，暂时让电脑停止睡眠操作，需要长时间挂机开启屏幕的时候是个好主意。 |
| [Night Theme Switcher](https://extensions.gnome.org/extension/2236/night-theme-switcher/)                        | 可选   | 增加了按时间自动切换主题浅色或深色模式以及切换相关壁纸的功能。                 |
| [Gtk4 Desktop Icons NG (DING)](https://extensions.gnome.org/extension/5263/gtk4-desktop-icons-ng-ding/)          | 可选   | 增加了桌面图标的功能，可以把程序图标或文件放在桌面上。                     |
| [Clipboard Indicator](https://extensions.gnome.org/extension/779/clipboard-indicator/)                           | 可选   | 增加了剪贴板历史管理的功能，可以在导航栏快速管理剪贴板的历史，快速复制粘贴。          |
| [Blur my Shell](https://extensions.gnome.org/extension/3193/blur-my-shell/)                                      | 按需   | 视觉类改进，主要是增加毛玻璃效果，会影响设备性能，一般来说不在乎这个视觉美化可以不要。     |

总之个人推荐的扩展大概就这么几个，建议可以把系统自带的 App Menu 扩展也启用，快速在导航栏启动应用。

## 安装应用

我们从多个方面来选择安装我们需求的应用，聊天，影音，娱乐等，下文提及的大部分应用都可以在 Flathub 商店找到并安装，个人会适当列出推荐它的观点。

另外我们前面也说过，Fedora Silverblue 它不推荐你使用 RPM 软件包安装应用，但其他方式实在不便解决的情况下，也可以使用官方 RPM 软件包仓库或 RPM 二进制文件来往上“叠加软件包”，安装或卸载软件包后都需要重启系统才能应用更改。

不负责地随便叠加软件包可能会造成系统破坏，并可能阻止系统更新以及带来其他问题，直到冲突的叠加软件包被卸载，所以一般能不叠加就叠加。

可以说这是“最后手段”或者是需要安装的应用需要更系统级别的一些操作。

```shell
# 从 fedora 官方 rpm 软件包仓库安装应用
rpm-ostree install <package>
# 从 fedora 官方 rpm 软件包仓库搜索应用
rpm-ostree search <package>
# 从本地指定的 rpm 文件安装应用
rpm-ostree install <package>.rpm
```

### 系统工具

#### Flatseal

我十分建议你首先安装 Flatseal 这个程序，它可以细分管理 Flatpak 安装的所有程序和进行相关高级设置，非常有用。
![](https://dl.flathub.org/media/com/github/tchx84.Flatseal/584b6d86e2e87883119101ce97cfd94f/screenshots/image-1_orig.webp)
#### File Roller

GNOME 的可用的压缩包归档管理器是作为一个外置程序的，需要单独安装，不安装的话你无法预览和管理压缩包里的内容，不过 File Roller 也是比较简单的，如果有进阶的压缩包管理需求可以选择 Peazip 作为压缩包管理器。

![](https://dl.flathub.org/media/org/gnome/FileRoller/c1c2abe9b7a778fcc7c1722f356db6d2/screenshots/image-1_orig.webp)
#### Distrobox & DistroShelf（可选）

虽然折腾多了可能会让硬盘吐槽，但你也能借助 Distrobox 来建立一个虚拟环境，使用其他发行版的可用应用或者把应用安装在 Fedora 标准容器里，拥有的自定义空间更大一些。

执行以下命令以叠加部署 Distrobox 软件包在系统（容器环境需要的 Podman Fedora Silverblue 本身就依赖，无需额外安装）

```shell
rpm-ostree install distrobox
```

然后在应用商店搜索并安装 DistroShelf 并安装。

![](https://dl.flathub.org/media/com/ranfdev/DistroShelf/c34593748b95465e2c25338cddee2bee/screenshots/image-1_orig.webp)
### 音视频

#### VLC

视频播放器个人首推 VLC，开源，经典，好用。

![](https://dl.flathub.org/media/org/videolan/VLC/7bbc1978ff44590e9fd3f3f1a112c620/screenshots/image-1_orig.webp)

#### Gapless

GTK 编写的，漂亮的音乐播放器，不过如果没有这个整理曲库要求，其实 VLC 就能包办视频和音频的播放了

![](https://dl.flathub.org/media/com/github/neithern.g4music/577f9997d1928d5ba60cf833461c1d24/screenshots/image-1_orig.webp)

#### Amberol

Amberol 是一个没有宏伟妄想的音乐播放器。如果您只想播放您的本地系统上可用的音乐，那么它就是你正在寻找的音乐播放器。

![](https://dl.flathub.org/media/io/bassi/Amberol/dc100a9f00e5ad245af203b4810380c4/screenshots/image-1_orig.webp)
### 应用安装总结

其实我觉得我继续列流水账没什么意义，有什么需求自己在应用商店和网上发掘才是更好的选择，如果你真的有相关疑问也可以在评论区等地方和我聊聊，我会尽我能力解答，但我希望这是结合你在应用商店和互联网搜索之后发出的提问。

总之尽量是先从 Flathub 安装，然后是 Distrobox 以及 Homebrew 甚至是 Appimage，最后才是 rpm-ostree 安装。

## 原子化不可变Linux的未来和个人杂谈

说回文章开头的那个观点，有人说容器化和原子化不可变（Immutable）Linux 极有可能是 Linux 桌面系统的未来主流形态。

从我现在个人的角度看，我也是逐渐认同这个观点的，我要加上的附加条件是“对于大众的桌面系统未来”，为了理解下它为什么是“对于大众的桌面系统未来”，我们就需要先理解它是什么。

传统的 Linux 系统就像一个**积木城堡**。你可以随时拔掉底部的积木换上新的，或者把它们涂成别的颜色。

这种方式灵活性很高，但如果你拔错了积木，城堡就会倒塌。

更新系统时，也就类比了城堡的积木也一块一块积木替换，如果在替换过程中断电，城堡可能就会变得畸形甚至也会倒塌。

有关这个我们可以从 Android 和 SteamOS 以及 ChromeOS 上看到一些东西：A/B 系统分区。

平时你都在使用 A 系统（主用分区），B 系统（备用分区）处于休眠状态，在更新时系统会在后台悄悄地把新的升级包解压、安装到 B 系统的分区里，完全不影响你正在使用的系统和任何应用。

重启应用更新只是让引导程序单纯把主要引导转向了 B 分区，从 B 分区启动了全新的系统，下次更新也是这样，来回替换。

最终的替换引导完成是在更新到达结束的时候，就算更新的过程中突然断电，也不会影响主要系统的正常工作，最多就是重新往 B 分区重建和替换文件。

所以不可变发行版也是一样的，你的系统文件装在一个不仅封死还上了锁的盒子。

系统的核心文件是只读的（Read-only），不能直接修改，更新系统的时候直接拿新盒子替换掉旧盒子，你对新盒子如果有问题或者不满意，你随时可以直接换回旧盒子，这也就是回滚。

应用程序都外挂在盒子外部，不会影响到盒子本身关键核心的内容。

所以说对于普通用户来说，这是绝对安全的方式，他们一般也不会像极客玩家那样需要修改系统的内核环境，调整系统文件啊等等，这样的更新方式对他们来说非常合适。

SteamOS 也就是不可变发行版的成功案例之一，普通的用户们不用再去考虑系统改动的安全性，因为他们不需要处理核心的部分，到手打开就能玩，不用担心系统滚挂。

不过还是来看 SteamOS 的这套不可变发行方式，它是 A/B 的分区，这特别坚固，作为物理的两个分区，哪怕一个分区彻底爆炸了，另一个分区还是可以正常启动。

它确实非常安全了，但是我的空间呢？双倍系统分区就是双倍系统文件占用空间，而且它只有两个分区也意味着只有两个版本，如果我想回到上次的上次安装的版本，这样的方式就无能为力了。

所以我们回到今天的主角，Fedora Silverblue，它的 ostree 机制其实更加特殊，它有点类似于 Git，实际上是一个分区，只不过通过一个清单区分新旧系统。

比如新系统是由 A，B，D 等文件组成的，旧系统是 A，B，C 等文件组成的，这样其中的 A 和 B 就能直接被复用，不需要再重新下载，就像 Git pull 一样，只是下载了变动的部分。

这样是不是就更节省空间了？不同的版本只是借助文件系统的技术硬链接虚拟出来的不同文件目录树，它并不是单纯的软件包目录树。

总之这种方式算是一种很节省空间的方式，而且你可以自己决定要保留多少旧版本，而不是像 AB 分区那样只有新和旧版本。

当然也是存在“一锅端”的风险的，比如这一整个分区炸了，那就真是炸了，而不是像 A/B 分区那样只是 A 或者 B 炸了都至少还可以用。但考虑到它的灵活性优势，对于个人电脑来说，可以说收益大于风险。

那你一定又想问了，那我一直更新不是也会不停保留旧版本文件吗？这样不是更费空间了？所以 ostree 其实也是存在很严格的“垃圾回收”的，只会保留多少个版本，一旦某个超出这个数量然后被删除的旧版本里的某个文件在目前保留的版本里彻底用不到，它就会被彻底删除，绝对浪费不了你的硬盘空间。

当然，你可以标记你觉得好用的版本，可以一直留着它，这是你的主动选择，系统尊重你的选择不会主动清理它，过去多少个版本也是这样。

所以这里其实又有了一个有趣的事情，实际上原子化的 Linux 甚至比传统 Linux 的还干净，它不需要本地有软件包缓存，因为他是直接按照清单下载文件流到仓库，不会有什么 deb，rpm 这种中间级别的压缩包，没有软件包缓存堆积，肯定更干净一些。

而且，关键还是系统目录是只读的，那些软件不能在里面随便乱写乱画，不会产生莫名其妙卸载也清不掉的配置文件和垃圾，配合自动清理机制，可以说留下来的都是对你来说有用的东西。

然后，你可能又又想问了：“我在系统内`rpm-ostree install`叠加上去的软件包算什么，ostree 又是怎么处理它的？“

我举个生活点的例子。

假如今天是肯德基疯狂星期四，你 V 我 50 我去买了肯德基的汉堡，薯条，可乐，把他们放在桌子上。

那么现在汉堡就是官方的基础镜像，它就是标准的样子，一般来说它是只读（吃）的。放旁边的薯条和可乐就是我通过 Flatpak 或者 Distrobox 安装的应用，他们是独立于汉堡的，不会影响汉堡本身，我随时都可以吃。

看着手里的汉堡，我觉得这汉堡它不够味，去找老爹汉堡店猛猛往里面加料又重新烤了一遍，这就相当于是我`rpm-ostree install`又干的事情，加的各种料（自定义叠加的软件包）它成为了汉堡新的一部分，我对此非常满意，“就是这个味！”

“下载，解压和重组，生成新的文件树，重启应用新的文件树更改”。这是最简单的一句话解释。

凡事都是有代价的，这样做的后果相信你通过上面的生活例子已经能看出来了，我每次拿到肯德基的标准的汉堡都要重新再去处理加料，这就相当于让我为此忙活（更新系统）的时间要更长了。

叠的越多，处理更新时间就越长，甚至最后可能因为依赖冲突导致更新失败（汉堡料加太多或者太高做坏了，又或者口味冲突了），只能卸载冲突依赖（减少用料量）来解决更新失败问题。

但是我又有时候不得不这么做，比如肯德基的标准汉堡里面可能就是没我想要的料呢？我就是很想要或者必须吃那个料。

换到应用上，就是比如 N 卡驱动，或者对于广大 Linux 用户要用的国际飞行应用那确实没办法（不装在系统层可能拦截不了流量），或者你每天都会用到的 CLI 工具，比如 Bash 和 Zsh 等，你就只能用 rpm-ostree 叠加上去了。

当然，这种时候实际上就有了新的东西了，自己定制。

拿肯德基例子打比方...你都自己起汉堡店了或者说换配方了，没有二道处理了（

现有的 Silverblue 就是把整个系统打包成 OCI 容器镜像，跟 Docker 镜像差不多，这样的话，基于此定制的成本就低不少了。

我只需要写一个类似`Dockerfile`的配置文件就能基于官方定制我自己的....

不是哥们，我没拿错稿子吧，这是 Fedora Silverblue 吧？这不是 NixOS 的稿子对吧😅（

咳咳，其实 NixOS 和这个不大一样，它定制的话是你自己处理配方，没有云端处理。不过它也不在本文讨论范围，我们接着往下说。

自己定制的玩法在隔壁也是 Silverblue 的 Bazzite 上就能看到模板了。

Fork Bazzite 的 GitHub 模板仓库，改一改配方文件，比如里面写着：`FROM fedora-silverblue`，然后我们加上新的 `RUN dnf install zsh fastfetch -y`作为我的定制，GitHub Actions 会自动给我构建好这个定制的镜像然后推到 docker 仓库去，然后我在我电脑上直接 `rpm-ostree rebase PaloMiku/KFC-VME50-OS:stable`就能换到我定制的这个新系统，不需要再去本地处理叠加新的包了，你想要的包已经打包好送过来了。

这样就可以实现多机同步，快速部署，解决“依赖地狱”，Git Commit 版本控制，非常干净的本地环境（所以说我拿的是 Fedora Silverblue 的稿子，对8？）等优势了。

总结一下就是，不可变发行版和相关的概念并不是你想的那么简单，它能够成为未来的主流绝对不是它单纯“简单”。

不可变的 Linux 他并不是在剥夺你控制系统的自由，它是在剥夺你“把系统搞坏”的自由。

他不是单纯的炫技，它能解耦，它更安全，它让我们只需要“定义”而不是“维护”它。

对于新手，你可以尽情拥抱 SteamOS 和 Fedora Silverblue，你不需要理解这里面的技术细节，享受它的稳定就好。

对于开发者，习惯于使用 Distrobox 等容器，不再污染宿主机，未来的你和你的电脑都会感谢你。

现在的不可变系统可能会让你觉得被束缚，但是它带来的好处，绝对值得你去改变十几年的使用习惯。

感谢你看到这里，希望你能在这里有新的收获！
