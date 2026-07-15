const { ipcRenderer, shell } = require('electron');
const { webUtils } = require('electron');
// ---------- DOM 引用 ----------
const passwordInput = document.getElementById('passwordInput');
const unlockBtn = document.getElementById('unlockBtn');
const statusBar = document.getElementById('statusBar');
const dropZone = document.getElementById('dropZone');
const fileList = document.getElementById('fileList');
const decryptBtn = document.getElementById('decryptBtn');
const selectFileBtn = document.getElementById('selectFileBtn');
const refreshBtn = document.getElementById('refreshBtn');
const path = require('path');
const fs = require('fs');
// 弹窗 DOM
const dialogOverlay = document.getElementById('customDialog');
const dialogIcon = document.getElementById('dialogIcon');
const dialogTitle = document.getElementById('dialogTitle');
const dialogMessage = document.getElementById('dialogMessage');
const dialogBtn = document.getElementById('dialogBtn');
// ---------- 切换文件夹按钮 ----------
document.getElementById('changeFolderBtn').addEventListener('click', selectFolder);

let isUnlocked = false;
let currentPassword = '';
let selectedFile = null;
let currentFolder = null;  // 当前浏览的文件夹路径，null 表示桌面
// ---------- 设置状态栏（支持类型样式） ----------
function setStatus(text, type = '') {
  statusBar.textContent = text;
  // 清除所有状态类
  statusBar.className = '';
  // 添加对应的类型类
  if (type) {
    statusBar.classList.add(type);
  } else if (text.includes('✅') || text.includes('成功')) {
    statusBar.classList.add('success');
  } else if (text.includes('⚠️') || text.includes('警告')) {
    statusBar.classList.add('warning');
  } else if (text.includes('❌') || text.includes('失败') || text.includes('错误')) {
    statusBar.classList.add('error');
  } else if (text.includes('加密中') || text.includes('解密中')) {
    statusBar.classList.add('encrypting');
  } else if (text.includes('解锁')) {
    statusBar.classList.add('unlocked');
  }
}

// 使用示例
setStatus('✅ 加密完成', 'success');
setStatus('⏳ 加密中...', 'encrypting');
setStatus('❌ 密码错误', 'error');
setStatus('⚠️ 请先解锁', 'warning');
setStatus('✅ 请先输入密码解锁', 'unlocked');
// ---------- 工具函数 ----------
function setStatus(text, isUnlockedStatus = false) {
  statusBar.textContent = text;
  statusBar.className = isUnlockedStatus ? 'unlocked' : '';
}
// 更新文件列表 UI
function updateFileList(files) {
  console.log('📋 updateFileList 被调用，文件数量:', files ? files.length : 0);
  
  // 清空列表
  while (fileList.firstChild) {
    fileList.removeChild(fileList.firstChild);
  }
  
  if (!files || files.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-msg';
    li.textContent = '（该文件夹暂无加密文件）';
    fileList.appendChild(li);
    decryptBtn.disabled = true;
    selectedFile = null;
    console.log('📋 列表已清空（空状态）');
    return;
  }
  
  // 遍历文件列表
  files.forEach((item, index) => {
    const li = document.createElement('li');
    
    // 兼容两种格式：字符串或对象
    let fileName, filePath;
    if (typeof item === 'string') {
      fileName = item;
      filePath = item;
    } else if (item && typeof item === 'object') {
      fileName = item.name || item.fileName || '未知文件';
      filePath = item.path || item.filePath || fileName;
    } else {
      fileName = '未知文件';
      filePath = fileName;
    }
    
    li.textContent = '🔒 ' + fileName;
    li.dataset.path = filePath;
    li.dataset.index = index;
    
    li.addEventListener('click', () => {
      // 移除其他选中状态
      document.querySelectorAll('#fileList li').forEach(el => el.classList.remove('selected'));
      li.classList.add('selected');
      selectedFile = filePath;  // ✅ filePath 是完整路径
      decryptBtn.disabled = false;
      console.log('✅ 选中文件完整路径:', filePath);
    });
    
    fileList.appendChild(li);
  });
  
  // 默认禁用解密按钮
  decryptBtn.disabled = true;
  selectedFile = null;
  console.log('📋 列表已更新，共', files.length, '个文件');
}
// ---------- 选择文件夹 ----------
async function selectFolder() {
  const result = await ipcRenderer.invoke('select-folder');
  if (result) {
    currentFolder = result;
    // 更新标签显示
    const label = document.getElementById('currentFolderLabel');
    if (currentFolder) {
      const folderName = currentFolder.split('\\').pop();
      label.textContent = '📁 ' + folderName;
    } else {
      label.textContent = '📁 桌面';
    }
    await refreshFileList();
  }
}


// ---------- 刷新文件列表 ----------
async function refreshFileList() {
  try {
    console.log('🔄 [refreshFileList] 开始刷新...');
    const files = await ipcRenderer.invoke('list-pse-files', currentFolder);
    console.log('📋 [refreshFileList] 获取到文件列表:', files);
    updateFileList(files);
    console.log('✅ [refreshFileList] 更新完成');
  } catch (err) {
    console.error('❌ [refreshFileList] 失败:', err);
  }
}
// ============================================================
// 获取路径的辅助函数（在 drop 事件之前定义）
// ============================================================
function getFullPath(entry) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      let filePath = null;
      
      // 使用 entry.fullPath 获取相对路径
      let relativePath = entry.fullPath;
      console.log('entry.fullPath:', relativePath);
      
      if (relativePath && relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }
      
      // 如果路径包含盘符（如 C:/ 或 F:/），直接使用
      if (relativePath && relativePath.match(/^[A-Z]:/i)) {
        filePath = relativePath.replace(/\//g, '\\');
      } else if (relativePath) {
        // 相对路径：从当前文件夹或桌面拼接
        let basePath = currentFolder || `C:\\Users\\${require('os').userInfo().username}\\Desktop`;
        const cleanPath = relativePath.replace(/^[\\\/]/, '');
        filePath = path.join(basePath, cleanPath);
      }
      
      // 如果还是没获取到，从文件名构建
      if (!filePath && entry.name) {
        let basePath = currentFolder || `C:\\Users\\${require('os').userInfo().username}\\Desktop`;
        filePath = path.join(basePath, entry.name);
      }
      
      console.log('最终文件路径:', filePath);
      resolve(filePath);
      
    } else if (entry.isDirectory) {
      let folderPath = entry.fullPath;
      console.log('文件夹 fullPath:', folderPath);
      
      if (folderPath && folderPath.startsWith('/')) {
        folderPath = folderPath.slice(1);
      }
      
      if (folderPath && folderPath.match(/^[A-Z]:/i)) {
        folderPath = folderPath.replace(/\//g, '\\');
      } else if (folderPath) {
        let basePath = currentFolder || `C:\\Users\\${require('os').userInfo().username}\\Desktop`;
        const cleanPath = folderPath.replace(/^[\\\/]/, '');
        folderPath = path.join(basePath, cleanPath);
      }
      
      console.log('最终文件夹路径:', folderPath);
      resolve(folderPath);
      
    } else {
      resolve(null);
    }
  });
}


// ---------- 解锁 ----------
unlockBtn.addEventListener('click', async () => {
  const pwd = passwordInput.value.trim();
  if (!pwd) {
    setStatus('⚠️ 请输入主密码');
    return;
  }
  currentPassword = pwd;
  isUnlocked = true;
  passwordInput.disabled = true;
  unlockBtn.disabled = true;
  unlockBtn.textContent = '🔓 已解锁';
  
  // 自动填充解密密码框
  // decryptPasswordInput.value = pwd;
  
  setStatus('✅ 保险箱已解锁，可以拖入文件加密', true);
  await refreshFileList();
});

// ---------- 拖拽加密（支持文件和文件夹） ----------
// ---------- 拖拽加密 ----------
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');

  if (!isUnlocked) {
    setStatus('⚠️ 请先输入密码并点击解锁');
    return;
  }

  const files = e.dataTransfer.files;
  if (!files || files.length === 0) {
    setStatus('⚠️ 无法读取拖入内容');
    return;
  }

  const file = files[0];
  let fullPath = null;

  // 方法1：尝试 file.path
  if (file && file.path) {
    fullPath = file.path;
    console.log('✅ file.path:', fullPath);
  }

  // 方法2：如果 file.path 是 undefined，尝试其他属性
  if (!fullPath) {
    // 有些版本中，路径可能在 file.name 中（如果包含盘符）
    if (file.name && file.name.match(/^[A-Z]:/i)) {
      fullPath = file.name;
      console.log('✅ file.name 包含路径:', fullPath);
    }
  }

  // 方法3：通过 Electron 的 webUtils.getPathForFile
  if (!fullPath) {
    try {
      // 尝试动态导入 webUtils
      const { webUtils } = require('electron');
      if (webUtils && webUtils.getPathForFile) {
        fullPath = webUtils.getPathForFile(file);
        console.log('✅ webUtils 获取路径:', fullPath);
      }
    } catch (err) {
      console.log('webUtils 不可用');
    }
  }

  // 如果还是获取不到，自动弹出文件选择
  if (!fullPath) {
    setStatus('⚠️ 无法获取拖拽路径，请手动选择...');
    fullPath = await ipcRenderer.invoke('select-file');
    if (!fullPath) {
      setStatus('⚠️ 用户取消选择');
      return;
    }
  }

  console.log('最终路径:', fullPath);

  // 检查路径是否存在
  try {
    const fs = require('fs');
    if (!fs.existsSync(fullPath)) {
      setStatus('⚠️ 文件不存在: ' + fullPath);
      return;
    }
  } catch (err) {
    console.error('路径检查失败:', err);
    setStatus('⚠️ 路径检查失败');
    return;
  }

  if (fullPath.endsWith('.pse')) {
    setStatus('⚠️ 这是加密文件，请使用「解密」功能');
    return;
  }

  setStatus('⏳ 加密中...', true);
  try {
    const result = await ipcRenderer.invoke('encrypt-file', fullPath, currentPassword);
    if (result.success) {
      setStatus('✅ 加密完成: ' + result.outputPath, true);
      await refreshFileList();
    } else {
      setStatus('❌ 加密失败: ' + result.error);
    }
  } catch (err) {
    console.error('加密出错:', err);
    setStatus('❌ 加密出错: ' + err.message);
  }
});
// ---------- 选择文件加密 ----------
selectFileBtn.addEventListener('click', async () => {
  if (!isUnlocked) {
    setStatus('⚠️ 请先解锁');
    return;
  }
  const filePath = selectedFile;
  if (!filePath) return;

  if (filePath.endsWith('.pse')) {
    setStatus('⚠️ 这是加密文件，请使用「解密」功能');
    return;
  }

  setStatus('⏳ 加密中...', true);
  const result = await window.electronAPI.encryptFile(filePath, currentPassword);

  if (result.success) {
    setStatus('✅ 加密完成: ' + result.outputPath, true);
    await refreshFileList();
  } else {
    setStatus('❌ 加密失败: ' + result.error);
  }
});

// ---------- 解密选中文件（完全独立于解锁） ----------
decryptBtn.addEventListener('click', async () => {
  if (!selectedFile) {
    await showDialog({
      type: 'warning',
      icon: '⚠️',
      title: '提示',
      message: '请先选中一个加密文件'
    });
    return;
  }

  const decryptPwd = decryptPasswordInput.value.trim();
  if (!decryptPwd) {
    await showDialog({
      type: 'warning',
      icon: '⚠️',
      title: '提示',
      message: '请输入解密密码'
    });
    return;
  }

  // 🔥 关键修复：selectedFile 已经是完整路径，直接使用
  console.log('📂 解密文件路径:', selectedFile);

  setStatus('⏳ 解密中...', true);
  try {
    const result = await ipcRenderer.invoke('decrypt-file', selectedFile, decryptPwd);
    
    if (result.success) {
      await showDialog({
        type: 'success',
        icon: '✅',
        title: '解密成功',
        message: `文件已解密到:\n${result.outputPath}`
      });
      setStatus('✅ 已解密到: ' + result.outputPath, true);
      await refreshFileList();
      selectedFile = null;
      decryptBtn.disabled = true;
      decryptPasswordInput.value = '';
    } else {
      let userMessage = result.error;
      if (userMessage.includes('ENOENT') || userMessage.includes('no such file')) {
        userMessage = '找不到加密文件，请确认文件是否已被移动或删除';
      } else if (userMessage.includes('Unsupported state') || userMessage.includes('authenticate')) {
        userMessage = '密码错误，请确认您输入的是正确的解密密码';
      } else {
        userMessage = '解密失败: ' + result.error;
      }
      
      await showDialog({
        type: 'error',
        icon: '❌',
        title: '解密失败',
        message: userMessage
      });
      setStatus('❌ 解密失败: ' + userMessage);
    }
  } catch (err) {
    console.error('解密出错:', err);
    await showDialog({
      type: 'error',
      icon: '❌',
      title: '出错',
      message: '解密过程中发生未知错误:\n' + err.message
    });
    setStatus('❌ 解密出错: ' + err.message);
  }finally {
    decryptBtn.disabled = false;
    decryptBtn.textContent = '🔓 解密';
  }
});

// ---------- 刷新 ----------
refreshBtn.addEventListener('click', async () => {
  if (isUnlocked) await refreshFileList();
});

// ---------- 初始化 ----------
// 暴露 electronAPI 到 window（供渲染进程调用主进程）

window.electronAPI = {
  encryptFile: (filePath, password) => ipcRenderer.invoke('encrypt-file', filePath, password),
  decryptFile: (filePath, password) => ipcRenderer.invoke('decrypt-file', filePath, password),
  selectFile: () => ipcRenderer.invoke('select-file'),
  getDesktopPath: () => ipcRenderer.invoke('get-desktop-path'),
  listPseFiles: () => ipcRenderer.invoke('list-pse-files'),
};

refreshFileList();
// ---------- 自定义弹窗 ----------
function showDialog(options) {
  return new Promise((resolve) => {
    const glass = document.querySelector('.dialog-glass');
    const overlay = document.querySelector('.dialog-overlay');
    
    // 移除所有类型类
    glass.classList.remove('info', 'success', 'warning', 'error');
    glass.classList.add(options.type || 'info');
    
    dialogIcon.textContent = options.icon || '📢';
    dialogTitle.textContent = options.title || '提示';
    dialogMessage.textContent = options.message || '';
    
    // 重置动画（重新触发）
    glass.style.animation = 'none';
    overlay.style.animation = 'none';
    // 强制重排
    void glass.offsetHeight;
    // 恢复动画
    glass.style.animation = 'slideDown 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
    overlay.style.animation = 'overlayFadeIn 0.4s ease forwards';
    
    dialogOverlay.style.display = 'block';
    
    dialogBtn.onclick = () => {
      // 关闭时添加淡出动画
      glass.style.animation = 'slideUp 0.3s ease forwards';
      overlay.style.animation = 'overlayFadeOut 0.3s ease forwards';
      
      setTimeout(() => {
        dialogOverlay.style.display = 'none';
        // 重置动画
        glass.style.animation = '';
        overlay.style.animation = '';
        resolve();
      }, 350);
    };
  });
}
// 重写弹窗调用
window.showDialog = showDialog;
window.refreshFileList = refreshFileList;