# 桌面架构

## 当前范围

仅构建 Windows 和 macOS。保留 Electron + TypeScript + Ruffle，运行基础养成、动画、互动、背包商城、治疗装扮和学习打工。扩展玩法及相关适配器位于 `archive/legacy-gameplay/`，不在编译或打包入口中。完整范围见 [基础版本重构](basic-refactor.md)，后续路线见 [重构评估](agent-refactor-assessment.md)。

```text
src/core/pet/catalog.ts         基础商品和课程目录
src/core/pet/items.ts           使用、治疗、余额与整车购买规则
src/core/pet/activities.ts      学习打工、进度、离线恢复、考试判定
src/core/pet/interaction.ts     日常互动效果
src/core/pet/result.ts          业务结果、结构化错误、原子变化描述
src/core/pet/level.ts           成长等级与阶段
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
src/renderer/pet/store.ts      UI 状态、整组更新发布与存档批次
src/renderer/pet/              成长时钟、动画路由、基础业务的表现适配
src/renderer/ui/               基础界面、日常动作栏与交互
src/renderer/swf/              宠物 Ruffle 播放器
resources/                    原始素材与资源包配置
archive/legacy-gameplay/       不参与构建的扩展源码和适配器备份
```

`window.qqpet` 保持内部桥名；应用身份、数据目录和打包标识使用 AgentPet。存档字段保留上游拼写，包括 `petComputedlInfo`，以兼容已有存档。

## 业务提交与表现

核心函数不依赖 DOM、Electron 或动画，输入当前存档，返回明确的成功数据与 `SavePatch` 或结构化错误。它们不修改输入。购物车校验、扣费和入库构成同一个结果；活动完成清理和奖励同样一起提交。

UI 的 `command()` 调用核心函数，成功后由 `publishChange()` 一次安装全部状态变化，再通知界面和动画。模型台词与 SWF 不承担扣库存、治疗、启动课程或发奖励。窗口、背包与资料读取同一份状态。

成长计时和桌面偏好仍通过渲染层 `store` 的受控更新提交；主进程仓库负责磁盘持久化。这一步完成基础功能收敛与纯业务拆分，完整状态托管迁入主进程、持久化幂等请求以及对外工具入口仍按评估文档后续实施。当前 IPC 的 `save(patch)` 仅允许本桌宠的隔离 preload 使用，不作为 agent 接口开放。

## 存档与退出

渲染层每 200 ms 合并修改，主进程同步执行 JSON 原子替换，写成功才更新仓库副本。失败通过桥回报界面；`flush` 是此前已提交批次的持久化屏障。正常退出先 flush，再关闭服务。导入/重生已替换存档，直接清理并重启，避免旧批次覆盖新存档。

旧扩展玩法数据保留并导出，不再推进或结算。进行中的旧旅行转存到 `saveJsonData.legacyTrip` 并释放活动占位。游戏内学习打工仍支持离线进度；暂停和死亡期间不会按离线时间发奖励。导出默认清空 API Key，本机配置不变。

`Lifetime` 管理定时器、系统事件、IPC 注册、托盘动画和全屏检测进程。窗口关闭和应用退出触发清理，重复清理安全。已移除剪贴板观察、前台应用查询辅助进程及独立小游戏窗口。

## 平台与资源

Windows 使用透明工具窗口和 PowerShell/Win32 全屏检测；辅助进程隐藏运行并随应用退出。macOS 隐藏 Dock 图标，输入面板打开时调整置顶层级，保持中文输入法候选窗口可见。

多显示器使用 Electron DIP 坐标，支持负坐标。拖拽按全局光标切换显示器，持握点按宠物尺寸比例保持；显示器断开后恢复主屏。

`AssetCatalog` 在开发与生产环境将稳定的 `/pet/...` URL 映射到资源目录或覆盖文件。原始美术继续保留，基础构建检查领养、宠物动画、头像、气泡和托盘等关键资源，不再要求小游戏入口。资源替换说明见 [assets.md](assets.md)。

AI 和可配置更新请求由主进程代理。AI 默认关闭；基础养成和本地问候不依赖网络。聊天仅返回文字，旧动作词执行和作弊口令已移除。真实阅读、知识、持久化任务和外部 harness 尚未接入。

## 验证

单元测试覆盖纯业务效果、数量和余额、整车购买、活动冲突与奖励、课程与考试、存档迁移、导入备份、多屏拖拽及服务清理。真实 Electron 回归验证基础 UI、preload、资源协议、Ruffle、聊天隔离、离线恢复和退出保存，并关闭测试创建的全部进程。平台结果见 [verification.md](verification.md)。
