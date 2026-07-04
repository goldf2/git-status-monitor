const { ipcMain } = require('electron');
const { exec } = require('child_process');
const path = require('path');

function registerTerminalHandlers() {
  // 在指定目录执行命令,返回输出
  ipcMain.handle('terminal:execute', async (event, command, cwd) => {
    if (!command || typeof command !== 'string') {
      return { exitCode: 1, stdout: '', stderr: '无效命令' };
    }

    // 安全:禁止危险命令
    const dangerous = ['rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:'];
    const cmdLower = command.toLowerCase();
    for (const d of dangerous) {
      if (cmdLower.includes(d)) {
        return { exitCode: 1, stdout: '', stderr: `禁止执行危险命令: ${d}` };
      }
    }

    return new Promise((resolve) => {
      const timeout = 60000; // 60秒超时
      exec(command, {
        cwd: cwd || process.cwd(),
        timeout: timeout,
        maxBuffer: 1024 * 1024 * 5, // 5MB 输出限制
        env: { ...process.env, FORCE_COLOR: '0' } // 禁用 ANSI 颜色
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
  ipcMain.handle('terminal:openExternal', async (event, cwd) => {
    const platform = process.platform;
    try {
      if (platform === 'darwin') {
        exec(`open -a Terminal "${cwd}"`);
      } else if (platform === 'win32') {
        exec(`start cmd /k "cd /d ${cwd}"`);
      } else {
        exec(`x-terminal-emulator --working-directory="${cwd}" || xterm`);
      }
      return true;
    } catch (e) {
      return false;
    }
  });
}

module.exports = { registerTerminalHandlers };
