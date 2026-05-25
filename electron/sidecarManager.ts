import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
import { spawn, execSync, ChildProcess } from 'child_process';

const BINARY_VERSION = 'b9297';
const MODEL_URL = 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf';

export class SidecarManager {
  private localAiDir: string;
  private binaryPath: string;
  private modelPath: string;
  private serverProcess: ChildProcess | null = null;
  private port: number = 8080;
  private isDownloading: boolean = false;

  constructor() {
    // Save in user data directory (e.g., ~/.config/ramblewriter/local-ai/ on Linux)
    const userDataPath = app.getPath('userData');
    this.localAiDir = path.join(userDataPath, 'local-ai');
    
    // Create local AI folder if missing
    if (!fs.existsSync(this.localAiDir)) {
      fs.mkdirSync(this.localAiDir, { recursive: true });
    }

    this.binaryPath = this.findBinaryPath();
    this.modelPath = path.join(this.localAiDir, 'Qwen3-1.7B-Q4_K_M.gguf');
  }

  private findBinaryPath(): string {
    const isWindows = process.platform === 'win32';
    const exeName = isWindows ? 'llama-server.exe' : 'llama-server';
    
    const findRecursively = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        // Skip checking rootPath directly to prefer subdirectories
        if (fullPath === path.join(this.localAiDir, exeName)) {
          continue;
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          const found = findRecursively(fullPath);
          if (found) return found;
        } else if (file === exeName) {
          return fullPath;
        }
      }
      return null;
    };

    const foundSub = findRecursively(this.localAiDir);
    if (foundSub) {
      // Clean up legacy broken root binary if it exists
      const rootPath = path.join(this.localAiDir, exeName);
      if (fs.existsSync(rootPath)) {
        try {
          fs.unlinkSync(rootPath);
          console.log(`Automatically cleaned up legacy broken root binary at: ${rootPath}`);
        } catch (e) {
          console.error(`Failed to clean up legacy root binary:`, e);
        }
      }
      return foundSub;
    }

    return path.join(this.localAiDir, exeName);
  }

  public getStatus() {
    if (this.isDownloading) {
      return 'downloading';
    }
    this.binaryPath = this.findBinaryPath();
    const hasBinary = fs.existsSync(this.binaryPath);
    const hasModel = fs.existsSync(this.modelPath);
    
    if (hasBinary && hasModel) {
      return this.serverProcess ? 'running' : 'ready';
    }
    return 'missing';
  }

  public async bootstrap(mainWindow: BrowserWindow): Promise<void> {
    if (this.isDownloading) return;
    this.isDownloading = true;

    try {
      mainWindow.webContents.send('sidecar-status', 'downloading', 'Initializing download pipelines...', 0);

      // 1. Download & Extract llama-server if missing
      if (!fs.existsSync(this.binaryPath)) {
        mainWindow.webContents.send('sidecar-status', 'downloading', 'Downloading llama-server engine (Vulkan-accelerated)...', 0);
        
        let downloadUrl = '';
        let archiveExt = '.tar.gz';
        
        if (process.platform === 'win32') {
          downloadUrl = `https://github.com/ggml-org/llama.cpp/releases/download/${BINARY_VERSION}/llama-${BINARY_VERSION}-bin-win-vulkan-x64.zip`;
          archiveExt = '.zip';
        } else if (process.platform === 'darwin') {
          const macArch = process.arch === 'arm64' ? 'arm64' : 'x64';
          downloadUrl = `https://github.com/ggml-org/llama.cpp/releases/download/${BINARY_VERSION}/llama-${BINARY_VERSION}-bin-macos-${macArch}.tar.gz`;
          archiveExt = '.tar.gz';
        } else {
          // Default to Linux Vulkan
          downloadUrl = `https://github.com/ggml-org/llama.cpp/releases/download/${BINARY_VERSION}/llama-${BINARY_VERSION}-bin-ubuntu-vulkan-x64.tar.gz`;
          archiveExt = '.tar.gz';
        }

        const archivePath = path.join(this.localAiDir, `server-archive${archiveExt}`);
        await this.downloadWithProgress(downloadUrl, archivePath, (percent) => {
          mainWindow.webContents.send('sidecar-status', 'downloading', `Downloading llama-server engine (${percent}%)`, percent * 0.2); // First 20% of progress
        });

        mainWindow.webContents.send('sidecar-status', 'downloading', 'Extracting AI binaries...', 20);
        this.extractArchive(archivePath, archiveExt);
        fs.unlinkSync(archivePath); // Clean up archive
      }

      // 2. Download Qwen3-1.7B GGUF Model if missing
      if (!fs.existsSync(this.modelPath)) {
        mainWindow.webContents.send('sidecar-status', 'downloading', 'Downloading Qwen3-1.7B model weights (~1.1GB)...', 25);

        await this.downloadWithProgress(MODEL_URL, this.modelPath, (percent) => {
          // Map to 25% - 100% range
          const mappedPercent = 25 + Math.round(percent * 0.75);
          mainWindow.webContents.send('sidecar-status', 'downloading', `Downloading local AI model weights: Qwen3-1.7B (~1.1GB) — ${percent}%`, mappedPercent);
        });
      }

      this.isDownloading = false;
      mainWindow.webContents.send('sidecar-status', 'ready', 'Offline AI engine loaded successfully.');
    } catch (error: any) {
      this.isDownloading = false;
      console.error('Error bootstrapping AI assets:', error);
      mainWindow.webContents.send('sidecar-status', 'error', `Failed to load AI engine: ${error.message}`);
      throw error;
    }
  }

  public async startServer(mainWindow: BrowserWindow): Promise<void> {
    if (this.serverProcess) {
      return;
    }

    const hasBinary = fs.existsSync(this.binaryPath);
    const hasModel = fs.existsSync(this.modelPath);
    if (!hasBinary || !hasModel) {
      throw new Error('AI assets are not fully bootstrapped.');
    }

    return new Promise((resolve, reject) => {
      mainWindow.webContents.send('sidecar-status', 'starting', 'Starting offline AI background process...');
      
      const args = [
        '--model', this.modelPath,
        '--port', this.port.toString(),
        '--threads', '6',
        '--ctx-size', '2048',
        '--n-gpu-layers', '99' // Automatically offload layers to Vulkan/Metal/CUDA GPU
      ];

      this.binaryPath = this.findBinaryPath();
      const binaryDir = path.dirname(this.binaryPath);
      const env: Record<string, string> = { ...process.env as Record<string, string> };
      if (process.platform === 'linux') {
        env.LD_LIBRARY_PATH = [binaryDir, process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':');
      } else if (process.platform === 'darwin') {
        env.DYLD_LIBRARY_PATH = [binaryDir, process.env.DYLD_LIBRARY_PATH || ''].filter(Boolean).join(':');
      } else if (process.platform === 'win32') {
        env.PATH = [binaryDir, process.env.PATH || ''].filter(Boolean).join(';');
      }

      console.log(`Spawning llama-server: ${this.binaryPath} ${args.join(' ')}`);
      console.log(`Using binary directory: ${binaryDir}`);
      
      this.serverProcess = spawn(this.binaryPath, args, {
        cwd: binaryDir,
        env: env
      });

      let startupOutput = '';
      const onData = (data: Buffer) => {
        const text = data.toString();
        startupOutput += text;
        console.log(`[llama-server] ${text.trim()}`);

        if (text.includes('HTTP server listening') || text.includes('listening on')) {
          this.serverProcess?.stdout?.off('data', onData);
          this.serverProcess?.stderr?.off('data', onData);
          mainWindow.webContents.send('sidecar-status', 'running', 'Local AI engine is running offline.');
          resolve();
        }
      };

      this.serverProcess.stdout?.on('data', onData);
      this.serverProcess.stderr?.on('data', onData);

      this.serverProcess.on('error', (err) => {
        console.error('Failed to start llama-server process:', err);
        mainWindow.webContents.send('sidecar-status', 'error', `Failed to start AI server: ${err.message}`);
        this.serverProcess = null;
        reject(err);
      });

      this.serverProcess.on('exit', (code) => {
        console.log(`llama-server process exited with code ${code}`);
        this.serverProcess = null;
        mainWindow.webContents.send('sidecar-status', 'ready', 'Offline AI process stopped.');
      });

      // Timeout safety (20 seconds)
      setTimeout(() => {
        this.serverProcess?.stdout?.off('data', onData);
        this.serverProcess?.stderr?.off('data', onData);
        if (this.serverProcess) {
          mainWindow.webContents.send('sidecar-status', 'running', 'Local AI engine started.');
          resolve();
        } else {
          reject(new Error(`AI server startup timed out. Logs:\n${startupOutput}`));
        }
      }, 20000);
    });
  }

  public stopServer() {
    if (this.serverProcess) {
      console.log('Terminating llama-server background process...');
      this.serverProcess.kill('SIGINT');
      this.serverProcess = null;
    }
  }

  public async queryProofread(originalText: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const systemPrompt = "You are a professional creative writing proofreader. Fix only mechanical errors: typos, misspellings, punctuation mistakes, or awkward run-on sentences.\n\nCRITICAL RULES:\n1. NEVER touch markdown syntax. Every asterisk (*), underscore (_), hashtag (#), backtick (`), tilde (~), or bracket must appear in your output exactly as it appeared in the input.\n2. NEVER remove, add, or relocate any quotation marks of any kind. Fiction dialogue paragraphs often consist entirely of quoted speech with no attribution -- this is intentional and correct, not an error. Preserve every quotation mark exactly.\n3. Preserve the author's voice, style, tone, and colloquialisms exactly as written.\n4. If a sentence is a run-on you may restructure it, but do not omit any of the author's original ideas.\n5. Output ONLY the corrected text. No explanations, no commentary.";

      const postData = JSON.stringify({
        model: 'qwen',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '/no_think\n' + originalText }
        ],
        temperature: 0.1,
        max_tokens: 1024,
        stream: false
      });

      const options = {
        hostname: '127.0.0.1',
        port: this.port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error('AI Server returned status ' + res.statusCode + ': ' + body));
            return;
          }
          try {
            const parsed = JSON.parse(body);
            let corrected = parsed.choices[0]?.message?.content || originalText;
            corrected = corrected.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

            if (corrected.startsWith('"') && corrected.endsWith('"') && corrected.length > 2) {
              corrected = corrected.substring(1, corrected.length - 1);
            } else if (corrected.startsWith("'") && corrected.endsWith("'") && corrected.length > 2) {
              corrected = corrected.substring(1, corrected.length - 1);
            }

            const HALLUCINATION_PHRASES = ['CRITICAL RULES', 'Output ONLY the corrected text',
              'NEVER touch markdown syntax', "Preserve the author's voice"];
            const isHallucinated =
              corrected.length > originalText.length * 4 ||
              HALLUCINATION_PHRASES.some((phrase: string) => corrected.includes(phrase));

            if (isHallucinated) {
              console.warn('[llama-server] Hallucinated response, falling back to original.');
              resolve(originalText);
              return;
            }

            resolve(corrected || originalText);
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }
  // --- Downloader and Zip Extraction Helpers ---

  private downloadWithProgress(fileUrl: string, destPath: string, onProgress: (percent: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsedUrl = url.parse(fileUrl);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const request = protocol.get(fileUrl, (response) => {
        // Handle redirect
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = url.resolve(fileUrl, response.headers.location);
          this.downloadWithProgress(redirectUrl, destPath, onProgress).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        let lastReportedPercent = -1;

        const fileStream = fs.createWriteStream(destPath);
        response.pipe(fileStream);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const percent = Math.round((downloadedBytes / totalBytes) * 100);
            if (percent !== lastReportedPercent) {
              lastReportedPercent = percent;
              onProgress(percent);
            }
          }
        });

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      request.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
  }

  private extractArchive(archivePath: string, ext: string): void {
    console.log(`Extracting archive: ${archivePath}`);
    
    // Utilize native system tools (tar on Linux/Mac, powershell Expand-Archive on Windows)
    if (ext === '.zip') {
      execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${this.localAiDir}' -Force"`);
    } else {
      execSync(`tar -xzf "${archivePath}" -C "${this.localAiDir}"`);
    }

    this.binaryPath = this.findBinaryPath();

    if (!fs.existsSync(this.binaryPath)) {
      throw new Error('llama-server executable was not found in the extracted archive.');
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(this.binaryPath, '755'); // Make executable
    }
  }
}
