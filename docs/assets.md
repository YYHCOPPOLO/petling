# 美术资源替换

## 当前资源

基础版本保留上游完整的 `resources/pet`、托盘图标以及 `build/icon.png`，其中扩展玩法素材暂存备用，没有相应运行入口。`npm run assets:inventory` 更新 `docs/asset-inventory.json`，按目录、后缀和字节数统计；`npm run assets:check` 检查真实素材与 Git LFS 指针，并验证领养、宠物、头像、气泡与托盘等基础关键资源。

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

替换完整资源包时，将新树放在 `resources/custom-pet/`，把 `root` 改成 `custom-pet`，保持逻辑目录和文件接口。构建会把配置、旧资源和新资源一起复制到安装包；确认全量替换后再从项目中移除已经不用的旧素材。

## 不同资源的接口

| 内容 | 位置和约束 |
| --- | --- |
| 宠物头像 | `avatar/<性别><成长阶段>.png`，界面按比例展示 |
| 基础 UI 与商品图片 | 各功能目录中的 PNG、GIF、BMP、SVG；尽量保留原尺寸/比例 |
| 宠物动画 | `Action/` 中的 SWF，播放器读取帧率和帧数；不同性别、阶段、心情分别路由 |
| 领养与对话 | `reset/Adopt.swf`、`talk/`，保留 `ChooseAPI.ChooseSex`、`BubbleAPI.OnButtonClick` 和注册的 `speak` 回调 |
| 已归档玩法素材 | 农场、池塘、社区、密室、旅行及小游戏资源仍保留；当前基础构建不提供其业务入口 |
| 字体 | `qqfont.ttf`；换字体时同时确认播放器配置中的字体家族名 |
| 高清 | 图片的 `@2x` 同名文件和窗口边框 SVG；覆盖素材要同时准备相应高清版本 |
| 托盘 | `img_res/Tray/<GG或MM>/`，静态图与动画帧也走资源映射 |
| 安装包图标 | `build/icon.png`，构建时读取，独立于运行时资源映射 |

SWF 包含图像和脚本，不能直接拿一张 PNG 替换 SWF 文件。若后续改成原创帧动画或 Spine 等形式，应在 `src/renderer/swf/pet-swf.ts` / `player.ts` 增加播放适配，同时保持状态机的 load、stop、帧完成和交互回调契约。

## 保留上游补丁

上游修改过部分 SWF，包括农场、密室、宠物互动和高清对话气泡。当前复制的是补丁后的文件。重新导入旧客户端素材时不要覆盖这些文件，否则可能失去离线回复、元宝结算或交互接口。

原资源署名与权限说明在 `THIRD_PARTY_NOTICES.md`。每批替换都应更新清单和署名，并重新运行资源检查、生产构建和桌面回归。
