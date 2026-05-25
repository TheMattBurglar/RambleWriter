import { contextBridge, ipcRenderer } from 'electron';

export interface FileInfo {
  name: string;
  size: number;
  mtime: number;
}

const fileSystemApi = {
  listFiles: (): Promise<FileInfo[]> => ipcRenderer.invoke('list-files'),
  readFile: (filename: string): Promise<string> => ipcRenderer.invoke('read-file', filename),
  writeFile: (filename: string, content: string): Promise<{ success: boolean }> => ipcRenderer.invoke('write-file', filename, content),
  createFile: (filename: string): Promise<{ success: boolean, name: string }> => ipcRenderer.invoke('create-file', filename),
  deleteFile: (filename: string): Promise<{ success: boolean }> => ipcRenderer.invoke('delete-file', filename),
  renameFile: (oldFilename: string, newFilename: string): Promise<{ success: boolean }> => ipcRenderer.invoke('rename-file', oldFilename, newFilename),
  getWorkspacePath: (): Promise<string> => ipcRenderer.invoke('get-workspace-path'),
  openFolderDialog: (): Promise<{ success: boolean; path: string }> => ipcRenderer.invoke('open-folder-dialog'),
  
  // llama.cpp Sidecar Process APIs
  sidecarGetStatus: (): Promise<string> => ipcRenderer.invoke('sidecar:get-status'),
  sidecarBootstrap: (): Promise<{ success: boolean }> => ipcRenderer.invoke('sidecar:bootstrap'),
  sidecarStart: (): Promise<{ success: boolean }> => ipcRenderer.invoke('sidecar:start'),
  sidecarStop: (): Promise<{ success: boolean }> => ipcRenderer.invoke('sidecar:stop'),
  sidecarScanSentence: (originalText: string): Promise<{ success: boolean, corrected?: string, error?: string }> => 
    ipcRenderer.invoke('sidecar:scan-sentence', originalText),
  
  // Sidecar status event stream listener
  onSidecarStatus: (callback: (status: string, details?: string, progress?: number) => void) => {
    const subscription = (_event: any, status: string, details?: string, progress?: number) => callback(status, details, progress);
    ipcRenderer.on('sidecar-status', subscription);
    return () => {
      ipcRenderer.off('sidecar-status', subscription);
    };
  },

};

// Expose the API to the window object in the renderer process
contextBridge.exposeInMainWorld('api', fileSystemApi);
