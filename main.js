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
const path = require('path');
const { registerFilesystemIPC } = require('./src/main/ipc/filesystem');
const { registerGitIPC } = require('./src/main/ipc/git');
const { registerConfigIPC } = require('./src/main/ipc/config');
const { registerTerminalHandlers } = require('./src/main/ipc/terminal');

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'GitFinder',
    backgroundColor: '#f6f6f6',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      enableWebGL: true,
      experimentalFeatures: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
ipcMain.handle('updater:check', async () => {
  if (!autoUpdater || isDev) {
    return { available: false, reason: 'development' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const updateInfo = result?.updateInfo;
    return {
      available: !!updateInfo,
      version: updateInfo?.version || null,
      releaseNotes: updateInfo?.releaseNotes || null,
      releaseDate: updateInfo?.releaseDate || null
    };
  } catch (err) {
    return { available: false, error: err?.message || String(err) };
  }
});

// IPC:获取当前版本
ipcMain.handle('app:get-version', () => {
  return app.getVersion();
});

// IPC:下载更新
ipcMain.handle('updater:download', () => {
  if (!autoUpdater || isDev) return false;
  autoUpdater.downloadUpdate();
  return true;
});

// IPC:退出并安装
ipcMain.handle('updater:install', () => {
  if (!autoUpdater || isDev) return false;
  autoUpdater.quitAndInstall();
  return true;
});

app.whenReady().then(() => {
  registerFilesystemIPC();
  registerGitIPC();
  registerConfigIPC();
  registerTerminalHandlers();

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
