process.env.ELECTRON_DISABLE_CRASH_REPORTER = '1';
process.env.ELECTRON_NO_ATTACH_CONSOLE = '1';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');      // 新增
const unzipper = require('unzipper');      // 新增
const { execSync } = require('child_process');
const { exec } = require('child_process');
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 620,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      // 🔥 添加以下配置
      webSecurity: false  // 允许跨域文件访问
    }
  });
   // 🔥 允许拖拽文件
  mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
    // 处理下载
  });
  mainWindow.setMenu(null);
  mainWindow.loadFile('src/index.html');
  // 隐藏默认菜单栏
  mainWindow.setMenu(null);
  // mainWindow.webContents.openDevTools();  // ← 调试代码
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- 处理拖拽文件 ----------
// 在主进程中监听渲染进程的拖拽请求
ipcMain.handle('get-dropped-file-path', async (event, fileData) => {
  // 返回文件路径
  return fileData;
});
ipcMain.handle('resolve-dropped-file', async (event, fileInfo) => {
  try {
    // 由于无法从渲染进程直接获取文件路径，我们让用户选择
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: '请选择您拖入的文件: ' + (fileInfo.name || '')
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return { path: result.filePaths[0] };
    }
    return { path: null };
  } catch (err) {
    console.error('解析文件路径失败:', err);
    return { path: null };
  }
});
// ---------- 选择文件夹 ----------
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择加密文件所在文件夹'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});
// ---------- 加密核心函数 ----------
function deriveKey(password, salt) {
  const usedSalt = salt || Buffer.from('pocket_safe_salt_2024');
  return crypto.pbkdf2Sync(password, usedSalt, 100000, 32, 'sha256');
}
// ---------- 文件夹打包/解包函数 ----------
function zipFolder(folderPath, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      console.log('ZIP 创建成功:', zipPath);
      resolve();
    });
    
    archive.on('error', (err) => {
      console.error('归档出错:', err);
      reject(err);
    });
    
    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });
}

function unzipFolder(zipPath, targetPath) {
  return new Promise((resolve, reject) => {
    console.log('unzipFolder 开始:', zipPath, '->', targetPath);
    
    // 确保目标目录不存在
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    
    // 创建目标目录
    fs.mkdirSync(targetPath, { recursive: true });
    
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: targetPath }))
      .on('close', () => {
        console.log('unzipFolder 完成:', targetPath);
        resolve();
      })
      .on('error', (err) => {
        console.error('unzipFolder 失败:', err);
        reject(err);
      });
  });
}

// ---------- 判断是否为文件夹 ----------
function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}
// ---------- 核心加密 ----------
function encryptFile(filePath, password) {
  const normalizedPath = path.resolve(filePath);
  
  // 🔥 改为 32 字节盐值
  const salt = crypto.randomBytes(32);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const data = fs.readFileSync(normalizedPath);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // 存储: [盐值 32] [IV 16] [AuthTag 16] [密文]
  const result = Buffer.concat([salt, iv, authTag, encrypted]);
  return result;
}

// ---------- 核心解密（兼容新旧格式） ----------
function decryptFile(encryptedPath, password) {
  const resolvedPath = path.resolve(encryptedPath);
  console.log('decryptFile 读取加密文件:', resolvedPath);
  
  const data = fs.readFileSync(resolvedPath);
  
  // 新格式: [盐值 32] [IV 16] [AuthTag 16] [密文] → 最小 65 字节
  // 旧格式: [IV 16] [AuthTag 16] [密文] → 最小 33 字节
  
  let decrypted = null;
  
  // 🔥 先尝试新格式（随机盐值，32字节）
  try {
    const salt = data.subarray(0, 32);
    const key = deriveKey(password, salt);
    const iv = data.subarray(32, 48);
    const authTag = data.subarray(48, 64);
    const encrypted = data.subarray(64);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    console.log('✅ 使用新格式（32字节随机盐值）解密成功');
    return decrypted;
  } catch (err) {
    console.log('新格式解密失败，尝试旧格式...');
  }
  
  // 🔥 再尝试旧格式（固定盐值）
  try {
    const key = deriveKey(password);
    const iv = data.subarray(0, 16);
    const authTag = data.subarray(16, 32);
    const encrypted = data.subarray(32);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    console.log('✅ 使用旧格式（固定盐值）解密成功');
    return decrypted;
  } catch (err) {
    console.error('❌ 两种格式都解密失败');
    throw new Error('密码错误或文件已损坏');
  }
}
// ---------- 获取文件路径 ----------
ipcMain.handle('get-file-path', async (event, fileInfo) => {
  try {
    // 如果 fileInfo 中有 path，直接返回
    if (fileInfo && fileInfo.path) {
      return fileInfo.path;
    }
    // 否则通过 dialog 让用户选择
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: '请选择要加密的文件'
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  } catch (err) {
    console.error('获取文件路径失败:', err);
    return null;
  }
});
// ---------- IPC 通信 ----------
ipcMain.handle('encrypt-file', async (event, filePath, password) => {
  try {
    const resolvedPath = path.resolve(filePath);
    console.log('加密开始，路径:', resolvedPath);
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('文件或文件夹不存在: ' + resolvedPath);
    }
    
    let fileToEncrypt = resolvedPath;
    let isFolder = false;
    
    // 判断是否为文件夹
    if (isDirectory(resolvedPath)) {
      isFolder = true;
      console.log('检测到文件夹，开始打包...');
      
      const dirName = path.basename(resolvedPath);
      const parentDir = path.dirname(resolvedPath);
      const zipPath = path.join(parentDir, dirName + '.tmp.zip');
      
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
      
      await zipFolder(resolvedPath, zipPath);
      console.log('打包完成:', zipPath);
      fileToEncrypt = zipPath;
    }
    
    // 🔥 使用新的加密函数（随机盐值）
    console.log('开始加密:', fileToEncrypt);
    const encryptedData = encryptFile(fileToEncrypt, password);
    const outputPath = resolvedPath + '.pse';
    fs.writeFileSync(outputPath, encryptedData);
    console.log('加密完成，输出:', outputPath);
    
    // 删除临时 ZIP（如果是文件夹加密）
    if (isFolder && fs.existsSync(fileToEncrypt)) {
      fs.unlinkSync(fileToEncrypt);
      console.log('临时 ZIP 已删除:', fileToEncrypt);
    }
    
    // ============================================================
    // 🔥 删除原文件/文件夹（关键修复：普通文件也要删除）
    // ============================================================
    try {
      if (fs.existsSync(resolvedPath)) {
        console.log('准备删除原路径:', resolvedPath);
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // 🔥 使用 Python 脚本删除（文件或文件夹都支持）
        const deleted = await deleteFileWithPython(resolvedPath);
        
        if (deleted) {
          console.log('✅ Python 删除成功:', resolvedPath);
        } else {
          // 检查文件是否已经被删除
          if (!fs.existsSync(resolvedPath)) {
            console.log('✅ 文件已被删除（可能已被 Python 删除）');
          } else {
            console.warn('⚠️ Python 删除失败，尝试备用方法...');
            try {
              if (isFolder) {
                // 文件夹：使用 cmd rd 命令
                const { execSync } = require('child_process');
                execSync(`rd /s /q "${resolvedPath}" 2>nul`, { stdio: 'ignore' });
                console.log('✅ cmd 备用删除成功:', resolvedPath);
              } else {
                // 🔥 普通文件：使用 fs.unlinkSync 备用
                fs.unlinkSync(resolvedPath);
                console.log('✅ fs.unlinkSync 备用删除成功:', resolvedPath);
              }
            } catch (fallbackErr) {
              console.error('❌ 备用删除失败:', fallbackErr.message);
            }
          }
        }
      } else {
        console.log('⚠️ 原路径已不存在，跳过删除');
      }
    } catch (deleteErr) {
      console.error('删除操作失败:', deleteErr);
      // 不抛出错误，加密已经完成
    }
    
    return { success: true, outputPath, isFolder };
    
  } catch (err) {
    console.error('加密失败:', err);
    let userMessage = err.message;
    if (userMessage.includes('ENOENT') || userMessage.includes('no such file')) {
      userMessage = '找不到文件或文件夹，请确认文件是否存在';
    } else if (userMessage.includes('EACCES') || userMessage.includes('permission')) {
      userMessage = '权限不足，请确认您有读取该文件的权限';
    } else if (userMessage.includes('EISDIR')) {
      userMessage = '无法加密，请选择文件而不是文件夹（如需加密文件夹请拖拽）';
    }
    return { success: false, error: userMessage };
  }
});
// ---------- 检查文件是否存在 ----------
function checkFileExistsWithPython(filePath) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'delete_file.py');
    const escapedPath = filePath.replace(/\\/g, '\\\\');
    
    // 确保 exec 可用
    const { exec } = require('child_process');
    
    exec(`python "${scriptPath}" "${escapedPath}" --check`, (error, stdout, stderr) => {
      if (error) {
        console.error('Python 检查失败:', error.message);
        // 备用：使用 fs 检查
        try {
          const exists = fs.existsSync(filePath);
          resolve(exists);
        } catch {
          resolve(false);
        }
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        resolve(result.exists);
      } catch (parseErr) {
        console.error('解析检查结果失败:', parseErr);
        try {
          const exists = fs.existsSync(filePath);
          resolve(exists);
        } catch {
          resolve(false);
        }
      }
    });
  });
}

ipcMain.handle('check-file-exists', async (event, filePath) => {
  try {
    const exists = await checkFileExistsWithPython(filePath);
    return { exists };
  } catch (err) {
    return { exists: false, error: err.message };
  }
});
function isZipFile(filePath) {
  try {
    const buffer = fs.readFileSync(filePath, { length: 4 });
    // ZIP 文件头：PK\x03\x04 或 PK\x05\x06 或 PK\x07\x08
    return buffer.length >= 4 &&
      ((buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) ||
       (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x05 && buffer[3] === 0x06) ||
       (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x07 && buffer[3] === 0x08));
  } catch {
    return false;
  }
}

// 检测是否为文件夹（通过原文件名判断）
function isFolderName(fileName) {
  // 如果原文件名没有扩展名，或者扩展名是 .zip，可能是文件夹
  const ext = path.extname(fileName);
  return !ext || ext === '.zip' || ext === '';
}
ipcMain.handle('decrypt-file', async (event, filePath, password) => {
  try {
    const resolvedPath = path.resolve(filePath);
    console.log('解密开始，加密文件路径:', resolvedPath);
    
    const decryptedData = decryptFile(resolvedPath, password);
    const originalName = path.basename(resolvedPath, '.pse');
    
    // 🔥 使用加密文件所在目录
    const fileDir = path.dirname(resolvedPath);
    let outputPath = path.join(fileDir, originalName);
    
    // 如果目标路径已存在，自动添加后缀
    let finalOutputPath = outputPath;
    let counter = 1;
    while (fs.existsSync(finalOutputPath)) {
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);
      finalOutputPath = path.join(fileDir, `${base}_解密还原${counter}${ext}`);
      counter++;
    }
    outputPath = finalOutputPath;
    
    console.log('解密后输出路径:', outputPath);
    
    // 写入解密后的数据
    fs.writeFileSync(outputPath, decryptedData);
    console.log('解密数据已写入:', outputPath);
    
    // 检测是否为 ZIP 文件
    const buffer = fs.readFileSync(outputPath);
    const isZip = buffer.length >= 4 && (
      (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) ||
      (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x05 && buffer[3] === 0x06) ||
      (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x07 && buffer[3] === 0x08)
    );
    
    console.log('ZIP 检测结果 (文件头):', isZip);
    console.log('文件大小:', buffer.length, '字节');
    
    let shouldUnzip = isZip;
    
    if (!shouldUnzip && outputPath.endsWith('.zip')) {
      shouldUnzip = true;
    }
    
    console.log('是否尝试解压:', shouldUnzip);
    
    let finalResultPath = outputPath;
    let isFolder = false;
    
    if (shouldUnzip) {
      try {
        const baseName = path.basename(outputPath, '.zip');
        const folderName = baseName || originalName;
        const extractPath = path.join(fileDir, folderName + '_extracted');
        
        if (fs.existsSync(extractPath)) {
          fs.rmSync(extractPath, { recursive: true, force: true });
        }
        
        console.log('开始解压到:', extractPath);
        await unzipFolder(outputPath, extractPath);
        console.log('解压完成');
        
        fs.unlinkSync(outputPath);
        console.log('已删除临时 ZIP');
        
        let finalFolderName = folderName;
        let finalFolderPath = path.join(fileDir, finalFolderName);
        let folderCounter = 1;
        while (fs.existsSync(finalFolderPath)) {
          finalFolderPath = path.join(fileDir, `${finalFolderName}_解密还原${folderCounter}`);
          folderCounter++;
        }
        
        fs.renameSync(extractPath, finalFolderPath);
        console.log('文件夹还原完成:', finalFolderPath);
        
        finalResultPath = finalFolderPath;
        isFolder = true;
        
      } catch (unzipErr) {
        console.error('解压失败:', unzipErr);
        isFolder = false;
      }
    }
    
    // ============================================================
    // 🔥 删除 .pse 加密文件（关键！）
    // ============================================================
    try {
      if (fs.existsSync(resolvedPath)) {
        console.log('准备删除加密文件:', resolvedPath);
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const deleted = await deleteFileWithPython(resolvedPath);
        
        if (deleted) {
          console.log('✅ Python 已删除加密文件:', resolvedPath);
        } else {
          console.warn('⚠️ Python 删除失败，尝试备用方法...');
          if (fs.existsSync(resolvedPath)) {
            try {
              fs.unlinkSync(resolvedPath);
              console.log('✅ 备用方法删除成功:', resolvedPath);
            } catch (fallbackErr) {
              console.error('❌ 备用方法也失败:', fallbackErr.message);
            }
          } else {
            console.log('✅ 文件已被删除');
          }
        }
      }
    } catch (deleteErr) {
      console.error('删除加密文件失败:', deleteErr);
    }
    
    return { 
      success: true, 
      outputPath: finalResultPath, 
      isFolder: isFolder,
      deletedPse: true
    };
    
  } catch (err) {
    console.error('解密失败:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile','openDirectory'],
    title: '选择要加密的文件',
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-desktop-path', () => {
  return app.getPath('desktop');
});

ipcMain.handle('list-pse-files', async (event, folderPath) => {
   try {
    const targetDir = folderPath || app.getPath('desktop');
    console.log('📂 [list-pse-files] 扫描目录:', targetDir);
    
    const files = fs.readdirSync(targetDir, { encoding: 'utf8' });
    const pseFiles = files
      .filter(f => f.endsWith('.pse'))
      .map(f => ({
        name: f,
        path: path.join(targetDir, f)
      }));
    
    console.log('📋 [list-pse-files] 找到 .pse 文件:', pseFiles);
    return pseFiles;
  } catch (err) {
    console.error('[list-pse-files] 错误:', err);
    return [];
  }
});
// 在 main.js 中添加弹窗 IPC
ipcMain.handle('show-dialog', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: options.type || 'info',
    title: options.title || '提示',
    message: options.message || '',
    buttons: ['确定']
  });
  return result;
});
// ---------- 遍历目录，查找文件 ----------
ipcMain.handle('list-desktop-files', async () => {
  try {
    const desktop = app.getPath('desktop');
    console.log('📂 遍历桌面目录:', desktop);
    const files = fs.readdirSync(desktop);
    console.log('📋 桌面所有文件:', files);
    
    // 返回所有文件信息
    const fileDetails = files.map(f => {
      const fullPath = path.join(desktop, f);
      try {
        const stat = fs.statSync(fullPath);
        return {
          name: f,
          path: fullPath,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          size: stat.size,
          mtime: stat.mtime
        };
      } catch (err) {
        return {
          name: f,
          path: fullPath,
          error: err.message
        };
      }
    });
    
    return { success: true, files: fileDetails, desktop };
  } catch (err) {
    console.error('遍历桌面失败:', err);
    return { success: false, error: err.message };
  }
});
function deleteFileWithPython(filePath) {
  try {
    // 获取 Python 脚本的绝对路径
    const scriptPath = path.join(__dirname, 'delete_file.py');
    
    // 调用 Python 脚本
    const result = execSync(
      `python "${scriptPath}" "${filePath}"`,
      { 
        stdio: 'pipe', 
        encoding: 'utf-8',
        timeout: 30000 // 30秒超时
      }
    );
    
    console.log('Python 删除输出:', result);
    return true;
  } catch (err) {
    console.error('Python 删除失败:', err.message);
    return false;
  }
}