<p align="center">
  <img src="build/icon.png" width="112" alt="AgentPet" />
</p>

<h1 align="center">AgentPet</h1>

<p align="center">一只住在桌面上的 QQ 企鹅：会饿、会撒娇，也会陪你慢慢长大。</p>

<p align="center">
  <a href="https://github.com/YYHCOPPOLO/petling/releases/latest"><strong>下载最新版本</strong></a>
  &nbsp;·&nbsp;
  <a href="#快速开始">快速开始</a>
  &nbsp;·&nbsp;
  <a href="#常见问题">常见问题</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/YYHCOPPOLO/petling/issues">反馈问题</a>
</p>

AgentPet 是一款 Windows / macOS 桌面宠物，基于开源项目 [AnkioTomas/qqpet](https://github.com/AnkioTomas/qqpet) 重构。喂食、洗澡、陪玩、上学、打工、逛商城都可以离线完成，不需要账号。也可以接入任意 OpenAI 兼容接口，让它用本机保存的性格和记忆陪你聊天。

> 当前为早期版本：基础养成和桌面互动已经可用；Agent 任务、笔记提醒、文件整理等能力仍在开发中。

## 功能

- **养成**：成长升级，饥饿、清洁、健康、心情，喂食、洗澡、吃药、玩具，生病与复活。
- **学习与打工**：上课、考试升学；按学历和属性找工作，赚取元宝。
- **商城与背包**：购买食物、日用品、药品、玩具和背景，购物车结算，背包直接使用。
- **桌面互动**：透明置顶、拖拽移动、边缘探头、点脸互动、多显示器、托盘菜单。
- **可选 AI 聊天**：本机保存性格、称呼、记忆和历史对话；回复任务可取消、中断后继续。
- **个性化**：透明度、高清画质、音效、免打扰、开机自启、隐藏宠物、暂停成长。

旅游、农场、社区、签到和复杂小游戏已归档；旧存档仍可读取。

## 下载与安装

前往 [Releases](https://github.com/YYHCOPPOLO/petling/releases/latest) 下载。支持 Windows 10 及以上（x64）和 macOS Ventura (13) 及以上（Apple 芯片 / Intel）；Windows 使用 `.exe` 安装器，macOS 使用 `.dmg` 或 `.zip`。

**Windows**：运行安装包并按提示安装。当前版本没有代码签名，若出现 SmartScreen 提示，点“更多信息 → 仍要运行”。

**macOS**：打开 DMG，把 AgentPet 拖入“应用程序”。首次启动若提示“无法验证开发者”，到“系统设置 → 隐私与安全性”点“仍要打开”，或右键应用选择“打开”；仍被拦截时可执行：

```sh
xattr -dr com.apple.quarantine /Applications/AgentPet.app
```

Windows 安装包未签名；macOS 为 ad-hoc 签名且未 notarize。出现系统安全提示属正常，请只从本仓库 Releases 下载。

## 快速开始

1. 启动后选择一颗企鹅蛋（男生或女生）；已有存档可点“导入存档”。
2. 单击宠物打开动作栏，右键打开功能菜单；按住拖动可移动，拖到屏幕左右边缘会探头。
3. 托盘图标也可以操作：左键查看状态，右键打开菜单。

| 操作 | 效果 |
| --- | --- |
| 左键单击宠物 | 打开动作栏（可在设置中关闭） |
| 右键单击宠物 | 打开功能菜单 |
| 按住拖动 | 移动宠物，可跨显示器 |
| 悬停 0.3 秒后点脸部亮点 | 触发互动动作（默认开启） |

动作栏包含：日常（食物、清洁、吃药、玩具）、交互（打工、学习、看病）、工具（商城背包、聊天、设置）和档案（宠物资料）。要完全退出，请用菜单里的“退出宠物”。

## AI 聊天（可选）

默认关闭，不配置也能使用全部养成玩法。打开 设置 → AI，填写 OpenAI 兼容接口地址（以 `/v1` 结尾）、API Key 和模型名称，点“测试并启用”。聊天面板有对话、任务、记忆和性格四个页签；对话与记忆保存在本机，回复任务可取消、中断后继续。

目前聊天只返回文本，不会操作电脑、喂食或修改文件。消息、性格和已保存记忆会发送到你配置的接口；API Key 只保存在本机。

## 数据与备份

Windows 数据目录为 `%APPDATA%\AgentPet`，macOS 为 `~/Library/Application Support/AgentPet`。

- `save.json`：宠物存档、设置和 AI 配置；导入或重生前会生成 `save.json.bak`。
- `companion.sqlite`：性格、称呼、记忆、对话和回复任务。

设置 → 存档 可导出/导入宠物存档（不含 API Key 和 `companion.sqlite`），也支持原版 QQ 宠物 `config.json`。完整迁移请退出应用后复制整个数据目录；卸载程序不会删除这些数据。

## 常见问题

**宠物不见了？** 查看托盘图标（Windows 可能收在 `^` 中，macOS 在菜单栏），或在 设置 → 全局设置 点“宠物不见了？点我试试”。

**点了宠物没有动作栏？** 设置里的“点宠物时显示动作栏”可能已关闭；右键宠物或托盘菜单仍可使用全部功能。

**如何更新？** 设置 → 关于 → 检查更新，会打开 GitHub 下载页；覆盖安装即可，存档保留。

**支持 Linux 或手机吗？** 目前只提供 Windows x64 和 macOS（Apple 芯片 / Intel）。

## 从源码运行

需要 Node.js 24（最低 22.16）、Git 和 Git LFS：

```sh
git clone https://github.com/YYHCOPPOLO/petling.git && cd petling
git lfs install --local && git lfs pull
npm ci
npm run dev
```

构建安装包：`npm run dist:win`（Windows）或 `npm run dist:mac`（macOS），产物在 `dist/`。

## 许可证

代码以 [GPL-3.0-only](LICENSE) 发布。QQ 宠物的美术资源和 SWF 版权归腾讯所有，本项目仅供学习交流，请勿用于商业用途；素材来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目是非官方重制，与腾讯无关联。
