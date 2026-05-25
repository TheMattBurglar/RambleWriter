# ✍️ RambleWriter

**RambleWriter** is a distraction-free, stream-of-consciousness creative writing markdown editor designed to help you get your thoughts onto the screen without interruption. 

---

## 🌟 The Philosophy: *Write Now, Polish Later*

Traditional word processors interrupt your creative flow with persistent red and blue squiggly lines pointing out every typo, spelling mistake, or grammatical hiccup. These distractions break the fragile state of creative momentum ("flow").

**RambleWriter is built differently:**
1. **Flow State First**: Type what is on your mind completely unhindered. Native spellcheckers and grammar helpers are disabled, allowing you to focus entirely on putting your ideas into Markdown.
2. **AI-Assisted Polish**: Once your raw draft is complete and safely on the screen, invoke RambleWriter's built-in **tiny local AI agent** to scan your text, identify grammar/spelling errors, and offer intuitive side-by-side correction proposals.

---

## 🚀 Key Features

- **🚫 Zero Distractions**: Automatic web browser spelling squigglies are deactivated (`spellCheck={false}`), keeping your workspace pristine and clean while writing.
- **🤖 Built-in Local AI Proofreader**: Features an offline-first AI grammar correction pipeline powered by a `llama-server` sidecar process (llama.cpp) running the Qwen3-1.7B model (Q4_K_M). The binary and model are downloaded on first use and stored in your user data directory. GPU acceleration via Vulkan (Linux/Windows) or Metal (macOS) is used automatically. Your text never leaves your device!
- **⚡ Smart Sentence Diffing**: Side-by-side, sentence-level diff highlights showing exactly what the AI suggests modifying, with quick one-click accept/reject controls.
- **📝 Markdown Live Rendering**: Edit and view your rendered documents simultaneously. Switch seamlessly between `Split View`, `Raw Editor Only`, and `Full Preview` modes.
- **💾 Local Desktop File Management**: Integrated file list sidebar with lightning-fast local filesystem storage, auto-save state, and title renaming.
- **✨ Instant Micro-feedback**: Built-in deterministic autocorrect with desktop toast notifications and an instant `Undo` hook for seamless autocorrect rollbacks.
- **🎉 Celebrate Success**: Experience delightful confetti celebrations when accepting changes or finishing drafts!

---

## 🛠️ Technology Stack

- **Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/)
- **Desktop Wrapper**: [Electron 42](https://www.electronjs.org/) for native OS integration
- **AI Core**: [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`) running as a local sidecar process with Qwen3-1.7B (GGUF Q4_K_M)
- **Markdown Compiler**: [Marked](https://marked.js.org/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Effects**: [Canvas Confetti](https://github.com/catdad/canvas-confetti)

---

## 💻 Getting Started

### Prerequisites

Make sure you have [Node.js](https://nodejs.org/) (v18 or higher recommended) installed.

### Installation

Clone the repository and install the dependencies:

```bash
git clone https://github.com/TheMattBurglar/RambleWriter.git
cd RambleWriter
npm install
```

### Running the App

To start the application in development mode (with hot-reloading for both React and Electron):

```bash
npm run electron:dev
```

### Building & Packaging

To compile the codebase and package the application into a standalone executable (using `electron-builder` configured for your platform):

```bash
# Compile TS config and build Vite bundles
npm run build

# Package desktop application (based on package.json's electron-builder configuration)
npx electron-builder
```

---

## 🔒 Privacy First

Because RambleWriter uses local AI inference (via a llama.cpp sidecar process), **no external APIs are called** during your editing or proofreading process. All spelling, grammar corrections, and drafts remain completely local on your hard drive, keeping your creative work fully private.
