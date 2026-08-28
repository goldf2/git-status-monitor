# ADR 0008：Windows 产物必须由真正 Windows runner 构建与验证

- 状态：已接受
- 日期：2026-08-27

## 背景

旧 `build-win.sh` 可以在 macOS 上交叉生成 Electron Windows 免安装目录与 ZIP，但没有运行 Windows 文件系统、回收站、Git for Windows、安装器或真实启动测试。该产物不能支持“Windows 版可用”的结论。

## 决策

1. Windows 首批架构为 x64，使用 electron-builder 生成 NSIS `.exe` 安装包和 ZIP；ARM64 暂不纳入本阶段。
2. `npm run pack:win` 在非 Windows 平台上直接失败。交叉打包可作为开发诊断，但不是发布产物。
3. GitHub Actions 使用 `windows-latest`，运行完整 Node 测试、Windows 运行时验收、NSIS/ZIP 打包、免安装启动、静默安装、安装后启动和卸载。
4. 运行时验收必须覆盖便携项目配置、Git for Windows 发现、目录读取、复制、移动和 Electron 系统 Recycle Bin。
5. Windows 文件操作遵循大小写不敏感目标去重、保留文件名与非法字符校验、跨卷复制成功后删除来源、文件占用错误显示和符号链接权限说明。
6. 终端优先 Windows Terminal，其次 PowerShell 7、Windows PowerShell 和命令提示符。Git for Windows、VS Code 和 PyCharm 都必须可发现，也允许用户在本机设置中选择可执行文件。
7. 每个产物记录版本、架构、字节数和 SHA-256，并附加签名、安装、启动与卸载报告。
8. 只有 Authenticode 状态为 `Valid` 的标签产物可上传稳定 GitHub Release。没有代码签名时，产物只是 `unsigned-test-build`，必须显示 SmartScreen 风险；默认仅作为 CI 附件，只有手动运行者明确开启 `publish_unsigned_windows` 后，才可把同一已验收产物发布为独立预发布测试版。

## 结果

- “代码已适配”、“Windows 产物已生成”和“真实 Windows 已验证”是三个不同状态。
- 当前 macOS 开发机只能确认源码与 CI 配置；在 Windows runner 真实完成前，不宣称 Windows 产物或稳定版可用。
