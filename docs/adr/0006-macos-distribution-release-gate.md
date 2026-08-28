# ADR 0006：macOS 正式分发必须通过可执行发布资格门禁

- 状态：已接受
- 日期：2026-08-27

## 背景

GitFinder 的 macOS 构建脚本原本在打包后写入更新配置，再执行 ad-hoc 签名并直接生成 GitHub Release 附件。ad-hoc 签名可以满足本机资源封装和开发测试，但不代表开发者身份，也没有 Hardened Runtime、安全时间戳或 Apple 公证票据；GitHub Actions 即使测试通过，仍可能公开 Gatekeeper 会拒绝的 ZIP。更严重的是，签名后继续修改 App Bundle 会使签名失效。

正式证书、私钥和 Apple 账号属于用户控制的外部权限，GitFinder 源码不能保存或伪造这些凭据。但缺少凭据不能成为继续上传未签名附件的理由。

## 决策

1. 构建明确区分 `development` 和 `official` 两种模式。默认模式只生成 ad-hoc 开发包，验证报告固定标记 `eligibleForDistribution: false`；它可以用于本机桌面验收，但不能作为正式 Release。
2. 构建前先执行源码门禁：校验包与锁文件版本、稳定 Bundle ID、产品名、三平台图标、更新源；正式模式还要求工作区干净、标签等于 `v<version>` 且标签指向当前提交。
3. `resources/app-update.yml` 作为受版本控制的额外资源，在签名和公证之前进入 App Bundle。完成签名后不再改写 Bundle 内容。
4. 正式模式必须提供完整 `Developer ID Application` 身份、Team ID 和预先存入 Keychain 的 notarytool profile。公证密码不作为 Packager 命令参数，也不写入构建报告。
5. `@electron/packager` 在正式模式中以布尔参数 `--no-osx-sign.continueOnError` 禁止签名错误容错，启用 Hardened Runtime，并通过 `@electron/notarize` 使用 notarytool 提交公证和附加票据。任何签名或公证失败都会中止构建；不能使用会被 CLI 解析成非空字符串的 `continueOnError=false` 写法。
6. ZIP 只在公证票据已经附加到 App 后创建。随后生成 `latest-mac.yml`，避免清单哈希绑定到公证前的旧内容。
7. 产物门禁重新读取 App、ZIP 和更新清单，校验 Bundle/asar 版本、Bundle ID、arm64 主程序、图标哈希、ZIP 布局与完整性、文件大小和 SHA-512。
8. 正式模式额外要求：严格深度 codesign 通过、Developer ID Authority、正确 TeamIdentifier、Hardened Runtime、安全时间戳、禁止调试 `get-task-allow`、Gatekeeper 接受，以及 `stapler validate` 成功。全部通过后才允许写出 `eligibleForDistribution: true`。
9. GitHub Actions 只在版本标签上运行发布作业。证书和公证凭据从 GitHub Secrets 导入临时 Keychain；上传步骤必须读取并确认正式验证报告，最后删除临时证书文件和 Keychain。
10. 正式 Release 同时上传 ZIP、`latest-mac.yml` 和 `release-verification.json`，使版本、提交、哈希与分发资格可以独立审计。
11. 删除可直接调用 electron-builder 上传的 `npm run publish` 和绕过自定义门禁的 `dist:builder` 脚本；正式上传只有标签 workflow 一个入口。

## 结果

- “测试通过”“构建成功”“正式可分发”成为三个不同的、机器可验证的事实，不再把 ad-hoc 包冒充成可自动更新的正式发行版。
- 没有 Apple Developer 凭据时，开发工作不受阻，但正式发布会明确失败，不会静默降级。
- 更新配置在签名前进入 Bundle，消除签名完成后再修改资源的完整性错误。
- 首个真实正式发行仍需用户配置 Apple 凭据，并在独立 Mac 上验证实际下载、Gatekeeper 首次启动与自动更新；本 ADR 只定义并实现门禁，不声称凭据已经存在。
