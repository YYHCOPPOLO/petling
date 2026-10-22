# Petling

基于 QQPet 重构的 Windows / macOS 桌面宠物，使用 Electron、TypeScript 和 Ruffle。当前应用名称为 AgentPet。

## 功能

- 领养、成长、喂食、清洁、治疗与复活。
- 宠物动画、拖拽、点脸互动、多屏移动和托盘菜单。
- 商城、购物车、背包、玩具与背景装扮。
- 学习、升学考试、打工及活动进度恢复。
- 可选 AI 聊天、基础设置与存档导入导出。
- 本机持久化对话、性格与手动记忆；聊天任务可查看、取消和中断后继续。

基础养成无需 AI 或网络。旅游、农场、社区、签到任务和复杂小游戏已归档，不参与运行构建；旧存档继续兼容，资源包已按基础功能依赖精简。

## 本地运行

建议使用 Node.js 24，并安装 Git LFS。当前宠物素材为 3,673 个文件、约 98 MiB，通过 Git LFS 管理。

```sh
git clone https://github.com/YYHCOPPOLO/petling.git
cd petling
git lfs install --local
git lfs pull
npm ci
npm run dev
```

首次启动选择宠物蛋；点击宠物打开动作栏，右键打开功能菜单。AI 默认关闭，可在设置中配置 OpenAI 兼容接口。

## 测试与构建

```sh
npm test               # 单元测试
npm run assets:audit   # 查看资源依赖和未引用文件
npm run build          # 资源检查、类型检查和生产构建
npm run test:desktop   # 当前平台的真实 Electron 回归
npm run test:packaged  # 打包后的当前平台程序回归
npm run dist:win       # Windows 安装包，在 Windows 上执行
npm run dist:mac       # macOS 安装包，在 macOS 上执行
```

安装包输出到 `dist/`。宠物存档位于应用数据目录的 `AgentPet/save.json`，导出默认排除 API Key。身份、记忆和对话独立保存在 `companion.sqlite`；宠物重生时保留，现有宠物导出不包含该数据库。

GitHub Actions 在推送和 PR 时自动检查并打包 Windows/macOS。推送与包版本一致的 `v*` 标签后，全部平台验证通过才发布 Release，附安装包、SHA256 和源码提交清单。当前 Windows 未签名、macOS 为 ad-hoc 签名且未 notarize。版本发布和权限说明见 [发布文档](docs/releases.md)。

## 文档与来源

[产品需求](docs/product-requirements.md) · [性能要求](docs/performance-requirements.md) · [重构评估](docs/agent-refactor-assessment.md) · [基础重构](docs/basic-refactor.md) · [架构说明](docs/architecture.md) · [验证记录](docs/verification.md) · [资源替换](docs/assets.md)

目前已实现 M0 的[状态托管与可靠命令](docs/m0-state-host.md)及[身份、记忆和聊天任务持久化](docs/m0-companion-store.md)。工具执行循环、外部 Agent、凭据迁移、完整备份和性能基线仍待完成。

基于 [AnkioTomas/qqpet](https://github.com/AnkioTomas/qqpet)，代码采用 [GPL-3.0-only](LICENSE)。QQ 宠物美术及 SWF 等资源的版权和来源见 [第三方声明](THIRD_PARTY_NOTICES.md)。
