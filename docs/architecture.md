# 桌面架构

## 当前范围

仅构建 Windows 和 macOS。保留 Electron + TypeScript + Ruffle，运行基础养成、动画、互动、背包商城、治疗装扮和学习打工。扩展玩法及相关适配器位于 `archive/legacy-gameplay/`，不在编译或打包入口中。已实现范围见 [基础版本重构](basic-refactor.md)，2026-10-21 确认的完整目标见 [产品需求](product-requirements.md)，实施路线见 [重构评估](agent-refactor-assessment.md)。

```text
src/core/pet/catalog.ts         基础商品和课程目录
src/core/pet/items.ts           使用、治疗、余额与整车购买规则
src/core/pet/activities.ts      学习打工、进度、离线恢复、考试判定
src/core/pet/interaction.ts     日常互动效果
src/core/pet/result.ts          业务结果、结构化错误、原子变化描述
src/core/pet/level.ts           成长等级与阶段
src/core/pet/commands.ts        JSON 命令注册、输入验证与统一执行业务
src/core/pet/clock.ts           成长、疾病、自动照料与游戏活动时钟
src/main/pet-host.ts            唯一状态宿主、可靠命令与状态广播
src/shared/pet-client.ts        串行调用与单调状态投影
src/main/index.ts              应用启动、单实例、退出保存
src/main/lifecycle.ts          桌面服务清理
src/main/services/ipc.ts       有来源校验的内部存档、桌面与网络操作
src/main/services/observers.ts 锁屏/空闲和返回问候
src/main/services/fullscreen.ts Windows 全屏检测辅助进程
src/main/window.ts             透明桌宠窗口
src/main/desktop.ts            多显示器和 DIP 坐标
src/main/save-repository.ts    无 Electron 依赖的存档仓库
src/main/save.ts               Electron 路径和旧存档迁移
src/main/assets.ts             资源包与路径映射
src/main/protocol.ts           app://bundle 本地资源协议
src/preload/index.ts           隔离的 window.qqpet 桥
src/shared/                    存档格式、IPC、网络与数值辅助
src/renderer/pet/commands.ts   基础业务的统一提交入口
src/renderer/pet/store.ts      已提交状态投影、桌面偏好批次与表现事件
src/renderer/pet/              动画路由、基础业务的表现适配
src/renderer/ui/               基础界面、日常动作栏与交互
src/renderer/swf/              宠物 Ruffle 播放器
resources/                    原始素材与资源包配置
archive/legacy-gameplay/       不参与构建的扩展源码和适配器备份
```

`window.qqpet` 保持内部桥名；应用身份、数据目录和打包标识使用 AgentPet。存档字段保留上游拼写，包括 `petComputedlInfo`，以兼容已有存档。

## 业务提交与表现

核心函数不依赖 DOM、Electron 或动画，输入当前存档，返回明确的成功数据与 `SavePatch` 或结构化错误。它们不修改输入。购物车校验、扣费和入库构成同一个结果；活动完成清理和奖励同样一起提交。

UI 的 `command()` 通过隔离桥提交 JSON 命令，主进程 `PetHost` 调用核心函数，状态和请求回执共同写盘成功后才返回结果。界面以递增 revision 接收状态投影，再通知面板和动画。模型台词与 SWF 不承担扣库存、治疗、启动课程或发奖励。

成长、疾病、自动照料与活动奖励已迁入主进程时钟。渲染层的 `save(patch)` 仅接受桌面设置、名字和位置，不能覆盖余额、库存或活动。所有业务命令在主进程读取当前状态并串行提交。持久化请求去重和迁移边界见 [M0 第一批](m0-state-host.md)；对外工具入口仍未开放。

## 存档与退出

桌面偏好每 200 ms 合并提交，游戏命令立即提交；主进程同步执行 JSON flush 与原子替换，写成功才更新权威副本。有限请求回执与游戏效果同次落盘，失败不会只扣物品而丢失回执。客户端 flush 等待已排队命令与设置。正常退出先 flush，再关闭服务；导入/重生更换存档 epoch、清理并重启。

旧扩展玩法数据保留并导出，不再推进或结算。进行中的旧旅行转存到 `saveJsonData.legacyTrip` 并释放活动占位。游戏内学习打工仍支持离线进度；暂停和死亡期间不会按离线时间发奖励。导出默认清空 API Key，本机配置不变。

`Lifetime` 管理定时器、系统事件、IPC 注册、托盘动画和全屏检测进程。窗口关闭和应用退出触发清理，重复清理安全。已移除剪贴板观察、前台应用查询辅助进程及独立小游戏窗口。

## 平台与资源

Windows 使用透明工具窗口和 PowerShell/Win32 全屏检测；辅助进程隐藏运行并随应用退出。macOS 隐藏 Dock 图标，输入面板打开时调整置顶层级，保持中文输入法候选窗口可见。

多显示器使用 Electron DIP 坐标，支持负坐标。拖拽按全局光标切换显示器，持握点按宠物尺寸比例保持；显示器断开后恢复主屏。

`AssetCatalog` 在开发与生产环境将稳定的 `/pet/...` URL 映射到资源目录或覆盖文件。当前按基础功能依赖保留上游美术，构建检查完整可达资源及高清副本，不再要求已归档小游戏入口。清理口径见 [资源清理记录](asset-pruning.md)，资源替换说明见 [assets.md](assets.md)。

AI 和可配置更新请求由主进程代理。AI 默认关闭；基础养成和本地问候不依赖网络。聊天仅返回文字，旧动作词执行和作弊口令已移除。真实阅读、知识、持久化任务和外部 harness 尚未接入。

## 后续目标架构与迁移方向

产品以有性格的桌面伙伴为中心，具备自身 Agent、外部双向接入和任务接续。笔记提醒、文件阅读整理、项目讨论协作及桌面应用操作共享同一能力与任务服务，完整范围以 [产品需求](product-requirements.md) 为准。

- 身份、长期记忆、公共任务和产物由应用持有，切换执行后端后保持连续；气泡显示简短互动，面板承载长对话和工作详情。
- 核心业务状态已由主进程托管，现有 `command()` 在可靠提交后返回且支持持久化请求去重；后续把同一宿主接到有权限边界的外部工具入口。
- 自身 Agent 负责本体技能的模型与工具循环；外部适配器负责委派、事件、会话恢复及取消。两者复用业务服务，协调层保留工作归属和交接记录。
- 工作任务与游戏活动使用独立生命周期。隐藏、暂停成长和死亡不阻塞工作；文件、桌面和外部操作按实际结果核验，应用退出时保存检查点并清理任务进程。
- 会话、笔记提醒、知识与任务存储独立于兼容宠物存档，凭据由主进程独立管理。提醒完全退出后的运行方案和桌面应用兼容范围仍待明确。

实现顺序为统一基础与协议、核心互动与一个外部后端、全部本体技能、更多后端与应用及完整回归。当前目录树描述已实现代码；第一批状态宿主之外的任务、记忆与后端模块仍未实现。

## 轻量化与资源调度（目标约束）

完整功能需同时满足 [轻量化与性能要求](performance-requirements.md) 的 N01–N07。当前资源清理已经减少素材体积，但尚未测量运行性能，以下约束不能视为已实现。

- 常驻宠物、权威状态宿主和轻量任务/提醒调度；技能按需加载，worker、桌面自动化和外部后端按任务启动，空闲时释放。
- 重计算离开 UI 和主进程热路径，使用有界队列、并发和缓存；任务量增加时排队，保持聊天输入、取消及到期提醒响应。
- 通过可见性、活动状态和锁屏事件调整渲染与观察频率；减少静态重绘和无任务轮询，保留多屏拖拽、输入法和任务恢复语义。
- 会话、知识和索引增量读取，长列表按需渲染；流式内容合并刷新，日志与临时产物有容量策略，持久化优化保持事务与提交顺序。
- 所有执行资源记录归属和清理期限；本体、外部 Agent、本地模型与目标应用分别计量，并报告任务总成本。

M0 先测量现有透明窗口、光标和动作轮询、Ruffle 双播放器及同步存档写入的开销，再依据结果优化。包体、启动、CPU、内存、GPU、交互和长期驻留共同验收；必要的架构替代须以同一场景对比验证。

## 验证

单元测试覆盖纯业务效果、数量和余额、整车购买、活动冲突与奖励、课程与考试、存档迁移、导入备份、多屏拖拽及服务清理。真实 Electron 回归验证基础 UI、preload、资源协议、Ruffle、聊天隔离、离线恢复和退出保存，并关闭测试创建的全部进程。平台结果见 [verification.md](verification.md)。
