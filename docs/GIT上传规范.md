# GitFinder 上传规范

本文规定本项目提交到 Git 仓库和发布桌面安装包时的文件范围，避免把依赖、构建产物、本机配置或大文件写入 Git 历史。

## 一、应提交的内容

- 应用源代码：`src/`、`public/`
- Electron 和服务入口：`main.js`、`preload.js`、`server.js`、`cli.js`
- 构建及辅助脚本：`scripts/`
- 依赖声明：`package.json`、`package-lock.json`
- 项目文档：`README.md`、`docs/`
- GitHub Actions 发布流程：`.github/workflows/`
- Git 配置：`.gitignore`

`package-lock.json` 必须一同提交，用于锁定依赖版本和保证其他机器可以复现安装结果。

## 二、禁止提交的内容

- 依赖目录：`node_modules/`
- 构建产物：`dist/`、`build/`
- macOS 应用和发布压缩包：`*.app`、`*.dmg`、`*.zip`
- 本机缓存和运行配置：`.git-monitor-cache.json`、`config/`
- 环境变量及密钥：`.env`、`.env.local`
- 编辑器本地配置：`.trae/`
- 系统和日志文件：`.DS_Store`、`*.log`

这些内容应由安装、构建或运行过程在本机重新生成，不应进入源码仓库。

## 三、桌面应用发布方式

源码提交到 Git 仓库，打包后的 `.app` 或 ZIP 不直接提交到分支。

发布流程：

1. 确认工作区源码已提交，并记录发布对应的 commit。
2. 创建版本标签，例如 `v1.0.1`。
3. 推送源码和标签到 GitHub。
4. GitHub Actions 的 `Release` workflow 会自动执行测试、正式源码门禁、Developer ID 签名、Apple 公证与正式产物门禁；缺少凭据或任一门禁失败时不得上传附件。
5. workflow 只在验证报告明确为 `mode: official`、`eligibleForDistribution: true` 且 `issues: []` 后创建/更新 Release。
6. Release 必须上传 ZIP、`latest-mac.yml` 与 `release-verification.json`；自动更新缺少前两项无法工作，缺少验证报告则无法审计分发资格。
7. Release 说明由 GitHub 自动生成，必要时再补充主要变更、系统和芯片架构。

推荐发布附件命名：

```text
GitFinder-<版本号>-arm64-mac.zip
latest-mac.yml
release-verification.json
```

## 四、提交前检查

每次提交前执行：

```bash
git status --short
git diff --check
git check-ignore -v node_modules dist .trae .DS_Store
```

确认事项：

- `git status` 中没有 `node_modules/`、`dist/`、`.trae/` 或 `.DS_Store`。
- 没有 `.env`、密钥、Token、密码和带有个人本机路径的运行配置。
- 改动只包含本次任务相关文件。
- 功能修改已经完成相应测试或手动验证。
- 不把默认 `npm run dist` 生成的 ad-hoc 开发包上传为正式 Release；正式附件只能来自标签 CI 的签名与公证门禁。
- GitHub Secrets、`.p12`、Keychain、App 专用密码和 Team 私钥不进入 Git 历史或 Release 附件。

可使用以下命令检查已被 Git 跟踪的大文件：

```bash
git ls-files -z | xargs -0 du -h | sort -h | tail -n 20
```

## 五、首次拉取后的安装和构建

```bash
git clone <仓库地址>
cd git-status-monitor
npm ci
npm run electron
```

需要生成 macOS 应用时执行：

```bash
npm run dist
```

## 六、误提交大文件的处理

如果大文件只加入了暂存区但尚未提交：

```bash
git restore --staged <文件或目录>
```

如果文件已经被 Git 跟踪，先停止跟踪但保留本地文件：

```bash
git rm -r --cached <文件或目录>
```

随后确认 `.gitignore` 已包含对应规则，再提交删除记录。若大文件已推送并进入历史，不要直接强制改写共享分支；应先备份并与仓库协作者确认，再使用专门的历史清理工具处理。
