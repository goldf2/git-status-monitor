const { exec } = require('node:child_process');
const { BrowserWindow, dialog } = require('electron');
const { registerTrustedHandler } = require('./security');
const developerToolService = require('../services/developerToolService');
const fileService = require('../services/fileService');
const ipcMain = { handle: registerTrustedHandler };

function resolveWorkingDirectory(cwd) {
  const result = fileService.resolveWorkspacePath(cwd);
  return result.ok && result.type === 'directory' ? result.path : null;
}

function resolveManagedTarget(targetPath) {
  const result = fileService.resolveWorkspacePath(targetPath);
  return result.ok && ['directory', 'file'].includes(result.type) ? result.path : null;
}

async function confirmTerminalCommand(event, command, workingDirectory) {
  const options = {
    type: 'warning',
    title: '确认执行终端命令',
    message: '要在内嵌终端中执行这条命令吗？',
    detail: `工作目录：${workingDirectory}\n\n${command}\n\n命令将由系统 shell 执行，可能修改项目文件或访问其他本机位置。`,
    buttons: ['取消', '执行'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  };
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  return result.response === 1;
}

function registerTerminalHandlers() {
  // 在指定目录执行命令,返回输出
  ipcMain.handle('terminal:execute', async (event, command, cwd) => {
    if (!command || typeof command !== 'string' || command.includes('\0') || command.length > 10000) {
      return { exitCode: 1, stdout: '', stderr: '无效命令' };
    }
    const workingDirectory = resolveWorkingDirectory(cwd);
    if (!workingDirectory) {
      return { exitCode: 1, stdout: '', stderr: '工作目录不在受管开发目录中或不可用' };
    }
    if (!await confirmTerminalCommand(event, command, workingDirectory)) {
      return { exitCode: 130, stdout: '', stderr: '已取消执行', cancelled: true };
    }

    return new Promise((resolve) => {
      const timeout = 60000; // 60秒超时
      exec(command, {
        cwd: workingDirectory,
        timeout: timeout,
        maxBuffer: 1024 * 1024 * 5, // 5MB 输出限制
        env: { ...process.env, FORCE_COLOR: '0' }, // 禁用 ANSI 颜色
        shell: process.env.SHELL || true
      }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            exitCode: error.code || 1,
            stdout: stdout || '',
            stderr: stderr || error.message
          });
        } else {
          resolve({
            exitCode: 0,
            stdout: stdout || '',
            stderr: stderr || ''
          });
        }
      });
    });
  });

  // 在外部终端打开(系统默认终端)
  ipcMain.handle('terminal:getCapabilities', async () => developerToolService.discover());

  ipcMain.handle('terminal:selectExecutable', async (event, kind) => {
    const title = kind === 'terminal' ? '选择终端程序' : '选择代码编辑器';
    const result = await dialog.showOpenDialog({
      title,
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: '可执行程序', extensions: ['exe', 'cmd', 'bat'] }] : []
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  ipcMain.handle('terminal:openExternal', async (event, cwd, preferred) => {
    const workingDirectory = resolveWorkingDirectory(cwd);
    if (!workingDirectory) return false;
    try {
      return developerToolService.openTerminal(workingDirectory, preferred);
    } catch (e) {
      return { opened: false, reason: e.message || String(e) };
    }
  });

  ipcMain.handle('terminal:openInEditor', async (event, targetPath, preferred) => {
    const managedTarget = resolveManagedTarget(targetPath);
    if (!managedTarget) return { opened: false, reason: '路径不在受管开发目录中或不可用' };
    try {
      return developerToolService.openEditor(managedTarget, preferred);
    } catch (e) {
      return { opened: false, reason: e.message || String(e) };
    }
  });
}

module.exports = { registerTerminalHandlers };
