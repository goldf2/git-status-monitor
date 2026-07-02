# Git Status Monitor

一个本地Git仓库状态监控工具，支持 CLI 命令行、Web 网页和 Electron 桌面应用三种使用方式。

## 功能特性

- 📁 **仓库扫描** - 递归扫描指定目录下的所有 Git 仓库
- 📊 **状态监控** - 实时监控仓库的提交、推送、拉取状态
- 📈 **统计面板** - 可视化展示已同步/未提交/未推送/需拉取数量
- 🔧 **Git 操作** - 支持 pull、push、fetch、commit 等常用操作
- 🌐 **远程管理** - 添加、修改远程仓库地址
- 📋 **变更详情** - 查看文件变更列表和差异统计
- 🎨 **多种视图** - 列表视图、卡片视图切换
- 🔍 **搜索筛选** - 按名称/路径搜索，按状态筛选
- ⏱️ **自动刷新** - 支持定时自动刷新状态
- 🚫 **排除仓库** - 暂时隐藏不想监控的仓库

## 技术栈

- Node.js + Express
- Electron
- Vanilla JavaScript (前端)
- Git CLI

## 安装

```bash
# 安装依赖
npm install
```

## 使用方式

### 1. CLI 命令行

```bash
# 扫描仓库（默认路径 /Volumes/project，深度 2）
npm run scan

# 指定路径和深度
node cli.js scan --path /Users/user/projects --depth 3

# 查看缓存状态（快速）
npm run status

# 启动 Web 服务器
node cli.js server

# 清除缓存
node cli.js clear

# 查看帮助
node cli.js --help
```

### 2. Web 服务器

```bash
npm start
# 访问 http://localhost:3001
```

### 3. Electron 桌面应用

```bash
npm run electron
```

### 4. 构建桌面应用

```bash
# 构建开发版本
npm run pack

# 构建发布版本
npm run dist
```

## API 接口

### GET /api/default-path

获取默认扫描路径（根据操作系统自动选择）

**响应：**

```json
{
  "path": "/Users/user/Projects"
}
```

### GET /api/repos

扫描仓库列表

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| path | string | 用户目录/Projects | 扫描路径 |
| depth | number | 1 | 扫描深度 |

**响应：**

```json
{
  "repos": [
    { "name": "repo-name", "path": "/path/to/repo" }
  ]
}
```

### POST /api/status

获取所有仓库状态

**请求体：**

```json
{
  "path": "/Volumes/project",
  "depth": 2,
  "excluded": ["/path/to/excluded/repo"]
}
```

**响应：**

```json
{
  "total": 5,
  "statuses": [
    {
      "name": "repo-name",
      "path": "/path/to/repo",
      "branch": "main",
      "hasUncommitted": false,
      "hasUnpushed": true,
      "hasUnpulled": false,
      "aheadCount": 2,
      "behindCount": 0,
      "modifiedCount": 0,
      "stagedCount": 0,
      "untrackedCount": 0,
      "lastCommit": "abc123 - commit message",
      "lastCommitTime": "2024-01-01 12:00:00",
      "remoteUrl": "git@github.com:user/repo.git",
      "remoteUrlBackup": "",
      "remotes": [],
      "readme": { "title": "Project Title", "description": "..." },
      "error": null
    }
  ],
  "cachedAt": "2024-01-01T12:00:00Z"
}
```

### POST /api/refresh

刷新指定仓库状态

**请求体：**

```json
{
  "paths": ["/path/to/repo1", "/path/to/repo2"]
}
```

**响应：**

```json
{
  "statuses": [...]
}
```

### POST /api/action

执行 Git 操作

**请求体：**

```json
{
  "path": "/path/to/repo",
  "action": "pull"
}
```

**支持的 action：** pull, push, fetch, status

**响应：**

```json
{
  "success": true,
  "result": "Already up to date."
}
```

### POST /api/commit

创建提交

**请求体：**

```json
{
  "path": "/path/to/repo",
  "message": "commit message"
}
```

**响应：**

```json
{
  "success": true,
  "result": "[main abc123] commit message"
}
```

### GET /api/log

获取提交历史

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| path | string | - | 仓库路径（必需） |
| limit | number | 20 | 返回数量 |

**响应：**

```json
{
  "commits": [
    { "hash": "abc123", "subject": "commit message", "author": "User", "date": "2024-01-01T12:00:00Z", "email": "user@example.com" }
  ]
}
```

### GET /api/diff

获取变更详情

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| path | string | 仓库路径（必需） |

**响应：**

```json
{
  "files": [
    { "status": "M ", "file": "src/main.js" },
    { "status": "??", "file": "src/new-file.js" }
  ],
  "diff": "src/main.js | 10 ++++++++\n1 file changed, 10 insertions(+)"
}
```

### POST /api/remote

远程仓库管理

**请求体：**

```json
{
  "path": "/path/to/repo",
  "action": "get|set|remove",
  "remoteName": "origin",
  "remoteUrl": "git@github.com:user/repo.git"
}
```

**响应：**

```json
{
  "success": true,
  "result": "远程仓库 origin 已设置为: git@github.com:user/repo.git"
}
```

### GET /api/cache

获取缓存数据

**响应：**

```json
{
  "hasCache": true,
  "data": { "total": 5, "statuses": [...] }
}
```

## 项目架构

```
git-status-monitor/
├── cli.js           # CLI 入口
├── server.js        # Express 服务器入口
├── main.js          # Electron 入口
├── public/
│   └── index.html   # 前端页面（含样式和脚本）
└── dist/            # 构建产物
```

### 三入口设计

1. **CLI** (`cli.js`) - 命令行工具，直接输出到终端
2. **Server** (`server.js`) - Web 服务器，提供 API 和静态页面
3. **Electron** (`main.js`) - 桌面应用，集成服务器和浏览器窗口

### 核心模块

- **scanGitRepos** - 扫描目录下的 Git 仓库
- **getGitStatus** - 获取单个仓库的详细状态
- **loadCache / saveCache** - 缓存管理（1小时过期）

## 配置说明

### 默认扫描路径

默认扫描路径根据操作系统自动选择：

- **macOS/Linux**: `~/Projects`
- **Windows**: `%USERPROFILE%\Projects`

可通过以下方式修改：

1. **CLI**: 使用 `--path` 参数
2. **Web**: 在界面输入框中修改
3. **API**: 调用 `/api/default-path` 获取默认路径

### 自动刷新间隔

Web 界面支持自动刷新，默认间隔为 60 秒。可通过界面开关启用/禁用。

### 自动 Fetch

扫描时默认不执行 `git fetch`，以提高扫描速度。如需获取最新的远程状态，可在 API 请求中设置 `autoFetch: true`。

### 排除目录

扫描时自动跳过以下目录：

- `.git`, `.DS_Store`, `node_modules`, `vendor`
- `__pycache__`, `.venv`, `env`
- macOS 系统目录（`.DocumentRevisions-V100`, `.Spotlight-V100` 等）

## 注意事项

### ⚠️ 性能提示

- `git fetch` 操作会影响扫描速度，建议在网络较慢的环境下保持 `autoFetch: false`
- 如需获取最新远程状态，可手动点击 "Fetch" 按钮或启用 `autoFetch`

### ⚠️ 安全警告

- **commit API** 执行的是 `git add .`（暂存当前目录下的所有变更），不包括未跟踪文件
- Electron 模式已启用 `contextIsolation: true` 和 `sandbox: true`，提高安全性

### ⚠️ 权限问题

- 需要对扫描路径有读取权限
- 需要对仓库目录有写入权限才能执行 commit/push/pull 操作

## 常见问题

**Q: 扫描不到仓库？**

A: 请检查：
- 路径是否正确
- 是否有读取权限
- 目录是否包含 `.git` 文件夹

**Q: 远程操作失败？**

A: 请检查：
- Git 远程仓库配置是否正确
- 是否有网络连接
- 是否有权限访问远程仓库

**Q: Electron 应用无法启动？**

A: 请确保已安装依赖：
```bash
npm install
npm run electron
```

**Q: 如何修改默认扫描路径？**

A: 在 Web 界面的输入框中修改，或使用 CLI 的 `--path` 参数。

## 许可证

MIT License

## 作者

无

## 版本

1.0.0