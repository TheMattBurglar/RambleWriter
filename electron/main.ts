import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { SidecarManager } from './sidecarManager';

let mainWindow: BrowserWindow | null = null;
const sidecarManager = new SidecarManager();

let WORKSPACE_DIR = '';
let configPath = '';

function loadWorkspacePath(): string {
  try {
    if (fs.existsSync(configPath)) {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (saved.workspacePath && fs.existsSync(saved.workspacePath)) {
        return saved.workspacePath;
      }
    }
  } catch {}
  return path.join(app.getPath('documents'), 'RambleWriter');
}

function saveWorkspacePath(dir: string): void {
  try {
    fs.writeFileSync(configPath, JSON.stringify({ workspacePath: dir }), 'utf-8');
  } catch (err) {
    console.error('Failed to save workspace config:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
    title: 'RambleWriter',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Check if we are running in dev mode
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    // Open DevTools in dev mode by default (commented out for clean launch)
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  configPath = path.join(app.getPath('userData'), 'workspace-config.json');
  WORKSPACE_DIR = loadWorkspacePath();
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  sidecarManager.stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for Filesystem Access
ipcMain.handle('list-files', async () => {
  try {
    const files = fs.readdirSync(WORKSPACE_DIR);
    return files
      .filter(file => file.endsWith('.md'))
      .map(file => {
        const filePath = path.join(WORKSPACE_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          mtime: stats.mtimeMs,
        };
      })
      .sort((a, b) => b.mtime - a.mtime); // Sort by modified time (recent first)
  } catch (error) {
    console.error('Error listing files:', error);
    throw error;
  }
});

ipcMain.handle('read-file', async (_, filename: string) => {
  try {
    const safePath = path.join(WORKSPACE_DIR, path.basename(filename));
    if (fs.existsSync(safePath)) {
      return fs.readFileSync(safePath, 'utf-8');
    }
    return '';
  } catch (error) {
    console.error('Error reading file:', error);
    throw error;
  }
});

ipcMain.handle('write-file', async (_, filename: string, content: string) => {
  try {
    const safePath = path.join(WORKSPACE_DIR, path.basename(filename));
    fs.writeFileSync(safePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Error writing file:', error);
    throw error;
  }
});

ipcMain.handle('create-file', async (_, filename: string) => {
  try {
    let cleanName = path.basename(filename);
    if (!cleanName.endsWith('.md')) {
      cleanName += '.md';
    }
    const safePath = path.join(WORKSPACE_DIR, cleanName);
    if (!fs.existsSync(safePath)) {
      fs.writeFileSync(safePath, '', 'utf-8');
      return { success: true, name: cleanName };
    }
    throw new Error('File already exists');
  } catch (error) {
    console.error('Error creating file:', error);
    throw error;
  }
});

ipcMain.handle('rename-file', async (_, oldFilename: string, newFilename: string) => {
  try {
    const oldPath = path.join(WORKSPACE_DIR, path.basename(oldFilename));
    const newPath = path.join(WORKSPACE_DIR, path.basename(newFilename));
    if (!fs.existsSync(oldPath)) {
      throw new Error('File not found');
    }
    if (fs.existsSync(newPath)) {
      throw new Error('A file with that name already exists');
    }
    fs.renameSync(oldPath, newPath);
    return { success: true };
  } catch (error) {
    console.error('Error renaming file:', error);
    throw error;
  }
});

ipcMain.handle('delete-file', async (_, filename: string) => {
  try {
    const safePath = path.join(WORKSPACE_DIR, path.basename(filename));
    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
      return { success: true };
    }
    throw new Error('File not found');
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
});

ipcMain.handle('get-workspace-path', () => {
  return WORKSPACE_DIR;
});

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Choose Writing Folder',
    defaultPath: WORKSPACE_DIR || app.getPath('documents'),
    buttonLabel: 'Open Folder',
  });

  if (!result.canceled && result.filePaths.length > 0) {
    WORKSPACE_DIR = result.filePaths[0];
    saveWorkspacePath(WORKSPACE_DIR);
    if (!fs.existsSync(WORKSPACE_DIR)) {
      fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    }
    return { success: true, path: WORKSPACE_DIR };
  }

  return { success: false, path: WORKSPACE_DIR };
});

// IPC handlers for llama.cpp Sidecar Process
ipcMain.handle('sidecar:get-status', () => {
  return sidecarManager.getStatus();
});

ipcMain.handle('sidecar:bootstrap', async () => {
  if (mainWindow) {
    await sidecarManager.bootstrap(mainWindow);
  }
  return { success: true };
});

ipcMain.handle('sidecar:start', async () => {
  if (mainWindow) {
    await sidecarManager.startServer(mainWindow);
  }
  return { success: true };
});

ipcMain.handle('sidecar:stop', () => {
  sidecarManager.stopServer();
  return { success: true };
});

ipcMain.handle('sidecar:scan-sentence', async (_, originalText: string) => {
  try {
    const corrected = await sidecarManager.queryProofread(originalText);
    return { success: true, corrected };
  } catch (error: any) {
    console.error('Error scanning sentence:', error);
    return { success: false, error: error.message };
  }
});
