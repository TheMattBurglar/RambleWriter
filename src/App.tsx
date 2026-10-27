import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import {
  FileText,
  Plus,
  Trash2,
  Sparkles,
  Eye,
  EyeOff,
  Check,
  X,
  Undo,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  FileEdit,
  Loader2,
  FolderOpen,
  Sun,
  Moon,
  AArrowDown,
  AArrowUp,
} from 'lucide-react';
import { Marked } from 'marked';
import confetti from 'canvas-confetti';
import { checkAutocorrect } from './utils/autocorrect';
import type { AutocorrectUndo } from './utils/autocorrect';
import { getSentenceDiffs, splitParagraphs } from './utils/diff';
import type { ProposedFix } from './utils/diff';

// Declare standard Electron Context Bridge Type
interface FileInfo {
  name: string;
  size: number;
  mtime: number;
}

declare global {
  interface Window {
    api: {
      listFiles: () => Promise<FileInfo[]>;
      readFile: (filename: string) => Promise<string>;
      writeFile: (filename: string, content: string) => Promise<{ success: boolean }>;
      createFile: (filename: string) => Promise<{ success: boolean; name: string }>;
      deleteFile: (filename: string) => Promise<{ success: boolean }>;
      renameFile: (oldFilename: string, newFilename: string) => Promise<{ success: boolean }>;
      getWorkspacePath: () => Promise<string>;
      openFolderDialog: () => Promise<{ success: boolean; path: string }>;
      
      // llama.cpp sidecar APIs
      sidecarGetStatus: () => Promise<string>;
      sidecarBootstrap: () => Promise<{ success: boolean }>;
      sidecarStart: () => Promise<{ success: boolean }>;
      sidecarStop: () => Promise<{ success: boolean }>;
      sidecarScanSentence: (originalText: string) => Promise<{ success: boolean; corrected?: string; error?: string }>;
      onSidecarStatus: (callback: (status: string, details?: string, progress?: number) => void) => () => void;
    };
  }
}

const marked = new Marked();

// Fixes whose entire original/corrected content is punctuation/formatting characters
// should start unchecked — the model is almost certainly wrong to suggest touching them.
// Covers markdown syntax and quotation marks (straight and curly).
const MARKDOWN_SYNTAX_RE = /^[*_~`#>\[\]()\\|"'""'']+$/;
const isMarkdownOnlyFix = (fix: { original: string; corrected: string }) =>
  MARKDOWN_SYNTAX_RE.test(fix.original.trim()) || MARKDOWN_SYNTAX_RE.test(fix.corrected.trim());

// Drop any fix that strips a leading or trailing quotation mark — models consistently
// misread unattributed fiction dialogue as a punctuation error. This is deterministic
// and catches both pure deletions ('"' → '') and mixed tokens ('?"' → '?').
const LEADING_TRAILING_QUOTE_RE = /^["""'''"]|["""'''"]\s*$/;
const isQuoteStrippingFix = (fix: { original: string; corrected: string }) => {
  const orig = fix.original.trim();
  const corr = fix.corrected.trim();
  return LEADING_TRAILING_QUOTE_RE.test(orig) && !LEADING_TRAILING_QUOTE_RE.test(corr);
};

// Drop any fix that adds double quotation marks. The model sees one paragraph at a time,
// so it reads multi-paragraph dialogue (open quote, no close) as a missing closing quote,
// and it also likes converting 'single-quoted' terms to "double". Apostrophes are left
// alone so contraction fixes (it's → its) still come through.
const DOUBLE_QUOTE_RE = /["“”]/g;
const isQuoteAddingFix = (fix: { original: string; corrected: string }) =>
  (fix.corrected.match(DOUBLE_QUOTE_RE)?.length ?? 0) > (fix.original.match(DOUBLE_QUOTE_RE)?.length ?? 0);

export default function App() {
  // Filesystem States
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [activeFile, setActiveFile] = useState<FileInfo | null>(null);
  const [editorContent, setEditorContent] = useState<string>('');
  const [documentTitle, setDocumentTitle] = useState<string>('');
  const [isAutosaving, setIsAutosaving] = useState<boolean>(false);
  const [workspacePath, setWorkspacePath] = useState<string>('');

  // UI Panels Toggles
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<'split' | 'editor' | 'preview'>('split');

  // Keystroke monitor & Autocorrect Undo Stack
  const [undoStack, setUndoStack] = useState<AutocorrectUndo[]>([]);
  const [toast, setToast] = useState<{ message: string; undoItem: AutocorrectUndo } | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  // AI Proofreader States
  const [aiStatus, setAiStatus] = useState<'idle' | 'downloading' | 'ready' | 'starting' | 'running' | 'scanning' | 'error'>('idle');
  const [aiProgress, setAiProgress] = useState<number>(0);
  const [aiProgressDetails, setAiProgressDetails] = useState<string>('');
  const [scanningProgress, setScanningProgress] = useState<{ current: number; total: number; text: string } | null>(null);
  const [proposedFixes, setProposedFixes] = useState<ProposedFix[]>([]);
  const [selectedFixes, setSelectedFixes] = useState<Set<string>>(new Set());
  const [ignoredFixes, setIgnoredFixes] = useState<Set<string>>(new Set());
  const [scannedContent, setScannedContent] = useState<string | null>(null);
  const [isAssetsMissing, setIsAssetsMissing] = useState<boolean>(true);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('rw-theme') as 'dark' | 'light') ?? 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : '';
    localStorage.setItem('rw-theme', theme);
  }, [theme]);

  // Writing text zoom (editor + preview), persisted like theme
  const TEXT_SCALE_MIN = 0.8;
  const TEXT_SCALE_MAX = 2;
  const TEXT_SCALE_STEP = 0.1;
  const [textScale, setTextScale] = useState<number>(() => {
    const stored = parseFloat(localStorage.getItem('rw-text-scale') ?? '');
    return Number.isFinite(stored) ? stored : 1;
  });

  const adjustTextScale = (delta: number) => {
    setTextScale(s => Math.round(Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, s + delta)) * 10) / 10);
  };

  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(textScale));
    localStorage.setItem('rw-text-scale', String(textScale));
  }, [textScale]);

  // Ctrl/Cmd + '=' / '-' / '0' to zoom writing text
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        adjustTextScale(TEXT_SCALE_STEP);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        adjustTextScale(-TEXT_SCALE_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        setTextScale(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autosaveTimeoutRef = useRef<any>(null);

  // Refresh local file explorer
  const refreshFiles = async () => {
    try {
      const list = await window.api.listFiles();
      setFiles(list);
    } catch (err) {
      console.error('Error listing workspace:', err);
    }
  };

  // Open a native folder picker and switch the workspace
  const handleOpenFolder = async () => {
    try {
      const result = await window.api.openFolderDialog();
      if (result.success) {
        setWorkspacePath(result.path);
        setActiveFile(null);
        setEditorContent('');
        setDocumentTitle('');
        setProposedFixes([]);
        setSelectedFixes(new Set());
        const list = await window.api.listFiles();
        setFiles(list);
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  };

  // Load active file contents
  const handleSelectFile = async (file: FileInfo) => {
    // Clear any remaining AI proposed edits from previous file
    setProposedFixes([]);
    setSelectedFixes(new Set());
    setIgnoredFixes(new Set());
    
    try {
      const content = await window.api.readFile(file.name);
      setActiveFile(file);
      setEditorContent(content);
      setDocumentTitle(file.name.replace('.md', ''));
    } catch (err) {
      console.error('Error loading file:', err);
    }
  };

  // Initialize: Load workspace path and file tree
  useEffect(() => {
    async function initWorkspace() {
      try {
        const path = await window.api.getWorkspacePath();
        setWorkspacePath(path);
        await refreshFiles();
      } catch (err) {
        console.error('Failed to init workspace:', err);
      }
    }
    initWorkspace();
  }, []);

  // Autoload the most recent file if available
  useEffect(() => {
    if (files.length > 0 && !activeFile) {
      setTimeout(() => {
        handleSelectFile(files[0]);
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // Debounced Autosave to native disk
  const triggerAutosave = (content: string, filename: string) => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }

    setIsAutosaving(true);

    autosaveTimeoutRef.current = setTimeout(async () => {
      try {
        await window.api.writeFile(filename, content);
        // Refresh file explorer metadata (like size/mtime) silently
        const list = await window.api.listFiles();
        setFiles(list);
        
        // Update mtime of activeFile reference locally
        const updatedFile = list.find(f => f.name === filename);
        if (updatedFile) setActiveFile(updatedFile);
      } catch (err) {
        console.error('Autosave failed:', err);
      } finally {
        setIsAutosaving(false);
      }
    }, 1000); // Trigger 1 second after user stops typing
  };

  // File Creation
  const handleCreateFile = async () => {
    const defaultName = 'Untitled.md';
    try {
      const res = await window.api.createFile(defaultName);
      if (res.success) {
        await refreshFiles();
        // Select the newly created file
        const newFile: FileInfo = {
          name: res.name,
          size: 0,
          mtime: Date.now()
        };
        await handleSelectFile(newFile);
      }
    } catch (err) {
      console.warn('Untitled.md already exists, generating unique name:', err);
      // If Untitled already exists, generate unique name
      let counter = 1;
      let success = false;
      while (!success && counter < 100) {
        try {
          const res = await window.api.createFile(`Untitled-${counter}.md`);
          if (res.success) {
            success = true;
            await refreshFiles();
            const newFile: FileInfo = {
              name: res.name,
              size: 0,
              mtime: Date.now()
            };
            await handleSelectFile(newFile);
          }
        } catch {
          counter++;
        }
      }
    }
  };

  // File Deletion
  const handleDeleteFile = async (file: FileInfo, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent select file trigger
    if (confirm(`Are you sure you want to delete ${file.name}?`)) {
      try {
        await window.api.deleteFile(file.name);
        await refreshFiles();
        if (activeFile?.name === file.name) {
          setActiveFile(null);
          setEditorContent('');
          setDocumentTitle('');
        }
      } catch (err) {
        console.error('Failed to delete file:', err);
      }
    }
  };

  // File Renaming
  const handleRenameDocument = async (newTitle: string) => {
    if (!activeFile || !newTitle.trim()) return;
    const cleanTitle = newTitle.trim().replace(/[/\\?%*:|"<>]/g, '-');
    const newFilename = `${cleanTitle}.md`;

    if (newFilename === activeFile.name) return;

    try {
      await window.api.renameFile(activeFile.name, newFilename);

      const updatedFile: FileInfo = {
        name: newFilename,
        size: editorContent.length,
        mtime: Date.now()
      };

      setActiveFile(updatedFile);
      setDocumentTitle(cleanTitle);
      await refreshFiles();
    } catch (err) {
      console.error('Error renaming file:', err);
      alert('A file with that name already exists or rename failed.');
      setDocumentTitle(activeFile.name.replace('.md', ''));
    }
  };

  // Autocorrect Keystroke Handling
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Detect Backspace to trigger Undo Reversion
    if (e.key === 'Backspace') {
      const cursor = textarea.selectionStart;
      
      if (undoStack.length > 0) {
        const lastUndo = undoStack[undoStack.length - 1];
        
        // Check if cursor is exactly at the position immediately following the corrected word
        if (cursor === lastUndo.cursorPosition) {
          e.preventDefault(); // Stop default single-character delete
          
          // Revert text: slice in the original spelling
          const before = editorContent.substring(0, lastUndo.index);
          const after = editorContent.substring(lastUndo.cursorPosition - 1); // Maintain the space or punctuation typed
          const revertedText = before + lastUndo.original + after;
          
          setEditorContent(revertedText);
          if (activeFile) triggerAutosave(revertedText, activeFile.name);
          
          // Pop the undo stack
          const updatedStack = undoStack.slice(0, -1);
          setUndoStack(updatedStack);

          // Return cursor selection to the end of the reverted original word
          const newCursorPos = lastUndo.index + lastUndo.original.length;
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(newCursorPos, newCursorPos);
          }, 0);

          // Clear active toast immediately, trigger beautiful reversion bubble
          setToast({
            message: `Reverted autocorrect back to "${lastUndo.original}"`,
            undoItem: lastUndo // Kept for toast reference but popped from keyboard stack
          });
          
          if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
          toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
          return;
        }
      }
    }
  };

  // After each keystroke, nudge the scroll so the bottom padding is always visible.
  // Chromium's native textarea scroll-to-cursor stops the moment the cursor is
  // barely visible — it doesn't reveal the padding-bottom below it.
  const nudgeBottomMargin = () => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll > 0 && maxScroll - el.scrollTop < 74) {
        el.scrollTop = maxScroll;
      }
    });
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart;

    // Core state update
    setEditorContent(val);
    if (activeFile) triggerAutosave(val, activeFile.name);
    nudgeBottomMargin();

    // Run deterministic autocorrect engine
    const autocorrectResult = checkAutocorrect(val, cursor);
    
    if (autocorrectResult) {
      setEditorContent(autocorrectResult.textAfterCorrection);
      if (activeFile) triggerAutosave(autocorrectResult.textAfterCorrection, activeFile.name);

      const correctionEndIndex = autocorrectResult.index + autocorrectResult.corrected.length;
      const finalCursorPos = correctionEndIndex + 1; // Word replacement + boundary character

      // Push onto undo stack
      const newUndoItem: AutocorrectUndo = {
        original: autocorrectResult.original,
        corrected: autocorrectResult.corrected,
        index: autocorrectResult.index,
        cursorPosition: finalCursorPos
      };
      
      setUndoStack(prev => [...prev, newUndoItem]);

      // Set cursor position synchronously after DOM render
      setTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(finalCursorPos, finalCursorPos);
        }
      }, 0);

      // Trigger beautiful non-intrusive notification banner
      setToast({
        message: `Autocorrected "${autocorrectResult.original}" to "${autocorrectResult.corrected}"`,
        undoItem: newUndoItem
      });

      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => setToast(null), 4000);
    }
  };

  // Revert toast action click handler
  const handleRevertClick = (undoItem: AutocorrectUndo) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const before = editorContent.substring(0, undoItem.index);
    const after = editorContent.substring(undoItem.cursorPosition - 1);
    const revertedText = before + undoItem.original + after;

    setEditorContent(revertedText);
    if (activeFile) triggerAutosave(revertedText, activeFile.name);

    // Remove from stack if present
    setUndoStack(prev => prev.filter(item => item.index !== undoItem.index));
    setToast(null);

    const newCursor = undoItem.index + undoItem.original.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    }, 0);
  };

  // Synchronize and subscribe to local AI sidecar daemon status
  useEffect(() => {
    async function syncInitialStatus() {
      try {
        const status = await window.api.sidecarGetStatus();
        setIsAssetsMissing(status === 'missing');
        
        if (status === 'running') {
          setAiStatus('ready'); // Ready for scanning
        } else if (status === 'downloading') {
          setAiStatus('downloading');
        } else if (status === 'starting') {
          setAiStatus('starting');
        } else {
          setAiStatus('idle'); // stopped / assets missing
        }
      } catch (err) {
        console.error('Failed to get initial sidecar status:', err);
      }
    }
    syncInitialStatus();

    // Subscribe to IPC status push updates from SidecarManager
    const unsubscribe = window.api.onSidecarStatus((status, details, progress) => {
      console.log(`[Sidecar Status Update] status=${status}, details=${details}, progress=${progress}`);
      setIsAssetsMissing(status === 'missing');

      if (status === 'downloading') {
        setAiStatus('downloading');
        if (progress !== undefined) setAiProgress(progress);
        if (details) setAiProgressDetails(details);
      } else if (status === 'starting') {
        setAiStatus('starting');
        if (details) setAiProgressDetails(details);
      } else if (status === 'running') {
        setAiStatus('ready'); // Ready for scans
        setAiProgress(100);
      } else if (status === 'ready') {
        setAiStatus('idle'); // Stopped but assets ready
      } else if (status === 'error') {
        setAiStatus('error');
        if (details) setAiProgressDetails(details);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Ensure sidecar server is bootstrapped (downloaded) and running
  const ensureSidecarRunning = async (): Promise<boolean> => {
    try {
      const status = await window.api.sidecarGetStatus();
      if (status === 'running') {
        return true;
      }
      
      setAiPanelCollapsed(false);

      if (status === 'missing') {
        setAiStatus('downloading');
        setAiProgress(0);
        setAiProgressDetails('Initializing offline AI asset pipelines...');
        const bootRes = await window.api.sidecarBootstrap();
        if (!bootRes.success) {
          throw new Error('Bootstrap failed.');
        }
      }

      setAiStatus('starting');
      setAiProgressDetails('Starting local CPU/GPU-accelerated engine...');
      const startRes = await window.api.sidecarStart();
      if (startRes.success) {
        setAiStatus('ready');
        return true;
      }
      return false;
    } catch (err: any) {
      setAiStatus('error');
      setAiProgressDetails(err.message || 'Failed to start local AI engine.');
      return false;
    }
  };

  // If the AI stripped matching markdown wrappers (* _ ** __) from a token,
  // put them back so the fix targets the content only, not the syntax.
  // Returns null if the fix is a pure markdown-removal no-op.
  const reapplyMarkdownWrappers = (original: string, corrected: string): string | null => {
    const wrapperRe = /^([*_]{1,2})([\s\S]+?)([*_]{1,2})$/;
    const m = original.match(wrapperRe);
    if (m && m[1] === m[3]) {
      const wrapper = m[1];
      let out = corrected;
      if (!out.startsWith(wrapper)) out = wrapper + out;
      if (!out.endsWith(wrapper)) out = out + wrapper;
      return out === original ? null : out; // null = pure no-op, drop it
    }
    return corrected;
  };

  // Launch local AI proofreading scan sequentially sentence by sentence
  const handleAIScan = async () => {
    if (!editorContent.trim()) {
      alert('Write some text before proofreading!');
      return;
    }

    setAiPanelCollapsed(false);

    // Warm up and start the sidecar process if needed
    const isRunning = await ensureSidecarRunning();
    if (!isRunning) {
      return;
    }

    const contentToScan = editorContent;
    const paragraphs = splitParagraphs(contentToScan);
    setAiStatus('scanning');
    setScanningProgress({ current: 0, total: paragraphs.length, text: 'Segmenting document...' });
    setProposedFixes([]);
    setSelectedFixes(new Set());
    setScannedContent(contentToScan);

    try {
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];

        setScanningProgress({
          current: i + 1,
          total: paragraphs.length,
          text: paragraph.text.length > 60 ? paragraph.text.substring(0, 57) + '...' : paragraph.text
        });

        // Request proofreading from the local AI sidecar endpoint
        const result = await window.api.sidecarScanSentence(paragraph.text);
        if (result.success && result.corrected) {
          const original = paragraph.text;
          const corrected = result.corrected;

          if (original.trim() !== corrected.trim()) {
            const rawDiffs = getSentenceDiffs(original, corrected, paragraph.start, original);

            // Restore markdown wrappers, drop quote-stripping fixes, drop ignored pairs
            const diffs = rawDiffs.flatMap((d, idx) => {
              const fixedCorrected = reapplyMarkdownWrappers(d.original, d.corrected);
              if (fixedCorrected === null) return [];
              if (isQuoteStrippingFix({ original: d.original, corrected: fixedCorrected })) return [];
              if (isQuoteAddingFix({ original: d.original, corrected: fixedCorrected })) return [];
              if (ignoredFixes.has(`${d.original}|||${fixedCorrected}`)) return [];
              return [{ ...d, corrected: fixedCorrected, id: `fix-${i}-${idx}-${Date.now()}` }];
            }) as ProposedFix[];

            if (diffs.length > 0) {
              const mappedFixes = diffs;

              setProposedFixes(prev => {
                const updated = [...prev, ...mappedFixes];
                setSelectedFixes(prevSelected => {
                  const updatedSelected = new Set(prevSelected);
                  // Auto-check only non-formatting fixes; markdown-syntax-only changes start unchecked
                  mappedFixes
                    .filter(f => !isMarkdownOnlyFix(f))
                    .forEach(f => updatedSelected.add(f.id));
                  return updatedSelected;
                });
                return updated;
              });
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Sentence proofreading failed:', err);
      alert(`Proofreading encountered an error: ${err.message || err}`);
    } finally {
      setAiStatus('ready');
      setScanningProgress(null);
    }
  };

  // Checkbox interactions
  const handleToggleFix = (id: string) => {
    setSelectedFixes(prev => {
      const updated = new Set(prev);
      if (updated.has(id)) {
        updated.delete(id);
      } else {
        updated.add(id);
      }
      return updated;
    });
  };

  const handleIgnoreFix = (fix: ProposedFix) => {
    const key = `${fix.original}|||${fix.corrected}`;
    setIgnoredFixes(prev => new Set([...prev, key]));
    setProposedFixes(prev => prev.filter(f => f.id !== fix.id));
    setSelectedFixes(prev => {
      const updated = new Set(prev);
      updated.delete(fix.id);
      return updated;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedFixes(new Set(proposedFixes.map(f => f.id)));
    } else {
      setSelectedFixes(new Set());
    }
  };

  // Apply Selected Fixes (backwards substitution to preserve offsets)
  const handleApplyFixes = () => {
    if (selectedFixes.size === 0) return;

    let updatedText = editorContent;
    const sortedFixes = Array.from(selectedFixes)
      .map(id => proposedFixes.find(f => f.id === id))
      .filter((f): f is ProposedFix => !!f)
      .sort((a, b) => b.index - a.index); // Sort descending

    for (const fix of sortedFixes) {
      let before = updatedText.substring(0, fix.index);
      const after = updatedText.substring(fix.index + fix.length);
      // Pure insertions of joining punctuation (hyphens, dashes) must absorb the
      // preceding space, otherwise "brain dumped" → "brain -dumped" instead of "brain-dumped"
      if (fix.length === 0 && /^[-–—]/.test(fix.corrected) && before.endsWith(' ')) {
        before = before.slice(0, -1);
      }
      updatedText = before + fix.corrected + after;
    }

    setEditorContent(updatedText);
    if (activeFile) {
      window.api.writeFile(activeFile.name, updatedText);
    }

    // Refresh file list metadata size
    refreshFiles();

    // Satisfying confetti!
    confetti({
      particleCount: 120,
      spread: 60,
      origin: { y: 0.65 },
      colors: ['#a78bfa', '#c084fc', '#10b981', '#3b82f6']
    });

    // Clear resolved proposed fixes
    setProposedFixes([]);
    setSelectedFixes(new Set());
    setScannedContent(null);
  };

  // Reading Stats calculations
  const getWordCount = () => editorContent.trim() ? editorContent.trim().split(/\s+/).length : 0;
  const getReadingTime = () => Math.max(1, Math.round(getWordCount() / 200));

  return (
    <div className="app-container">
      {/* Sleek Custom Drag Titlebar Overlay */}
      <div className="app-titlebar">
        <span>RAMBLEWRITER &mdash; {activeFile ? activeFile.name : 'No file open'}</span>
        <button
          className="titlebar-theme-btn"
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>

      <div className="workspace-layout">
        
        {/* Left Explorer Sidebar */}
        <aside className={`sidebar glass ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <div className="sidebar-title">
              <BookOpen className="file-icon" />
              <span>Explorer</span>
            </div>
            <div className="sidebar-header-actions">
              <button
                className="btn-icon"
                onClick={handleOpenFolder}
                title="Open writing folder"
              >
                <FolderOpen size={16} />
              </button>
              <button
                className="btn-icon"
                onClick={handleCreateFile}
                title="New Markdown Document (.md)"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          {workspacePath && (
            <button
              className="workspace-folder-label"
              onClick={handleOpenFolder}
              title={workspacePath}
            >
              <FolderOpen size={11} />
              <span>{workspacePath.split('/').pop() || workspacePath}</span>
            </button>
          )}

          <div className="file-list">
            {files.map(file => (
              <div 
                key={file.name}
                className={`file-item ${activeFile?.name === file.name ? 'active' : ''}`}
                onClick={() => handleSelectFile(file)}
              >
                <div className="file-name-container">
                  <FileText className="file-icon" />
                  <span className="file-name">{file.name.replace('.md', '')}</span>
                </div>
                <button 
                  className="file-delete-btn"
                  onClick={(e) => handleDeleteFile(file, e)}
                  title="Delete file"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {files.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px', color: 'var(--color-text-dark)' }}>
                No markdown documents.
              </div>
            )}
          </div>
        </aside>

        {/* Toggle Sidebar Button */}
        <button 
          className="btn-icon"
          style={{ position: 'absolute', bottom: '20px', left: sidebarCollapsed ? '10px' : '235px', zIndex: 100, transition: 'var(--transition-smooth)' }}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* Central Writing Workspace */}
        <main className="editor-workspace">
          
          {/* Main workspace toolbar */}
          {activeFile ? (
            <div className="workspace-toolbar">
              <div className="toolbar-left">
                <input 
                  type="text" 
                  className="document-title-input" 
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  onBlur={() => handleRenameDocument(documentTitle)}
                  title="Click to rename document"
                />
                
                {/* Autosaving Indicator */}
                <div className={`autosave-badge ${isAutosaving ? 'saving' : ''}`}>
                  {isAutosaving ? 'Saving to disk...' : 'Autosaved'}
                </div>
              </div>

              {/* View options Split, Editor, Preview */}
              <div className="toolbar-right">
                <div className="text-size-controls">
                  <button
                    className="btn-icon"
                    onClick={() => adjustTextScale(-TEXT_SCALE_STEP)}
                    disabled={textScale <= TEXT_SCALE_MIN}
                    title="Smaller text (Ctrl -)"
                  >
                    <AArrowDown size={15} />
                  </button>
                  <button
                    className="text-size-label"
                    onClick={() => setTextScale(1)}
                    title="Reset text size (Ctrl 0)"
                  >
                    {Math.round(textScale * 100)}%
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => adjustTextScale(TEXT_SCALE_STEP)}
                    disabled={textScale >= TEXT_SCALE_MAX}
                    title="Larger text (Ctrl +)"
                  >
                    <AArrowUp size={15} />
                  </button>
                </div>

                <div style={{ width: '1px', height: '18px', background: 'var(--border-light)', margin: '0 8px' }} />

                <button 
                  className={`btn-icon ${viewMode === 'editor' ? 'active' : ''}`}
                  onClick={() => setViewMode('editor')}
                  title="Zen Editor Mode"
                >
                  <FileEdit size={15} />
                </button>
                <button 
                  className={`btn-icon ${viewMode === 'split' ? 'active' : ''}`}
                  onClick={() => setViewMode('split')}
                  title="Split Preview Mode"
                >
                  <Eye size={15} />
                </button>
                <button 
                  className={`btn-icon ${viewMode === 'preview' ? 'active' : ''}`}
                  onClick={() => setViewMode('preview')}
                  title="Full Reader Mode"
                >
                  <BookOpen size={15} />
                </button>

                <div style={{ width: '1px', height: '18px', background: 'var(--border-light)', margin: '0 8px' }} />

                <button 
                  className="btn btn-accent"
                  onClick={handleAIScan}
                  disabled={aiStatus === 'downloading' || aiStatus === 'starting' || aiStatus === 'scanning' || !editorContent.trim()}
                >
                  <Sparkles size={14} />
                  <span>AI Proofread</span>
                </button>
              </div>
            </div>
          ) : null}

          {/* Core editor display */}
          {activeFile ? (
            <div className="split-pane-grid">
              
              {/* Write Editor Pane */}
              {viewMode !== 'preview' && (
                <div className="pane pane-editor">
                  <div className="textarea-wrapper">
                    <textarea
                      ref={textareaRef}
                      className="editor-textarea"
                      placeholder="Dump your stream of consciousness ideas here..."
                      value={editorContent}
                      onKeyDown={handleTextareaKeyDown}
                      onChange={handleTextareaChange}
                      spellCheck={false}
                    />
                  </div>
                </div>
              )}

              {/* Live Render preview HTML pane */}
              {viewMode !== 'editor' && (
                <div className="pane">
                  <div className="preview-container">
                    <div 
                      className="preview-markdown"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(editorContent) as string) }}
                    />
                  </div>
                </div>
              )}

            </div>
          ) : (
            <div className="empty-draft-prompt">
              <div className="empty-draft-title">Welcome to RambleWriter</div>
              <div className="empty-draft-text">
                Open a folder of existing writing, or start a fresh draft. Typos fix as you type, and the local AI panel handles proofreading when you're done.
              </div>
              <button className="btn btn-accent" onClick={handleOpenFolder}>
                <FolderOpen size={16} />
                <span>Open Writing Folder</span>
              </button>
              <div style={{ margin: '10px 0', fontSize: '11px', color: 'var(--color-text-dark)' }}>or</div>
              <button className="btn" onClick={handleCreateFile}>
                <Plus size={16} />
                <span>Create New Draft</span>
              </button>
            </div>
          )}

          {/* Bottom Editor stats and workspace details */}
          {activeFile && (
            <div style={{ height: '32px', padding: '0 20px', display: 'flex', alignItems: 'center', borderTop: '1px solid var(--border-light)', justifyContent: 'space-between', flexShrink: 0 }}>
              <div className="editor-stats">
                <div className="stats-item">
                  <span>Words:</span>
                  <strong>{getWordCount()}</strong>
                </div>
                <div className="stats-item">
                  <span>Characters:</span>
                  <strong>{editorContent.length}</strong>
                </div>
                <div className="stats-item">
                  <span>Read Time:</span>
                  <strong>{getReadingTime()} min</strong>
                </div>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-dark)', fontFamily: 'var(--font-mono)' }}>
                Folder: {workspacePath}
              </div>
            </div>
          )}

          {/* Autocorrect Reversion Toast Alert Bubble */}
          {toast && (
            <div className="autocorrect-toast glass">
              <span style={{ color: 'var(--color-text-main)', fontSize: '12px' }}>
                {toast.message}
              </span>
              <button 
                className="toast-revert-btn"
                onClick={() => handleRevertClick(toast.undoItem)}
              >
                <Undo size={10} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                Revert (Backspace)
              </button>
            </div>
          )}

        </main>

        {/* Right Collapsible AI Proofreading Side Tray */}
        <aside className={`ai-panel glass ${aiPanelCollapsed ? 'collapsed' : ''}`}>
          <div className="ai-header">
            <div className="ai-title">
              <Sparkles className="file-icon" style={{ color: 'var(--color-accent)' }} />
              <span>AI Proofreader</span>
            </div>
            <button 
              className="btn-icon" 
              onClick={() => setAiPanelCollapsed(true)}
              title="Close panel"
            >
              <X size={15} />
            </button>
          </div>

          <div className="ai-body">
            
            {/* 1. Loading / Bootstrapping Sidecar Assets */}
            {(aiStatus === 'downloading' || aiStatus === 'starting') && (
              <div className="ai-loader">
                <Loader2 className="animate-spin" size={24} style={{ color: 'var(--color-accent)', marginBottom: '16px' }} />
                <div className="ai-loader-text">
                  {aiStatus === 'downloading' ? 'Downloading Local AI Assets...' : 'Initializing Local AI Engine...'}
                </div>
                {aiStatus === 'downloading' && (
                  <div className="ai-loader-progress-bar-bg">
                    <div className="ai-loader-progress-bar" style={{ width: `${aiProgress}%` }} />
                  </div>
                )}
                <div className="ai-loader-details">{aiProgressDetails}</div>
                <div style={{ fontSize: '10px', color: 'var(--color-text-dark)', marginTop: '20px', lineHeight: '1.4' }}>
                  {aiStatus === 'downloading' 
                    ? "This setup happens only once. The llama-server Vulkan/Metal engine and Qwen2.5-1.5B model (~1.1GB) will be stored permanently under your user settings folder for 100% private, offline usage."
                    : "Launching the native C++ AI server sidecar with graphics card acceleration (Vulkan/Metal) enabled. Ready in a few seconds."}
                </div>
              </div>
            )}

            {/* 2. Active Proofreading Scan */}
            {aiStatus === 'scanning' && scanningProgress && (
              <div className="ai-loader">
                <div className="sentence-scanner-progress">
                  <div className="scanner-text-indicator">Analyzing Text</div>
                  <div className="sentence-scanner-text">"{scanningProgress.text}"</div>
                </div>
                <div className="ai-loader-text">
                  Correcting paragraph {scanningProgress.current} of {scanningProgress.total}...
                </div>
                <div className="ai-loader-progress-bar-bg">
                  <div className="ai-loader-progress-bar" style={{ width: `${(scanningProgress.current / scanningProgress.total) * 100}%` }} />
                </div>
                <div className="ai-loader-details">Local AI is proofreading offline...</div>
              </div>
            )}

            {/* 3. Scan Unloaded / Idle Prompt */}
            {aiStatus === 'idle' && (
              <div className="ai-scan-landing">
                <div className="ai-icon-pulse-container">
                  <Sparkles size={32} style={{ color: 'var(--color-accent)' }} />
                </div>
                <h3 style={{ fontFamily: 'var(--font-title)', marginBottom: '8px' }}>
                  {isAssetsMissing ? 'Setup Local AI' : 'Local AI Ready'}
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '24px', lineHeight: '1.5' }}>
                  {isAssetsMissing 
                    ? 'To proofread your drafts privately and 100% offline, RambleWriter will download the Qwen3-1.7B model (~1.1GB) and a cross-platform Vulkan-accelerated llama.cpp binary. Zero pre-requisites required.'
                    : 'Analyze your document to fix grammar, punctuation mistakes, spelling, and sentence flow. Runs 100% locally on your CPU/GPU.'}
                </p>
                <button className="ai-scan-btn" onClick={handleAIScan}>
                  <Sparkles size={16} />
                  <span>{isAssetsMissing ? 'Download & Setup' : 'Scan Document'}</span>
                </button>
              </div>
            )}

            {/* 4. Fix Results Dashboard Checklist */}
            {aiStatus === 'ready' && proposedFixes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <div className="ai-checklist-header">
                  <label className="select-all-label">
                    <input
                      type="checkbox"
                      checked={selectedFixes.size === proposedFixes.length}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                    <span>Select All</span>
                  </label>
                  <span className="fixes-count">{proposedFixes.length} issues found</span>
                </div>
                {ignoredFixes.size > 0 && (
                  <div className="suppressed-notice">
                    <EyeOff size={10} />
                    <span>{ignoredFixes.size} suppressed</span>
                    <button onClick={() => setIgnoredFixes(new Set())}>· clear</button>
                  </div>
                )}

                <div className="fixes-list">
                  {proposedFixes.map((fix) => (
                    <div key={fix.id} className="fix-card">
                      <input
                        type="checkbox"
                        className="fix-card-checkbox"
                        checked={selectedFixes.has(fix.id)}
                        onChange={() => handleToggleFix(fix.id)}
                      />
                      <div className="fix-card-content">
                        <div className="fix-card-inline-context">
                          {(() => {
                            const offset = fix.index - fix.contextStart;
                            const before = fix.context.substring(0, offset);
                            const after = fix.context.substring(offset + fix.length);
                            const MAX_CTX = 45;
                            const trimBefore = before.length > MAX_CTX ? '…' + before.slice(-MAX_CTX) : before;
                            const trimAfter = after.length > MAX_CTX ? after.slice(0, MAX_CTX) + '…' : after;
                            return (
                              <>
                                <span className="ctx-text">{trimBefore}</span>
                                {fix.original && <span className="diff-del">{fix.original}</span>}
                                {fix.corrected && <span className="diff-ins">{fix.corrected}</span>}
                                <span className="ctx-text">{trimAfter}</span>
                              </>
                            );
                          })()}
                        </div>
                        <div className="fix-card-badges">
                          <span className={`diff-type ${fix.type}`}>{fix.type}</span>
                          {isMarkdownOnlyFix(fix) && (
                            <span className="diff-type formatting" title="Markdown formatting change — unchecked by default">fmt</span>
                          )}
                        </div>
                      </div>
                      <button
                        className="fix-ignore-btn"
                        onClick={() => handleIgnoreFix(fix)}
                        title="Ignore — don't suggest this again"
                      >
                        <EyeOff size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="footer-actions">
                  {scannedContent !== null && editorContent !== scannedContent && (
                    <div className="stale-scan-warning">
                      Text changed since scan — re-scan before applying.
                    </div>
                  )}
                  <button
                    className="ai-scan-btn"
                    onClick={handleApplyFixes}
                    disabled={selectedFixes.size === 0 || (scannedContent !== null && editorContent !== scannedContent)}
                    title={scannedContent !== null && editorContent !== scannedContent ? 'Text changed since scan — re-scan before applying' : undefined}
                  >
                    <Check size={16} />
                    <span>Apply Selected ({selectedFixes.size})</span>
                  </button>

                  <button
                    className="btn"
                    style={{ justifyContent: 'center' }}
                    onClick={handleAIScan}
                  >
                    <Sparkles size={14} />
                    Re-scan
                  </button>
                </div>
              </div>
            )}

            {/* 5. Scan Complete with No Issues found */}
            {aiStatus === 'ready' && proposedFixes.length === 0 && !scanningProgress && (
              <div className="ai-scan-landing">
                <div className="ai-icon-pulse-container" style={{ borderColor: 'var(--color-success)', background: 'rgba(16, 185, 129, 0.03)' }}>
                  <Check size={32} style={{ color: 'var(--color-success)' }} />
                </div>
                <h3 style={{ fontFamily: 'var(--font-title)', marginBottom: '8px' }}>Text is Clean!</h3>
                <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '24px', lineHeight: '1.5' }}>
                  No grammatical issues, punctuation mistakes, or typos found by the local AI proofreader. Excellent writing!
                </p>
                <button className="btn" onClick={handleAIScan}>
                  <Sparkles size={14} />
                  <span>Scan Again</span>
                </button>
              </div>
            )}

            {/* 6. General Errors */}
            {aiStatus === 'error' && (
              <div className="ai-scan-landing">
                <div className="ai-icon-pulse-container" style={{ borderColor: 'var(--color-danger)', background: 'rgba(244, 63, 94, 0.03)' }}>
                  <X size={32} style={{ color: 'var(--color-danger)' }} />
                </div>
                <h3 style={{ fontFamily: 'var(--font-title)', marginBottom: '8px' }}>AI Setup Failed</h3>
                <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '24px', lineHeight: '1.5' }}>
                  There was an issue initializing or running the local model in the background.
                </p>
                <div className="ai-loader-details" style={{ wordBreak: 'break-all', marginBottom: '20px', color: 'var(--color-danger)' }}>
                  {aiProgressDetails}
                </div>
                <button className="btn" onClick={handleAIScan}>
                  <Undo size={14} />
                  <span>Retry Setup / Start</span>
                </button>
              </div>
            )}

          </div>
        </aside>

        {/* Toggle Right AI Side Panel Trigger */}
        {activeFile && (
          <button 
            className={`btn-icon ${!aiPanelCollapsed ? 'active' : ''}`}
            style={{ position: 'absolute', bottom: '20px', right: aiPanelCollapsed ? '10px' : '325px', zIndex: 100, transition: 'var(--transition-smooth)' }}
            onClick={() => {
              if (aiPanelCollapsed) {
                // Instantly open, warm up sidecar if needed
                setAiPanelCollapsed(false);
                if (aiStatus === 'idle') {
                  ensureSidecarRunning();
                }
              } else {
                setAiPanelCollapsed(true);
              }
            }}
            title={aiPanelCollapsed ? "Expand AI Proofreader" : "Collapse AI Proofreader"}
          >
            <Sparkles size={14} />
          </button>
        )}

      </div>
    </div>
  );
}
