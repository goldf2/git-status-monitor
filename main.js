const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerFilesystemIPC } = require('./src/main/ipc/filesystem');
const { registerGitIPC } = require('./src/main/ipc/git');
const { registerConfigIPC } = require('./src/main/ipc/config');
const { registerTerminalHandlers } = require('./src/main/ipc/terminal');

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

app.whenReady().then(() => {
  registerFilesystemIPC();
  registerGitIPC();
  registerConfigIPC();
  registerTerminalHandlers();

  createWindow();

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
