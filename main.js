// 修复 Electron 从 Dock/Finder 启动时 PATH 不完整的问题
// 用用户的登录 shell 同步获取完整 PATH(等价于 fix-path 库的核心逻辑)
// 注意:fix-path v4+ 是纯 ESM,无法在 CJS 中 require,这里直接实现
if (process.platform === 'darwin') {
  try {
    const { execFileSync } = require('child_process');
    const shell = process.env.SHELL || '/bin/zsh';
    const output = execFileSync(shell, ['-ilc', 'echo $PATH'], { encoding: 'utf8', timeout: 5000 });
    // 取最后一行包含路径分隔符的输出,过滤 shell 启动时的杂讯
    const fullPath = output.trim().split('\n').filter(l => l.includes('/') && l.includes(':')).pop();
    if (fullPath) process.env.PATH = fullPath;
  } catch (e) {
    console.warn('PATH 修复失败,使用默认 PATH:', e.message);
  }
}

const { app, BrowserWindow, ipcMain, dialog, Menu, crashReporter } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerFilesystemIPC } = require('./src/main/ipc/filesystem');
const { registerClipboardIPC } = require('./src/main/ipc/clipboard');
const { registerFileOperationsIPC } = require('./src/main/ipc/fileOperations');
const { registerContentIPC } = require('./src/main/ipc/content');
const { registerGitIPC } = require('./src/main/ipc/git');
const { registerProjectTasksIPC } = require('./src/main/ipc/projectTasks');
const { registerLocalProjectsIPC } = require('./src/main/ipc/localProjects');
const { registerRelationshipBoardsIPC } = require('./src/main/ipc/relationshipBoards');
const { registerConfigIPC } = require('./src/main/ipc/config');
const { registerTerminalHandlers } = require('./src/main/ipc/terminal');
const { registerTrustedHandler } = require('./src/main/ipc/security');

// GitFinder 的文件管理与关系白板不依赖 GPU。Windows 虚拟机的虚拟显卡驱动
// 可能在 Electron 创建首个窗口前终止 GPU 进程，因此 Windows 默认使用软件渲染。
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
}

crashReporter.start({
  productName: 'GitFinder',
  companyName: 'GitFinder',
  uploadToServer: false,
  compress: false
});

// 自动升级:开发模式下 require 会被跳过(electron-updater 在 asar 打包后才生效)
const isDev = !app.isPackaged;
let autoUpdater = null;
if (!isDev) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.warn('electron-updater 未安装,自动升级不可用');
  }
}

let mainWindow = null;
const startupLogPath = path.join(os.tmpdir(), 'git-status-monitor-startup.log');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
}

function writeStartupError(source, error) {
  const detail = error?.stack
    || error?.message
    || (typeof error === 'object' ? JSON.stringify(error) : String(error));
  try {
    fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${source}\n${detail}\n\n`);
  } catch (_) {}
}

process.on('uncaughtException', error => writeStartupError('uncaughtException', error));
process.on('unhandledRejection', error => writeStartupError('unhandledRejection', error));
app.on('child-process-gone', (_event, details) => writeStartupError('child-process-gone', details));

function isNewerVersion(candidate, current) {
  const normalize = (version) => String(version || '')
    .replace(/^v/, '')
    .split('-')[0]
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0);
  const next = normalize(candidate);
  const installed = normalize(current);
  const length = Math.max(next.length, installed.length);
  for (let i = 0; i < length; i++) {
    if ((next[i] || 0) > (installed[i] || 0)) return true;
    if ((next[i] || 0) < (installed[i] || 0)) return false;
  }
  return false;
}

function createWindow() {
  const windowOptions = {
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'GitFinder',
    backgroundColor: '#f6f6f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webgl: process.platform !== 'win32',
      experimentalFeatures: false
    }
  };

  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 18 };
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeStartupError('render-process-gone', details);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    writeStartupError('did-fail-load', { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupApplicationMenu() {
  const sendShortcut = action => mainWindow?.webContents.send('app:shortcut', action);
  const editItem = (label, action, accelerator) => ({
    id: `edit-${action}`,
    label,
    accelerator,
    registerAccelerator: false,
    click: () => sendShortcut(`edit:${action}`)
  });
  const settingsItem = () => ({
    label: '设置…',
    accelerator: 'CmdOrCtrl+,',
    registerAccelerator: false,
    click: () => sendShortcut('open-settings')
  });
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        settingsItem(),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: '文件',
      submenu: [
        { label: '新建标签页', accelerator: 'CmdOrCtrl+T', registerAccelerator: false, click: () => sendShortcut('new-tab') },
        { label: '恢复关闭的标签页', accelerator: 'CmdOrCtrl+Shift+T', registerAccelerator: false, click: () => sendShortcut('restore-tab') },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', registerAccelerator: false, click: () => sendShortcut('close-tab') },
        { type: 'separator' },
        {
          label: '显示简介',
          accelerator: process.platform === 'darwin' ? 'Cmd+I' : 'Alt+Enter',
          registerAccelerator: false,
          click: () => sendShortcut('show-file-info')
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口', registerAccelerator: false },
        ...(process.platform !== 'darwin' ? [{ type: 'separator' }, settingsItem()] : [])
      ]
    },
    {
      label: '编辑',
      submenu: [
        editItem('撤销', 'undo', 'CmdOrCtrl+Z'),
        editItem('重做', 'redo', process.platform === 'darwin' ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        editItem('剪切', 'cut', 'CmdOrCtrl+X'),
        editItem('复制', 'copy', 'CmdOrCtrl+C'),
        {
          label: '复制为路径名',
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+C' : 'Ctrl+Shift+C',
          registerAccelerator: false,
          click: () => sendShortcut('copy-pathnames')
        },
        editItem('粘贴', 'paste', 'CmdOrCtrl+V'),
        editItem('全选', 'select-all', 'CmdOrCtrl+A')
      ]
    },
    {
      label: '前往',
      submenu: [
        {
          label: '前往文件夹…',
          accelerator: process.platform === 'darwin' ? 'Cmd+Shift+G' : 'Ctrl+L',
          registerAccelerator: false,
          click: () => sendShortcut('open-go-to-folder')
        }
      ]
    },
    {
      label: '显示',
      submenu: [
        { label: '文件浏览', click: () => sendShortcut('view:tree') },
        { label: '仪表盘', click: () => sendShortcut('view:dashboard') },
        { label: '开发任务', click: () => sendShortcut('view:tasks') },
        { label: '关系白板', click: () => sendShortcut('view:relationships') },
        { label: '文件操作历史', click: () => sendShortcut('open-file-history') },
        { type: 'separator' },
        { role: 'reload', label: '重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏幕' }
      ]
    },
    { role: 'windowMenu', label: '窗口' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ============ 自动升级 ============

function setupAutoUpdater() {
  if (!autoUpdater || isDev) return;

  // 配置:不自动下载,用户确认后再下载
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (!mainWindow) return;
    const version = info.version || '新版本';
    mainWindow.webContents.send('updater:available', {
      version,
      releaseNotes: info.releaseNotes || null,
      releaseDate: info.releaseDate || null
    });
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 ${version}`,
      detail: '是否立即下载更新?',
      buttons: ['下载更新', '稍后'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
        // 通知前端显示下载中状态
        mainWindow?.webContents.send('updater:downloading');
      }
    });
  });

  autoUpdater.on('update-not-available', () => {
    if (!mainWindow) return;
    mainWindow.webContents.send('updater:up-to-date');
  });

  autoUpdater.on('update-downloaded', () => {
    if (!mainWindow) return;
    mainWindow.webContents.send('updater:downloaded');
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新已下载',
      message: '更新已下载完成',
      detail: '是否立即重启应用以应用更新?',
      buttons: ['立即重启', '下次启动时安装'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    if (!mainWindow) return;
    mainWindow.webContents.send('updater:progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('自动升级错误:', err);
    if (!mainWindow) return;
    mainWindow.webContents.send('updater:error', err?.message || String(err));
  });

  // 启动后 10 秒检查更新(避免阻塞启动)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.warn('检查更新失败:', err?.message || err);
    });
  }, 10000);
}

// IPC:手动检查更新
registerTrustedHandler('updater:check', async () => {
  if (!autoUpdater || isDev) {
    return { available: false, reason: 'development' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const updateInfo = result?.updateInfo;
    const available = isNewerVersion(updateInfo?.version, app.getVersion());
    return {
      available,
      currentVersion: app.getVersion(),
      version: updateInfo?.version || null,
      releaseNotes: updateInfo?.releaseNotes || null,
      releaseDate: updateInfo?.releaseDate || null
    };
  } catch (err) {
    return { available: false, error: err?.message || String(err) };
  }
});

// IPC:获取当前版本
registerTrustedHandler('app:get-version', () => {
  return app.getVersion();
});

registerTrustedHandler('app:perform-native-edit', (event, action) => {
  const methods = {
    undo: 'undo',
    redo: 'redo',
    cut: 'cut',
    copy: 'copy',
    paste: 'paste',
    'select-all': 'selectAll'
  };
  const method = methods[String(action || '')];
  if (!method || event.sender.isDestroyed()) return false;
  const command = event.sender[method];
  if (typeof command !== 'function') return false;
  command.call(event.sender);
  return true;
});

// IPC:下载更新
registerTrustedHandler('updater:download', () => {
  if (!autoUpdater || isDev) return false;
  autoUpdater.downloadUpdate();
  return true;
});

// IPC:退出并安装
registerTrustedHandler('updater:install', () => {
  if (!autoUpdater || isDev) return false;
  autoUpdater.quitAndInstall();
  return true;
});

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  registerFilesystemIPC();
  registerClipboardIPC();
  registerFileOperationsIPC();
  registerContentIPC({
    indexFilePath: path.join(app.getPath('userData'), 'workspace-content-index.json')
  });
  registerGitIPC();
  registerProjectTasksIPC();
  registerLocalProjectsIPC();
  registerRelationshipBoardsIPC();
  registerConfigIPC();
  registerTerminalHandlers();

  setupApplicationMenu();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch(error => {
  writeStartupError('app.whenReady', error);
  dialog.showErrorBox('GitFinder 启动失败', `错误日志: ${startupLogPath}`);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
