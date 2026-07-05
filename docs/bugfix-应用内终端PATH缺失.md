# 应用内终端 PATH 缺失修复

> Bug:应用内终端执行 `git add -A` 等命令报错,但系统终端正常

## 一、问题描述

### 现象

在 GitFinder 应用内终端执行:

```bash
git add -A && git commit -m "更新"
```

报错退出码 1,提示找不到命令或命令失败。同样的命令在系统终端(iTerm/Terminal)中执行正常。

### 复现条件

- 从 Dock / Finder / `open` 命令启动 Electron 应用
- 在应用内终端执行任意 git 命令(`git add` / `git status` / `git commit` 等)

## 二、根因分析

### 2.1 Electron 启动方式与 PATH

macOS 下应用的启动方式决定 `process.env.PATH` 的内容:

| 启动方式 | PATH 来源 | 是否完整 |
| --- | --- | --- |
| 命令行 `npm run electron` | 继承登录 shell 的 PATH | ✅ 完整 |
| Dock / Finder / `open` | 继承 launchd 的默认 PATH | ❌ 不完整 |

launchd 默认 PATH 通常只有:

```
/usr/bin:/bin:/usr/sbin:/sbin
```

不包含:
- `/opt/homebrew/bin`(Apple Silicon Homebrew)
- `/usr/local/bin`(Intel Homebrew)
- `~/.nvm/versions/node/*/bin`(nvm 管理的 Node)
- 用户在 `~/.zshrc` / `~/.bash_profile` 中自定义的路径

### 2.2 exec 不加载登录 shell

应用内终端通过 [src/main/ipc/terminal.js](file:///Volumes/project/git-status-monitor/src/main/ipc/terminal.js) 实现:

```js
const { exec } = require('child_process');

exec(command, {
  cwd: cwd || process.cwd(),
  env: { ...process.env, FORCE_COLOR: '0' },
  // ...
}, callback);
```

两个关键问题:

1. **`exec` 默认用 `/bin/sh`**,而非用户的登录 shell(`/bin/zsh` 或 `/bin/bash`)
2. **`/bin/sh` 不会加载 `~/.zshrc` / `~/.bash_profile`**,所以即使有自定义 PATH 也不会生效
3. **`env` 仅继承 `process.env`**,而 `process.env.PATH` 本身就不完整(见 2.1)

### 2.3 同样的问题影响 gitService

[src/main/services/gitService.js](file:///Volumes/project/git-status-monitor/src/main/services/gitService.js) 中使用 `exec` / `execSync` 调用 git 命令,也存在同样问题。

> 注:macOS 自带的 `/usr/bin/git` 在 launchd 默认 PATH 中,所以 `git status` 等基础命令可能能跑,但 `git add -A && git commit` 链式命令、或依赖 hooks/编辑器/其他工具的命令会失败。

## 三、修复方案

### 3.1 自己实现 PATH 修复

fix-path v4+ 是纯 ESM(`"type": "module"`),无法在 CommonJS 的 main.js 中 `require`,直接调用会报 `TypeError: fixPath is not a function`。因此直接实现其核心逻辑:用用户的登录 shell 同步获取完整 PATH。

### 3.2 修改 main.js

在 [main.js](file:///Volumes/project/git-status-monitor/main.js) 文件最顶部(所有 `require` 之前)添加:

```js
// 修复 Electron 从 Dock/Finder 启动时 PATH 不完整的问题
// 用用户的登录 shell 同步获取完整 PATH(等价于 fix-path 库的核心逻辑)
// 注意:fix-path v4+ 是纯 ESM,无法在 CJS 中 require,这里直接实现
try {
  const { execSync } = require('child_process');
  const shell = process.env.SHELL || '/bin/zsh';
  const output = execSync(`"${shell}" -ilc 'echo $PATH'`, { encoding: 'utf8', timeout: 5000 });
  // 取最后一行包含路径分隔符的输出,过滤 shell 启动时的杂讯
  const fullPath = output.trim().split('\n').filter(l => l.includes('/') && l.includes(':')).pop();
  if (fullPath) process.env.PATH = fullPath;
} catch (e) {
  console.warn('PATH 修复失败,使用默认 PATH:', e.message);
}

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
// ... 其他 require
```

**为什么必须在最顶部?**
同步修改 `process.env.PATH`,必须在任何使用 `exec` 的模块被 `require` 之前执行,确保子进程能继承到完整的 PATH。

**为什么不用 fix-path 库?**
fix-path v4+ 是纯 ESM(`"type": "module"`),`require('fix-path')` 在 Electron 的 CJS 环境下返回 `{ default: fn }` 而非函数本身,调用报 `TypeError: fixPath is not a function`。动态 `import()` 是异步的,无法在 exec 之前同步完成。因此直接实现其核心逻辑(调用 `shell -ilc 'echo $PATH'`),无外部依赖,同步执行。

### 3.3 无需安装依赖

本方案直接使用 Node.js 内置的 `child_process.execSync`,不引入外部依赖。

## 四、影响范围

### 4.1 直接受益

| 文件 | 说明 |
| --- | --- |
| [src/main/ipc/terminal.js](file:///Volumes/project/git-status-monitor/src/main/ipc/terminal.js) | 应用内终端 `terminal:execute` IPC handler |
| [src/main/services/gitService.js](file:///Volumes/project/git-status-monitor/src/main/services/gitService.js) | git 服务,执行 git status / log / branch 等 |
| [src/main/ipc/git.js](file:///Volumes/project/git-status-monitor/src/main/ipc/git.js) | git IPC,转发到 gitService |

### 4.2 不需要修改

- 渲染层 [src/renderer/scripts/terminal.js](file:///Volumes/project/git-status-monitor/src/renderer/scripts/terminal.js) — 只通过 IPC 调用主进程,不直接执行命令
- `preload.js` — 仅做 IPC 桥接

## 五、验证方法

### 5.1 启动应用

```bash
# 必须从 Finder/Dock 启动才能复现原 bug
npm run electron
# 或打包后从 .app 启动
```

### 5.2 在应用内终端执行

```bash
# 验证 PATH 是否完整
echo $PATH
# 应包含 /opt/homebrew/bin 等用户路径

# 验证 git 命令链
git add -A && git commit -m "test"
# 应正常执行,不再报错
```

### 5.3 主进程日志验证

可在 `main.js` 临时加一行调试日志:

```js
const fixPath = require('fix-path');
fixPath();
console.log('PATH after fix:', process.env.PATH);
```

确认 PATH 包含用户自定义路径后删除调试日志。

## 六、注意事项

### 6.1 仅 macOS / Linux 需要

`fix-path` 在 Windows 上是 no-op,无需平台判断。

### 6.2 开发模式下不一定能复现

命令行 `npm run electron` 启动时,Electron 继承的是当前 shell 的 PATH(已完整),所以**开发模式下不会复现 bug**。**只有打包后或从 Dock/Finder 启动才能复现**,这是该 bug 隐蔽的原因。

### 6.3 替代方案对比

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| **自己实现 shell -ilc**(采用) | 无依赖,同步,跨平台 | 需自己处理边缘情况 |
| fix-path 库 | 经过测试,处理边缘情况 | v4+ 是纯 ESM,CJS 无法 require |
| 在 exec 中显式拼接 PATH | 无依赖 | 需硬编码路径,跨机器不通用 |
| 用 `node-pty` 替代 exec | 真正的 PTY,加载完整 shell | 改动大,重写终端实现 |
| shell:true + 显式指定 shell | 加载登录 shell 配置 | 启动慢,命令注入风险 |

## 七、相关文档

- 上游概念:无
- 关联代码:[main.js](file:///Volumes/project/git-status-monitor/main.js)、[src/main/ipc/terminal.js](file:///Volumes/project/git-status-monitor/src/main/ipc/terminal.js)
- 外站引用:[fix-path GitHub](https://github.com/sindresorhus/fix-path)、[Electron 环境变量文档](https://www.electronjs.org/docs/latest/api/process#processenv)
