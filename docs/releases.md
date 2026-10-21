# GitHub Actions 构建与发布

工作流为 `.github/workflows/desktop.yml`。普通分支推送、PR 和手动运行执行版本检查、单元测试、资源审计、类型检查、生产构建、源码 Electron 回归、打包及解包产物回归。安装包与诊断报告分开上传，诊断不包含测试存档。

Windows 生成 x64 NSIS 安装程序；macOS 生成 arm64 与 x64 的 DMG 和 ZIP。解包产物在各 runner 的原生架构运行，macOS 的另一架构只做交叉打包，不据此宣称已通过对应架构的桌面回归。

## 发布版本

发布由 `v` 开头的版本标签触发，标签必须与 `package.json` 和 `package-lock.json` 完全一致。所有平台构建与回归成功后，工作流校验五个安装包齐全、生成 `SHA256SUMS.txt` 和带源码提交的 `release-manifest.json`，上传到草稿后一次性公开 Release。任一平台失败不会发布部分版本。

已有版本之后发布补丁版本：

```sh
npm version patch
git push origin main --follow-tags
```

`npm version` 会同步两个版本文件并创建提交和 `v` 标签。也可以显式选择 minor、major 或预发布版本；带 `-beta.1` 等预发布部分的版本会标为 GitHub prerelease，不更新稳定版 latest。

手动运行时选择分支只构建，选择已有版本标签则执行发布流程。发布中断后可重跑：草稿附件可以补齐；已经公开的 Release 不覆盖，修复内容应使用新版本标签。不要移动已发布的标签。

## 权限与签名

构建任务只有 `contents: read`；发布任务单独获得 `contents: write`，使用仓库内置 `GITHUB_TOKEN`，不需要个人 PAT。第三方 action 固定到提交 SHA。仓库或组织策略如果禁止 Actions 写 Release，需要管理员允许对应权限。

当前未配置开发者证书：Windows 包未签名，macOS 使用 ad-hoc 签名、未 notarize。这保证 CI 无证书也能生成产物，但不是受系统信任的开发者签名；正式分发证书与 notarization 需要另行接入。CI 构建的应用使用当前仓库的 latest-release API，更新提示链接到本仓库 Release。

发布动作使用 [GitHub 的标签触发](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) 与 [GitHub CLI Release](https://cli.github.com/manual/gh_release_create)。版本及产物约束由 `scripts/release.ts` 实现，并有独立单元测试。
