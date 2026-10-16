# 上游代码与素材来源

AgentPet 的桌面功能移植自 [AnkioTomas/qqpet](https://github.com/AnkioTomas/qqpet)。本次基于提交 `322b0874956dafa2c2c76c89c0ab118d17e657bd`，于 2026-10-14 引入桌面主进程、preload、共用逻辑、渲染界面、数据和资源。上游代码采用 GPL-3.0-only；完整许可保留于 `LICENSE`。重构涉及桌面生命周期、存档、IPC、资源映射和构建配置。

`resources/pet`、`resources/icons` 和 `build/icon.png` 暂时保留上游素材。依上游声明，QQ 宠物的美术资源与 SWF 版权归腾讯所有，旅行照片素材版权归《旅行青蛙·中国之旅》所有。这些素材不因代码的 GPL 许可而成为原创素材；本项目沿用上游的学习交流用途说明。

Flash 播放器采用 [Ruffle](https://github.com/ruffle-rs/ruffle)，通过固定版本 `@ruffle-rs/ruffle@0.6.0` 引入；其包内许可文件随播放器一并复制到发行产物。Electron 和其他第三方依赖的许可见各依赖包的许可文件。

后续替换资源时，请同时更新此文件、资源包配置和 `docs/asset-inventory.json`。
