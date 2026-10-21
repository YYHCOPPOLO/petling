# 美术资源替换

## 当前资源

2026-10-20 按基础功能依赖清理后，`resources/pet` 保留 **3,673 个文件、98.1 MiB**，对应 **2,472 个逻辑资源**，其余为高清副本。安装包图标 `build/icon.png` 独立保留。

本次删除包内 4,389 个未引用文件，以及独立的旧 `resources/icons/tray.png`。社区、农场、钓鱼、旅行、相簿、邮件、签到、密室和小游戏资源均已移出当前工作树；删除内容可从 Git 历史恢复。按目录统计见 [资源清单](asset-inventory.json)，清理口径见 [资源清理记录](asset-pruning.md)。

这一步精简了依赖，现存图片及 SWF 仍为上游资源，原创熊猫替换尚未开始。

## 依赖检查与打包

```sh
npm run assets:audit      # 生成逐项依赖来源、实际文件和未引用文件清单
npm run assets:check      # 缺失依赖、LFS 指针或未引用资源会使检查失败
npm run assets:inventory  # 更新 docs/asset-inventory.json
npm run assets:stage      # 将通过检查的资源复制到 out/asset-pack
```

审计详情写入 `.verification/assets/dependencies.json`。检查范围包括：

- 当前 `src/` 内 TS、CSS 和 HTML 的静态素材 URL。
- 动画路由的所有随机编号、两种性别、三个成长阶段和四种成年心情。
- 点脸配置、左右走路、头像、气泡、托盘、进度条、等级和窗口切片等动态路径。
- 基础类别的完整物品目录，包括旧存档可能持有的停售物品；不以商城当前售卖清单代替背包依赖。
- 实际选中资源的 `@2x.png` 副本，以及 SVG/SWF 中的字面量子资源引用。

动态 UI 路径的有限取值在 `scripts/asset-dependencies.ts` 中登记；新增动态拼接方式时应同步更新。SWF 字符串检查不能推导任意 ActionScript 动态加载，所以仍需执行真实 Electron 回归。

`npm run build` 在构建结束时重建 `out/asset-pack`。Electron Builder 只把这个经过审计的目录复制为运行资源，并从 `app.asar` 排除该暂存目录，避免资源重复入包。源码开发仍读取 `resources/`。

## 逐项替换

把原创素材放入 `resources/custom/`，在 `resources/asset-pack.json` 中添加逻辑路径覆盖：

```json
{
  "schemaVersion": 1,
  "id": "custom-v1",
  "name": "第一批原创素材",
  "root": "pet",
  "overrides": {
    "avatar/GGEgg.png": "custom/avatar/egg-boy.png",
    "avatar/MMEgg.png": "custom/avatar/egg-girl.png",
    "control/icons/weishi.png": "custom/icons/feed.png"
  }
}
```

覆盖的键不包含 `pet/`，值相对 `resources/`。未覆盖的内容继续读取当前 `root`。实体文件可以使用新名称，界面、CSS 与 SWF 继续通过原逻辑 URL 请求。所有映射在启动时校验，路径必须保持在资源目录内。资源配置修改后重启开发服务器或应用。

替换完整资源包时，将新树放在 `resources/custom-pet/`，把 `root` 改成 `custom-pet`，保持逻辑目录和文件接口。覆盖后先运行依赖审计，确认并移除已经不再引用的旧文件；构建仅复制选中的资源及其高清副本。生成草稿、参考图和未接入的新素材应放在 `resources/` 之外。

## 不同资源的接口

| 内容 | 位置和约束 |
| --- | --- |
| 宠物头像 | `avatar/<性别><成长阶段>.png`，界面按比例展示 |
| 基础 UI 与商品图片 | 各功能目录中的 PNG、GIF、BMP、SVG；尽量保留原尺寸/比例 |
| 宠物动画 | `Action/` 中的 SWF，播放器读取帧率和帧数；不同性别、阶段、心情分别路由 |
| 领养与对话 | `reset/Adopt.swf`、`talk/`，保留 `ChooseAPI.ChooseSex`、`BubbleAPI.OnButtonClick` 和注册的 `speak` 回调 |
| 已归档玩法素材 | 已从当前资源包删除；归档源码仅供参考，恢复玩法时需另行准备资源 |
| 字体 | `qqfont.ttf`；换字体时同时确认播放器配置中的字体家族名 |
| 高清 | 图片的 `@2x` 同名文件和窗口边框 SVG；覆盖素材要同时准备相应高清版本 |
| 托盘 | `img_res/Tray/<GG或MM>/`，静态图与动画帧也走资源映射 |
| 安装包图标 | `build/icon.png`，构建时读取，独立于运行时资源映射 |

SWF 包含图像和脚本，不能直接拿一张 PNG 替换 SWF 文件。若后续改成原创帧动画或 Spine 等形式，应在 `src/renderer/swf/pet-swf.ts` / `player.ts` 增加播放适配，同时保持状态机的 load、stop、帧完成和交互回调契约。

## 保留上游补丁

当前保留的宠物互动和高清对话气泡包含上游补丁。依赖清理未改写保留文件的内容。重新导入旧客户端素材时不要覆盖这些文件，否则可能失去离线回复或交互接口。

原资源署名与权限说明在 `THIRD_PARTY_NOTICES.md`。每批替换都应更新清单和署名，并重新运行资源检查、生产构建和桌面回归。
