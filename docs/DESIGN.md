# GitFinder - 智能 Git 项目管理器 方案设计

> 一个集成 Git 状态管理、README 预览和 AI 辅助功能的 macOS 访达风格桌面应用

## 一、产品定位

### 核心价值
传统文件管理器需要进入文件夹才能查看 README 和 Git 状态。GitFinder 在**文件夹总览层面**就展示：
- README 内容预览
- Git 仓库状态（未提交/未推送/需拉取）
- Git 快捷操作按钮（pull/push/commit）

### 目标用户
- 拥有多个 Git 仓库的开发者
- 需要快速了解项目状态的项目经理
- 希望高效管理本地项目的用户

---

## 二、架构设计

### 整体架构：Electron 三段式

```
┌─────────────────────────────────────────────────────────┐
│                    渲染进程 (Renderer)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │   侧边栏     │  │   主内容区    │  │   详情面板     │ │
│  │  (Sidebar)  │  │  (Content)   │  │  (Detail)      │ │
│  └─────────────┘  └──────────────┘  └────────────────┘ │
│                         │                                │
│                   window.gitFinder API                   │
└─────────────────────────┬───────────────────────────────┘
                          │ IPC (contextBridge)
┌─────────────────────────┴───────────────────────────────┐
│                  Preload (预加载脚本)                     │
│         contextBridge.exposeInMainWorld                   │
└─────────────────────────┬───────────────────────────────┘
                          │ ipcRenderer.invoke
┌─────────────────────────┴───────────────────────────────┐
│                    主进程 (Main)                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌────────┐ │
│  │ 文件系统  │  │  Git 引擎  │  │ AI 服务  │  │ 配置   │ │
│  │  服务    │  │           │  │          │  │ 服务   │ │
│  └──────────┘  └───────────┘  └──────────┘  └────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 安全模型
- `nodeIntegration: false` - 禁用渲染进程 Node.js
- `contextIsolation: true` - 启用上下文隔离
- `sandbox: true` - 启用沙箱
- 所有系统操作通过 IPC 桥接，渲染进程无直接文件系统访问

---

## 三、功能模块

### 3.1 文件浏览器模块

#### 显示模式

**模式一：目录树模式（默认）**
- 像正常文件管理器一样显示完整目录树
- 支持展开/折叠文件夹
- Git 仓库文件夹显示状态徽章
- 双击文件夹进入，支持前进/后退/上级导航
- 面包屑导航栏显示当前路径

```
📁 /Volumes/project
├── 📁 学习
│   ├── 📁 nextlearn        [main ✓]  Next.js 学习项目
│   └── 📁 astro
│       └── 📁 density-dwarf [main ↑1]  Astro 项目
├── 📁 正式项目
│   ├── 📁 yaofan           [main !3]  要饭网
│   ├── 📁 mes-lite         [dev ✓]    MES 系统
│   └── 📁 量化交易          [main ↓2]  量化交易系统
└── 📁 项目存档
    └── ...
```

**模式二：平铺模式**
- 单层显示当前路径下所有 Git 仓库（递归扫描）
- 每个仓库卡片显示完整路径
- 适合快速总览所有项目状态
- 支持按多种维度排序

**模式三：仓库组模式**
- 按自定义分组显示仓库
- 组内显示该组的所有仓库
- 支持折叠/展开组
- 一个仓库可属于多个组

#### 视图样式
- **卡片视图**：README 预览 + Git 状态 + 操作按钮（默认）
- **列表视图**：紧凑列表，适合大量仓库
- **图标视图**：大图标 + 名称，类似 Finder 图标视图

#### 排序功能
| 排序维度 | 说明 | 默认方向 |
|---------|------|---------|
| 按名称 | 仓库名字母序 | 升序 A-Z |
| 按路径 | 完整路径字母序 | 升序 |
| 按目录 | 按所在父目录分组排序 | 升序 |
| 按 Git 状态 | 需关注的排前面：未提交 > 未推送 > 需拉取 > 已同步 | 降序 |
| 按修改时间 | 最近修改排前面 | 降序 |
| 按仓库大小 | 文件夹大小 | 降序 |
| 按分支 | 按分支名分组 | 升序 |

#### 数据结构
```javascript
// 目录项
{
  name: "项目名称",
  path: "/absolute/path",
  type: "directory" | "file",
  isGitRepo: true,
  size: 0,
  modifiedTime: "2024-01-01",
  // Git 相关（仅目录）
  gitStatus: { ... },
  readme: { title, description }
}

// 仓库组
{
  id: "group-uuid",
  name: "前端项目",
  color: "#007AFF",           // 组颜色标识
  repoPaths: [                 // 仓库路径列表
    "/path/to/repo1",
    "/path/to/repo2"
  ],
  icon: "frontend",           // 组图标
  collapsed: false            // UI 折叠状态
}
```

### 3.5 仓库组模块

#### 设计理念
- **文件夹识别是初始化手段**：首次扫描时自动识别物理文件夹结构，生成初始分组
- **配置文件是最终定义**：识别结果写入配置文件，之后以配置为准
- **虚拟分组**：不移动实际文件，一个仓库可属于多个组
- **灵活管理**：支持手动创建组、拖拽仓库到组、跨组移动

#### 初始化流程
```
1. 用户选择根目录（如 /Volumes/project）
2. 扫描一级子目录，每个含 Git 仓库的目录 → 生成一个组
   例：学习/、正式项目/、项目存档/ → 三个组
3. 将识别结果写入配置文件 groups.json
4. 用户可在 UI 中自由调整：重命名、合并、删除、新增组
```

#### 配置文件格式（groups.json）
```json
{
  "version": 1,
  "groups": [
    {
      "id": "g1",
      "name": "学习项目",
      "color": "#34C759",
      "icon": "book",
      "repoPaths": [
        "/Volumes/project/学习/nextlearn",
        "/Volumes/project/学习/astro/density-dwarf"
      ]
    },
    {
      "id": "g2",
      "name": "正式项目",
      "color": "#007AFF",
      "icon": "briefcase",
      "repoPaths": [
        "/Volumes/project/正式项目/yaofan",
        "/Volumes/project/正式项目/mes-lite"
      ]
    }
  ],
  "ungrouped": [
    "/Volumes/project/some-orphan-repo"
  ]
}
```

#### 组操作
| 操作 | 说明 |
|------|------|
| 创建组 | 手动新建空组，指定名称/颜色/图标 |
| 自动识别 | 从文件夹结构初始化分组 |
| 添加仓库 | 将仓库加入组（支持多选） |
| 移除仓库 | 从组中移除仓库（不删除文件） |
| 移动仓库 | 从一个组移到另一个组 |
| 重命名组 | 修改组名称 |
| 删除组 | 删除组（仓库变为未分组，不删除文件） |
| 拖拽排序 | 拖拽调整组顺序和组内仓库顺序 |

#### 组的视觉呈现
```
侧边栏：                          主内容区（仓库组模式）：
                                  
📁 学习项目 (3)          ▸        ┌─ 学习项目 ────────────────────┐
📁 正式项目 (5)          ▸        │ 📁 nextlearn    [main ✓]      │
📁 项目存档 (8)          ▸        │ 📁 density-dwarf [main ↑1]    │
📁 个人实验 (2)          ▸        │ 📁 demo-project [main !2]     │
📄 未分组 (4)                     └───────────────────────────────┘
                                  
➕ 新建组                          ┌─ 正式项目 ────────────────────┐
                                  │ 📁 yaofan       [main !3]     │
                                  │ 📁 mes-lite     [dev ✓]       │
                                  │ 📁 量化交易      [main ↓2]     │
                                  └───────────────────────────────┘
```

### 3.6 标签模块

#### 设计理念
- **标签是属性标记**：用于描述仓库的技术栈、用途、优先级等维度
- **多标签**：一个仓库可以有多个标签
- **颜色标识**：每个标签有独立颜色，视觉快速区分
- **筛选核心**：标签是最主要的筛选维度，支持多选组合筛选

#### 与仓库组的区别

| 维度 | 仓库组 | 标签 |
|------|--------|------|
| 本质 | 逻辑分组（文件夹概念） | 属性标记（描述维度） |
| 数量 | 一个仓库通常在 1 个组 | 一个仓库可以有 N 个标签 |
| 用途 | 仓库分类、组织管理 | 技术栈、优先级、状态标记 |
| 示例 | 学习项目 / 正式项目 / 个人项目 | React / Node / 紧急 / 已归档 |
| 交互 | 侧边栏组列表切换 | 顶部标签栏多选筛选 |

#### 数据结构
```javascript
// 标签定义
{
  id: "tag-uuid",
  name: "React",
  color: "#61DAFB",        // 标签颜色
  icon: "react",           // 可选图标
  description: "React 前端项目"
}

// 仓库标签关联（存储在 tags.json）
{
  "version": 1,
  "tags": [
    { id: "t1", name: "前端", color: "#3B82F6" },
    { id: "t2", name: "后端", color: "#10B981" },
    { id: "t3", name: "Node.js", color: "#68A063" },
    { id: "t4", name: "React", color: "#61DAFB" },
    { id: "t5", name: "Python", color: "#3776AB" },
    { id: "t6", name: "重要", color: "#EF4444" },
    { id: "t7", name: "已归档", color: "#9CA3AF" }
  ],
  "repoTags": {
    "/path/to/repo1": ["t1", "t4", "t6"],
    "/path/to/repo2": ["t2", "t3"],
    "/path/to/repo3": ["t2", "t5", "t7"]
  }
}
```

#### 标签管理
| 操作 | 说明 |
|------|------|
| 创建标签 | 新建标签，指定名称、颜色、图标 |
| 编辑标签 | 修改标签名称、颜色 |
| 删除标签 | 删除标签，同时移除所有仓库的该标签 |
| 添加标签到仓库 | 给仓库打标签（支持多选仓库批量打标签） |
| 移除仓库标签 | 从仓库移除某个标签 |
| 自动识别 | 扫描 package.json / requirements.txt 自动打技术栈标签 |

#### 自动标签识别
扫描仓库时自动识别技术栈并打标签：
- `package.json` → Node.js / React / Vue / 前端
- `requirements.txt` → Python
- `go.mod` → Go
- `Cargo.toml` → Rust
- `pom.xml` → Java
- `.gitlab-ci.yml` → CI/CD
- `Dockerfile` → Docker

#### 标签筛选交互

**顶部标签栏：**
```
┌─ 筛选标签 ──────────────────────────────────────────────────────────┐
│  [全选] [前端] [后端] [React] [Node.js] [Python] [重要] [已归档] +  │
│    ✓      ✓               ✓                                  添加  │
└────────────────────────────────────────────────────────────────────┘
```

**筛选规则：**
- 多选标签时：**AND 关系**（同时拥有所有选中标签的仓库）
- 按住 Option/Alt 点击：**NOT 关系**（排除该标签）
- 点击「全选」：清空筛选

**仓库卡片上的标签显示：**
```
┌─────────────────────────────────────────────────┐
● 项目名称                    [main ✓]
📂 /Volumes/project/...
[React] [前端] [重要]         ← 标签彩色小药丸
...
└─────────────────────────────────────────────────┘
```

### 3.7 白板看板模块

#### 设计理念
- **仓库即组件**：仓库/仓库组作为白板上的可拖拽组件
- **自由布局**：随意拖动，无网格限制，支持缩放和平移
- **关系连线**：仓库之间建立关联（依赖、上下游、引用关系）
- **富文本标注**：在白板上添加文字说明、图片、便签
- **多白板**：支持创建多个看板（如"项目架构图"、"学习路线图"）

#### 白板组件类型

| 类型 | 说明 | 内容 |
|------|------|------|
| 仓库卡片 | Git 仓库组件 | 名称、状态、README 摘要、操作按钮 |
| 组容器 | 仓库组容器 | 可容纳多个仓库卡片的区域，带标题和颜色 |
| 文字便签 | 自由文本 | 标题、正文、背景颜色 |
| 图片 | 图片组件 | 本地图片路径、缩放 |
| 分隔线 | 视觉分隔 | 水平线/垂直线 |
| 关系连线 | 连接两个组件 | 带标签的箭头线，描述关系 |

#### 仓库卡片组件（白板版）
```
┌──────────────────────────┐
│ ● my-project    [main !2]│  ← 可拖拽
│ /path/to/project          │
│                           │
│ 项目描述来自README...      │
│                           │
│ [Pull] [Push] [打开]      │
└──────────────────────────┘
        ↑
   可从目录树拖拽到白板
```

#### 关系连线
```
        依赖于
  ┌──────────────────►
  │
┌─┴────────┐          ┌──────────┐
│ 前端项目  │          │ 后端API   │
└──────────┘          └──────────┘
  │
  │   部署到
  └──────────────────►
                  ┌──┴───────┐
                  │ 生产服务器 │
                  └──────────┘
```

**关系类型：**
- 依赖于 / 被依赖
- 上游 / 下游
- 引用 / 被引用
- 部署到
- 自定义关系（可命名）

#### 交互操作

| 操作 | 方式 |
|------|------|
| 移动组件 | 拖拽标题栏 |
| 缩放白板 | 滚轮 / 触摸板双指 |
| 平移白板 | 按住空格/中键拖拽 |
| 添加仓库 | 从侧边栏拖拽到白板 |
| 添加便签 | 右键菜单 / 工具栏按钮 |
| 画关系线 | 拖拽组件右侧连接点到另一个组件 |
| 选中组件 | 点击 |
| 多选 | 框选 / Shift+点击 |
| 删除 | Delete / Backspace |
| 调整大小 | 拖拽右下角 |

#### 数据结构
```javascript
// 白板 board.json
{
  id: "board-uuid",
  name: "项目架构图",
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
  viewport: { x: 0, y: 0, scale: 1 },
  components: [
    {
      id: "comp-1",
      type: "repo",
      repoPath: "/path/to/repo",
      x: 100,
      y: 200,
      width: 280,
      height: 180,
      zIndex: 1
    },
    {
      id: "comp-2",
      type: "group",
      name: "前端项目",
      color: "#3B82F6",
      x: 50,
      y: 100,
      width: 500,
      height: 400,
      zIndex: 0,
      childIds: ["comp-1", "comp-3"]
    },
    {
      id: "comp-3",
      type: "sticky",
      content: "需要重构",
      color: "#FEF3C7",
      x: 420,
      y: 180,
      width: 150,
      height: 100,
      zIndex: 2
    }
  ],
  connections: [
    {
      id: "conn-1",
      from: "comp-1",
      to: "comp-3",
      label: "依赖于",
      color: "#EF4444",
      fromSide: "right",
      toSide: "left"
    }
  ]
}
```

#### 白板列表
- 支持创建多个白板
- 白板列表在侧边栏（显示模式下方）
- 每个白板独立保存
- 最近使用排序

#### 与其他显示模式的关系
```
显示模式：
  ☰ 目录树
  ⬚ 平铺
  ⊞ 仓库组
  ⬛ 白板看板  ← 新增
      ├─ 项目架构图
      ├─ 学习路线图
      └─ 待办规划
```

#### 技术实现考虑
- 原生 Canvas 或 SVG 绘制连线
- DOM 元素作为组件（性能好，可交互）
- 缩放使用 CSS transform
- 拖拽使用原生 MouseEvent（避免依赖）
- 状态持久化到 JSON 文件

### 3.2 Git 集成模块

#### 状态检测
- 当前分支
- 未提交文件数（修改/暂存/未跟踪）
- 未推送提交数（ahead）
- 未拉取提交数（behind）
- 远程仓库地址
- 最近提交信息

#### Git 操作
| 操作 | 命令 | 说明 |
|------|------|------|
| Pull | `git pull` | 拉取远程更新 |
| Push | `git push` | 推送本地提交 |
| Fetch | `git fetch` | 获取远程信息 |
| Commit | `git add . && git commit -m` | 提交变更 |
| Status | `git status --porcelain` | 查看状态 |
| Log | `git log --oneline -20` | 提交历史 |
| Diff | `git diff --stat` | 变更统计 |
| Remote | `git remote` | 远程管理 |

#### 状态可视化
| 状态 | 颜色 | 图标 |
|------|------|------|
| 已同步 | 绿色 | ✓ |
| 未提交 | 红色 | ! |
| 未推送 | 橙色 | ↑ |
| 需拉取 | 蓝色 | ↓ |
| 非 Git | 灰色 | - |

### 3.3 README 预览模块

#### 功能
- 自动识别 `README.md` / `README` / `readme.md`
- 提取标题和描述（前 200 字符）
- Markdown 渲染（点击查看完整内容）
- 在文件夹卡片中直接显示预览

#### 解析规则
```
1. 第一行 # 标题 → readme.title
2. 跳过空行和标题行，取前 200 字符正文 → readme.description
3. 支持 package.json 的 description 字段作为备选
```

### 3.4 AI 辅助模块（预留）

#### 规划功能
- **智能提交信息**：分析 diff 自动生成 commit message
- **项目摘要**：基于 README 和代码结构生成项目简介
- **代码审查提示**：识别潜在问题
- **自然语言搜索**："找未推送的仓库"

#### 接口设计
```javascript
// 预留 AI 接口
window.gitFinder.ai.generateCommitMessage(repoPath)  // → string
window.gitFinder.ai.summarizeProject(repoPath)       // → string
window.gitFinder.ai.searchProjects(query)            // → SearchResult[]
```

---

## 四、界面设计

### 4.1 整体布局

```
┌──────────────────────────────────────────────────────────────┐
│  GitFinder                                    [搜索框]  [⚙]  │
├──────────┬───────────────────────────────────┬───────────────┤
│          │  📁 项目1  [Git: main ↑2]         │  README 预览   │
│  收藏夹   │  项目1的README描述内容预览...      │               │
│  > 项目   │  [Pull] [Push] [Commit] [Detail]  │  # 项目名称    │
│  > 桌面   │                                   │               │
│  > 文档   │  📁 项目2  [Git: main !3]         │  项目描述...   │
│          │  项目2的README描述内容预览...        │               │
│  位置     │  [Pull] [Push] [Commit] [Detail]  │  ## 安装      │
│  > 主目录 │                                   │               │
│  > 项目   │  📁 文件夹3  [非Git]              │  最近提交:     │
│  > 下载   │  普通文件夹                        │  abc123 msg   │
│          │                                   │               │
│          │  ─────────────────────────────    │  [在Finder显示]│
│          │  共 3 个项目，2 个 Git 仓库         │               │
├──────────┴───────────────────────────────────┴───────────────┤
│  状态栏：扫描完成 | 2 需要关注 | 上次更新: 12:00              │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 三栏布局

| 区域 | 宽度 | 功能 |
|------|------|------|
| 侧边栏 | 200px | 收藏夹、位置、最近访问 |
| 主内容区 | 自适应 | 卡片/列表/图标视图 |
| 详情面板 | 320px | README 渲染、Git 详情、操作 |

### 4.3 卡片设计

```
┌─────────────────────────────────────────────────┐
│ ● 项目名称                    [main ↑2 !1]      │  ← 状态指示器 + Git 状态
│ /path/to/project                                │  ← 路径（灰色小字）
│                                                 │
│ 项目描述：这是从 README 提取的描述内容，           │  ← README 预览
│ 最多显示两行...                                  │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ 最近提交: abc123 - 修复登录问题 (2小时前)     │ │  ← 提交信息
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ [⬇ Pull] [⬆ Push] [✓ Commit] [📋 详情] [⋯]    │  ← 操作按钮
└─────────────────────────────────────────────────┘
```

### 4.4 视觉风格

- **基调**：macOS 原生风格，毛玻璃效果
- **配色**：
  - 背景：`#f6f6f6`（浅灰）/ `#1e1e1e`（深色模式）
  - 侧边栏：`#e0e0e0` 半透明
  - 卡片：白色 + 轻微阴影
  - 强调色：`#007AFF`（macOS 蓝）
- **字体**：SF Pro / -apple-system
- **圆角**：8px（卡片）、6px（按钮）
- **动画**：300ms cubic-bezier 过渡

---

## 五、技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | Electron 42 | 已有依赖，成熟稳定 |
| 主进程 | Node.js + fs + child_process | 文件系统和 Git 操作 |
| 渲染进程 | 原生 HTML/CSS/JS | 无需框架，保持轻量 |
| IPC | contextBridge | 安全的进程通信 |
| Git | child_process execSync | 直接调用 git CLI |
| Markdown | marked 库 | README 渲染（可选） |
| 图标 | SF Symbols / 内联 SVG | macOS 风格图标 |
| 存储 | electron-store | 配置持久化 |

### 不使用框架的原因
- 项目规模适中，原生 JS 足够
- 减少构建复杂度
- Electron 启动更快
- 已有代码可复用

---

## 六、文件结构

```
git-status-monitor/
├── main.js                 # 主进程入口（精简为窗口管理）
├── preload.js              # 预加载脚本（IPC 桥接）
├── src/
│   ├── main/
│   │   ├── ipc/
│   │   │   ├── filesystem.js   # 文件系统 IPC 处理
│   │   │   ├── git.js          # Git 操作 IPC 处理
│   │   │   └── ai.js           # AI 接口 IPC（预留）
│   │   └── services/
│   │       ├── fileService.js  # 文件系统服务
│   │       ├── gitService.js   # Git 服务（复用现有）
│   │       └── configService.js # 配置服务
│   └── renderer/
│       ├── index.html          # 主界面
│       ├── styles/
│       │   ├── main.css        # 主样式
│       │   ├── sidebar.css     # 侧边栏
│       │   ├── content.css     # 内容区
│       │   └── detail.css      # 详情面板
│       ├── scripts/
│       │   ├── app.js          # 应用主逻辑
│       │   ├── sidebar.js      # 侧边栏逻辑
│       │   ├── content.js      # 内容区逻辑
│       │   ├── detail.js       # 详情面板逻辑
│       │   └── git.js          # Git 操作逻辑
│       └── assets/
│           └── icons/          # SVG 图标
├── server.js               # 保留：Web 模式备用
├── cli.js                  # 保留：CLI 模式备用
├── public/                 # 保留：Web 版本
└── package.json
```

---

## 七、IPC 接口设计

### 文件系统接口

```javascript
// 获取目录内容
window.gitFinder.fs.listDirectory(path) → DirectoryItem[]

// 获取文件信息
window.gitFinder.fs.getFileInfo(path) → FileInfo

// 在 Finder 中显示
window.gitFinder.fs.showInFinder(path) → void

// 打开文件
window.gitFinder.fs.openFile(path) → void

// 选择文件夹对话框
window.gitFinder.fs.selectFolder() → string | null
```

### Git 接口

```javascript
// 获取 Git 状态
window.gitFinder.git.getStatus(repoPath) → GitStatus

// 批量获取状态
window.gitFinder.git.batchStatus(repoPaths) → GitStatus[]

// Git 操作
window.gitFinder.git.pull(repoPath) → Result
window.gitFinder.git.push(repoPath) → Result
window.gitFinder.git.fetch(repoPath) → Result
window.gitFinder.git.commit(repoPath, message) → Result

// 获取提交历史
window.gitFinder.git.getLog(repoPath, limit) → Commit[]

// 获取变更详情
window.gitFinder.git.getDiff(repoPath) → DiffResult

// 远程管理
window.gitFinder.git.getRemotes(repoPath) → Remote[]
window.gitFinder.git.addRemote(repoPath, name, url) → Result
window.gitFinder.git.setRemoteUrl(repoPath, name, url) → Result
```

### 配置接口

```javascript
// 获取配置
window.gitFinder.config.get(key) → any

// 设置配置
window.gitFinder.config.set(key, value) → void

// 获取收藏夹
window.gitFinder.config.getFavorites() → Favorite[]

// 添加收藏
window.gitFinder.config.addFavorite(path, name) → void
```

---

## 八、实现路径

### 阶段一：基础架构（核心）
1. 重构 main.js → 纯窗口管理 + IPC 注册
2. 创建 preload.js → contextBridge 桥接
3. 实现文件系统服务 → 目录浏览、README 读取
4. 实现 Git 服务 → 复用现有 git 逻辑
5. 实现配置服务 → 仓库组配置读写

### 阶段二：界面框架
1. 三栏布局骨架（侧边栏 + 内容区 + 详情面板）
2. 工具栏：前进/后退/上级 + 面包屑 + 搜索 + 视图切换
3. 侧边栏：显示模式切换、收藏夹、位置
4. 详情面板：README 渲染 + Git 详情

### 阶段三：三种显示模式
1. **目录树模式**：递归显示目录树，Git 仓库带状态徽章
2. **平铺模式**：单层显示所有仓库，卡片含完整路径
3. **仓库组模式**：按 groups.json 分组显示
4. 视图样式切换：卡片 / 列表 / 图标

### 阶段四：排序与搜索
1. 多维度排序：名称/路径/目录/Git状态/时间/大小/分支
2. 实时搜索过滤（按名称、路径、README 内容）
3. 排序方向切换（升序/降序）

### 阶段六：仓库组管理
1. 文件夹结构自动识别 → 初始化 groups.json
2. 组的增删改查（创建、重命名、删除、改颜色）
3. 仓库加入/移除组（拖拽 + 右键菜单）
4. 组排序、组内仓库排序

### 阶段七：白板看板
1. 白板基础：缩放、平移、多白板管理
2. 组件拖拽：仓库卡片拖入白板、自由移动
3. 组件类型：仓库卡片、便签、图片、组容器
4. 关系连线：组件间画连线，带标签
5. 持久化：白板数据保存到 JSON

### 阶段八：Git 操作
1. Git 操作模态框（提交、拉取、推送）
2. 提交历史查看
3. 变更详情查看
4. 远程仓库管理

### 阶段八：体验优化
1. 深色模式支持
2. 拖拽支持（文件、仓库到组）
3. 键盘快捷键
4. 性能优化（虚拟滚动、缓存、懒加载）

### 阶段九：AI 集成（预留）
1. 智能提交信息生成
2. 项目摘要
3. 自然语言搜索

---

## 十、远程仓库管理（未来规划）

### 设计理念
- **本地 + 远程统一管理**：在同一个应用中管理本地和远程仓库
- **多平台支持**：GitHub、GitLab、Gitee、自建 GitLab 等
- **远程仓库即组件**：白板、列表、分组都支持远程仓库
- **本地远程关联**：本地仓库自动关联对应远程仓库

### 支持平台
| 平台 | API 方式 | 认证方式 |
|------|----------|----------|
| GitHub | REST API v3 / GraphQL | Personal Access Token |
| GitLab | REST API v4 | Personal Access Token |
| Gitee | Open API | Access Token |
| 自建 GitLab | REST API v4 | Personal Access Token + 自定义域名 |

### 远程仓库功能

#### 1. 远程仓库浏览
- 列出账号下所有仓库（自己的、组织的、Star 的）
- 显示仓库信息：名称、描述、Star 数、Fork 数、语言、最近更新
- 搜索和筛选（按语言、按组织、按活跃度）
- 查看 README、Issue、PR 概览

#### 2. 本地-远程关联
- 本地仓库自动识别并关联其 `origin` 远程
- 侧边栏显示"远程仓库"分组
- 同一个仓库在本地和远程视图中互跳
- 远程仓库状态图标：已克隆 / 未克隆

#### 3. 克隆与同步
- 一键克隆远程仓库到本地（可选择路径）
- 克隆后自动加入对应仓库组
- 远程仓库状态监控（是否有更新）
- 远程仓库 Star、Watch 管理

#### 4. Issue / PR 概览
- 显示仓库的 Open Issue 数量
- 显示 Open PR 数量
- 点击查看 Issue/PR 列表
- 分配给我的 Issue/PR 聚合视图

#### 5. 白板中的远程仓库
```
┌──────────────────────────────┐
│ 🌐 remote-repo    [GitHub]   │  ← 远程标识
│ owner/repo                   │
│                              │
│ 仓库描述来自 GitHub...        │
│ ⭐ 128  🍴 34  📝 5 issues   │
│                              │
│ [克隆] [在浏览器打开] [⭐]    │
└──────────────────────────────┘
```

### 数据结构
```javascript
// 远程账户
{
  id: "acc-1",
  platform: "github",       // github / gitlab / gitee / custom
  name: "我的 GitHub",
  username: "username",
  token: "encrypted-token",
  apiBaseUrl: "https://api.github.com",  // 自定义平台用
  avatarUrl: "..."
}

// 远程仓库
{
  id: "remote-1",
  platform: "github",
  fullName: "owner/repo",
  description: "项目描述",
  url: "https://github.com/owner/repo",
  language: "JavaScript",
  stars: 128,
  forks: 34,
  openIssues: 5,
  updatedAt: "2024-01-01",
  defaultBranch: "main",
  isCloned: true,           // 是否已克隆到本地
  localPath: "/path/to/repo" // 本地路径（如果已克隆）
}
```

### 架构扩展
```
┌─────────────────────────────────────────────────────┐
│                    主进程 (Main)                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │ 文件系统  │  │  Git 引擎  │  │  远程仓库服务     │ │
│  │  服务    │  │           │  │ (GitHub/GitLab)   │ │
│  └──────────┘  └───────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 实现阶段
1. **阶段一**：GitHub 集成 - 认证、仓库列表、基本信息
2. **阶段二**：GitLab / Gitee 支持 - 多平台统一抽象
3. **阶段三**：Issue / PR 浏览 - 查看列表和详情
4. **阶段四**：克隆与同步 - 一键克隆、本地远程关联
5. **阶段五**：通知中心 - Issue/PR 更新提醒
6. **阶段六**：白板集成 - 远程仓库组件、关系连线

---

## 十一、与现有代码的关系

| 现有文件 | 处理方式 | 说明 |
|---------|---------|------|
| `main.js` | 重构 | 从 Express 服务器改为纯 Electron 主进程 |
| `server.js` | 保留 | Web 模式备用 |
| `cli.js` | 保留 | CLI 模式备用 |
| `public/index.html` | 保留 | Web 版本界面 |
| Git 逻辑 | 迁移 | 迁移到 `src/main/services/gitService.js` |
| 扫描逻辑 | 迁移 | 迁移到 `src/main/services/fileService.js` |

### 迁移策略
- 保留三入口模式：Electron / Web / CLI
- 共享核心服务：fileService、gitService
- Electron 模式成为主推方案
- Web 模式作为远程访问备选

---

## 十、关键技术决策

### 10.1 为什么不用 React/Vue？
- 项目规模适中，DOM 操作不复杂
- 避免 Electron 包体积膨胀
- 减少构建配置复杂度
- 已有原生 JS 代码可复用

### 10.2 为什么用 IPC 而非 Express？
- Electron 原生 IPC 更安全（无网络暴露）
- 性能更好（无 HTTP 开销）
- 符合 Electron 安全最佳实践
- Web 模式仍保留 Express 备用

### 10.3 README 预览如何实现？
- 主进程读取文件，提取标题+描述
- 通过 IPC 传递结构化数据
- 渲染进程展示，可选 marked.js 完整渲染
- 卡片视图显示摘要，详情面板显示完整

### 12.4 Git 操作如何保证安全？
- 所有 git 命令在主进程执行
- 设置超时（30s）
- 捕获错误并返回结构化结果
- 危险操作（如 force push）需二次确认
