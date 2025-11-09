# Cobalt Browser

> 🌐 AI-Powered Browser with Intelligent Automation and Macro Recording

Cobalt is an Electron-based browser that combines traditional web browsing with AI-powered automation and macro recording capabilities. Browse normally, or let AI handle complex tasks while you watch in real-time.

---

## ✨ Key Features

### 🌐 **Modern Browser Experience**
- **Native BrowserView**: Full-featured Chromium browser with all standard features
- **Multi-Tab Support**: Create, switch, and manage multiple tabs seamlessly
- **Smart Omnibox**: Address bar with history-based suggestions and search
- **Browsing History**: Track and revisit your browsing history
- **Autofill System**: Save and auto-fill form data across websites
- **Clean UI**: Modern, minimal interface focused on productivity

### 🤖 **AI Assistant Integration**
- **Chat Sidebar**: AI assistant available alongside your browser
- **Real-Time Browser Control**: AI can navigate, click, type, and interact with web pages
- **Screenshot Streaming**: AI sees what you see with live page updates
- **Context Awareness**: AI understands current page content and state
- **Multi-Model Support**: Choose from OpenAI GPT, Google Gemini, or Anthropic Claude models
- **Task Automation**: Delegate complex workflows to AI while maintaining control

### 🎬 **Macro Recording & Playback**
- **Record User Actions**: Capture clicks, typing, navigation, and form inputs
- **Visual Flowchart Editor**: Edit macros with an interactive React Flow diagram
- **Step-by-Step Execution**: Watch macros execute in real-time on the actual browser
- **Macro Library**: Save, organize, and reuse macros from the home page
- **Smart Event Analysis**: Automatically merges and optimizes recorded events
- **Flexible Editing**: Add, remove, or modify individual macro steps

### 🛠️ **Developer Features**
- **DevTools Integration**: Built-in Chrome DevTools for debugging
- **Session Persistence**: Cookies and storage maintained across sessions
- **Custom Home Page**: Quick access to macro library and AI search
- **Overlay System**: Non-intrusive overlays for AI streaming and status updates
- **Event System**: Comprehensive IPC communication between components

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Electron Main Process                       │
│  ┌────────────────────────────────────────────────────┐    │
│  │  electron-main.js                                   │    │
│  │  • BrowserView management (tab system)             │    │
│  │  • IPC handlers (navigation, macros, AI)           │    │
│  │  • Overlay system (omnibox, AI streaming)          │    │
│  │  • History & autofill storage                      │    │
│  │  • Screenshot capture & streaming                  │    │
│  └────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │  AI Agent Core (packages/agent-core)               │    │
│  │  • BrowserController: Playwright automation        │    │
│  │  • LLMService: AI model integration & ReAct loop   │    │
│  │  • MessageManager: Chat history & streaming        │    │
│  │  • Tools: Browser actions, vision, utilities       │    │
│  └────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Macro System (macro/)                              │    │
│  │  • RecordingManager: Event capture                 │    │
│  │  • ActionAnalyzer: Event processing & merging      │    │
│  │  • MacroExecutor: Step-by-step playback            │    │
│  │  • FlowchartGenerator: Visual representation       │    │
│  │  • MacroStorage: Save/load/list macros             │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                          ↕ IPC
┌─────────────────────────────────────────────────────────────┐
│              Electron Renderer (UI)                          │
│  ┌──────────────────────────────────────────────────┐      │
│  │  browser-toolbar.html                             │      │
│  │  • Omnibox with search & suggestions              │      │
│  │  • Tab bar with multi-tab controls                │      │
│  │  • Navigation buttons (back/forward/refresh)      │      │
│  │  • Macro recording controls                       │      │
│  └──────────────────────────────────────────────────┘      │
│                                                               │
│  ┌──────────────────────────────────────────────────┐      │
│  │  browser-chat-ui.html                             │      │
│  │  • AI chat interface (sidebar)                    │      │
│  │  • Message history display                        │      │
│  │  • Model selection dropdown                       │      │
│  │  • Task control (run/stop)                        │      │
│  └──────────────────────────────────────────────────┘      │
│                                                               │
│  ┌──────────────────────────────────────────────────┐      │
│  │  cobalt-home.html                                 │      │
│  │  • Homepage with AI search                        │      │
│  │  • Macro library grid                             │      │
│  │  • Quick macro access                             │      │
│  └──────────────────────────────────────────────────┘      │
│                                                               │
│  ┌──────────────────────────────────────────────────┐      │
│  │  MacroFlowViewer (React)                          │      │
│  │  • Interactive flowchart editor                   │      │
│  │  • Drag-and-drop node editing                     │      │
│  │  • Step deletion & modification                   │      │
│  │  • Save & execute macros                          │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Windows, macOS, or Linux
- At least one API key:
  - OpenAI API key (for GPT models), OR
  - Google API key (for Gemini models), OR
  - Anthropic API key (for Claude models)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd ai-agent
```

2. **Install dependencies**
```bash
npm install
cd packages/agent-core
npm install
cd ../..
```

3. **Configure API keys**

Copy the example environment file and add your API keys:
```bash
cp .env.example .env
```

Then edit `.env` and add at least one API key:
```env
OPENAI_API_KEY=your-openai-key-here
GOOGLE_API_KEY=your-google-key-here
ANTHROPIC_API_KEY=your-anthropic-key-here
```

Get your API keys from:
- OpenAI: https://platform.openai.com/api-keys
- Google: https://aistudio.google.com/app/apikey
- Anthropic: https://console.anthropic.com/

4. **Build the project**
```bash
npm run build
```

5. **Launch Cobalt**
```bash
npm start
```

---

## 🎯 Core Features

### 1. Browser Automation with AI

Open the AI chat sidebar and ask it to perform tasks:

**Examples:**
- "Search Google for 'AI news' and summarize the top 5 results"
- "Navigate to GitHub and find my starred repositories"
- "Fill out this form with my information"
- "Extract all product prices from this page and calculate the average"

The AI can:
- Navigate to URLs
- Click elements
- Fill forms
- Extract data
- Take screenshots
- Manage multiple tabs
- Solve CAPTCHAs
- Bypass Cloudflare challenges

### 2. Macro Recording

**Record a macro:**
1. Click the record button in the toolbar (🔴)
2. Perform actions in the browser (click, type, navigate)
3. Click stop recording (⏹️)
4. Save your macro with a name

**Replay a macro:**
1. Open the home page (new tab)
2. Click a macro card in "My Macros"
3. Review the flowchart
4. Click "Run" to execute

**Edit a macro:**
- Open the flowchart editor
- Delete nodes by selecting and pressing Delete
- Edit step parameters by clicking nodes
- Save changes with the Save button

**Macro features:**
- Automatically records initial URL
- Merges consecutive input events
- Filters duplicate clicks
- Real-time execution (see it happen live)
- Persistent storage in `%APPDATA%/cobalt/macros/`

### 3. Smart Omnibox

Type in the address bar to:
- **Navigate**: Enter a URL or domain (e.g., `google.com`)
- **Search**: Type keywords to search with Google
- **History**: Arrow keys to select from browsing history
- **Suggestions**: Auto-suggests recent visits

**Features:**
- History tracking with timestamps
- Remove individual history entries (× button)
- Tab completion (press Tab to accept suggestion)
- No forced auto-completion (you control what you visit)

### 4. Autofill System

Save time filling forms:
- Automatically detects form fields
- Suggests saved profiles
- Quick-fill with one click
- Mark sites as "never autofill"
- Profile usage tracking

---

## 📁 Project Structure

```
ai-agent/
├── packages/
│   └── agent-core/          # AI automation engine
│       ├── src/
│       │   ├── browserController.ts    # Playwright automation
│       │   ├── llmService.ts          # AI model integration
│       │   ├── messageManager.ts      # Chat history
│       │   ├── actor/                 # AI action handlers
│       │   ├── browser/               # Browser utilities
│       │   ├── dom/                   # DOM manipulation
│       │   ├── tools/                 # AI tools (vision, CAPTCHA, etc.)
│       │   └── utils/                 # Helper functions
│       └── dist/              # Compiled JavaScript
│
├── macro/                   # Macro recording & playback
│   ├── analysis/
│   │   ├── ActionAnalyzer.js          # Event processing
│   │   ├── AIPromptBuilder.js         # AI prompt generation
│   │   └── FlowchartGenerator.js      # Visual flowchart creation
│   ├── execution/
│   │   ├── MacroExecutor.js           # Macro playback engine
│   │   ├── MacroStorage.js            # Save/load macros
│   │   └── AIVariationEngine.js       # AI-powered variations
│   ├── recording/
│   │   ├── RecordingManager.js        # Capture user actions
│   │   ├── EventCollector.js          # Browser event listener
│   │   └── EventSerializer.js         # Event serialization
│   ├── ui/
│   │   ├── flowchart/
│   │   │   ├── MacroFlowViewer.jsx    # React flowchart editor
│   │   │   └── styles.css             # Flowchart styling
│   │   └── dist/bundle.js             # Compiled React bundle
│   ├── types/MacroTypes.js            # Type definitions
│   └── utils/validation.js            # Input validation
│
├── electron-main.js         # Main Electron process
├── browser-toolbar.html     # Top toolbar UI
├── browser-chat-ui.html     # AI chat sidebar
├── cobalt-home.html         # Homepage with macro library
├── omnibox-overlay.html     # Address bar dropdown
├── browser-view-preload.js  # BrowserView preload script
├── electron-preload.js      # Main window preload
├── webpack.config.js        # Webpack config for React
└── package.json             # Project dependencies
```

---

## 🔧 Configuration

### Supported AI Models

#### OpenAI
- `gpt-4o` - Most capable, best for complex tasks
- `gpt-4o-mini` - Faster and cheaper, good for most tasks
- `gpt-4-turbo` - Balanced performance

#### Google Gemini
- `gemini-2.5-pro` - Best quality and reasoning
- `gemini-2.5-flash` - Fast and affordable
- `gemini-2.5-flash-lite` - Ultra-fast for simple tasks

#### Anthropic Claude
- `claude-sonnet-4-5` - Best quality (recommended)
- `claude-haiku-4-5` - Fast and affordable

**Recommended:**
- **General browsing**: `gpt-4o-mini` or `gemini-2.5-flash`
- **Complex automation**: `claude-sonnet-4-5` or `gpt-4o`
- **CAPTCHA solving**: `gpt-4o` or `gemini-2.5-pro`

### Environment Variables

```env
# API Keys (at least one required)
OPENAI_API_KEY=sk-proj-...
GOOGLE_API_KEY=AIzaSy...
ANTHROPIC_API_KEY=sk-ant-...

# Optional Configuration
VISION_MODEL=gpt-4o  # Model for vision tasks (default: gpt-4o)
```

---

## 🚀 Development

### Build Commands

```bash
# Build AI agent core (TypeScript → JavaScript)
npm run build

# Build macro flowchart UI (React → bundle.js)
npm run build:flow

# Build everything
npm run build:all

# Run in development mode
npm run dev

# Create distributable package
npm run dist          # Windows
npm run dist:mac      # macOS
npm run dist:all      # Both platforms
```

### Project Technologies

- **Frontend**: Electron 31, HTML/CSS, JavaScript, React 19
- **Backend**: Node.js 18+, TypeScript 5.x
- **Browser Automation**: Playwright 1.52
- **AI Models**: OpenAI SDK, Google Generative AI, Anthropic SDK
- **UI Libraries**: React Flow (flowchart editor)
- **Build Tools**: Webpack 5, Babel 7, TypeScript Compiler

---

## 📊 Macro System Details

### Recording Process

1. **Event Collection** (`EventCollector.js`)
   - Listens for: navigation, click, input, keydown, submit
   - Captures: selectors, coordinates, values, timestamps
   - Injected into BrowserView via `executeJavaScript()`

2. **Event Analysis** (`ActionAnalyzer.js`)
   - Merges consecutive input events (same field within 500ms)
   - Filters duplicate clicks (within 100ms)
   - Converts events to typed steps (navigation, click, input, keypress)
   - Adds wait steps for significant delays (>2s)

3. **Flowchart Generation** (`FlowchartGenerator.js`)
   - Creates React Flow nodes for each step
   - Auto-layouts with Dagre algorithm (top-to-bottom)
   - Connects steps with edges
   - Adds START and END nodes

### Execution Process

1. **Macro Loading** (`MacroStorage.js`)
   - Reads from `%APPDATA%/cobalt/macros/`
   - Validates macro structure
   - Returns macro data with steps

2. **Step Execution** (`MacroExecutor.js`)
   - Executes steps sequentially on BrowserView
   - Supports: navigate, click, input, keypress, wait
   - Real-time execution (visible in browser)
   - Logs each step to chat sidebar
   - Emits events: `step-complete`, `macro-complete`, `macro-error`

3. **Error Handling**
   - Step timeouts (30s default)
   - Selector not found errors
   - Network failures
   - Auto-cleanup on errors

### Macro Storage Format

```json
{
  "id": "macro_1762667665053",
  "name": "My Macro",
  "description": "",
  "createdAt": 1762667665053,
  "updatedAt": 1762667665053,
  "steps": [
    {
      "stepNumber": 1,
      "type": "navigation",
      "timestamp": 0,
      "url": "https://example.com"
    },
    {
      "stepNumber": 2,
      "type": "click",
      "timestamp": 1234,
      "target": {
        "selector": "button.submit",
        "tagName": "BUTTON",
        "text": "Submit"
      }
    },
    {
      "stepNumber": 3,
      "type": "input",
      "timestamp": 2345,
      "target": {
        "selector": "input[name='email']"
      },
      "data": {
        "value": "user@example.com"
      }
    }
  ],
  "metadata": {
    "totalSteps": 3,
    "duration": 2345,
    "startUrl": "https://example.com",
    "browserVersion": "Cobalt 1.0"
  }
}
```

---

## 🐛 Troubleshooting

### Common Issues

**"API key not configured"**
- Create `.env` file in project root
- Check API key format
- Restart application after adding keys

**"Macro not appearing on home page"**
- Macros are saved to `%APPDATA%/cobalt/macros/` on Windows
- Check file permissions
- Reload the page (Ctrl+R)

**"Macro playback failed"**
- Target element may have changed (selector invalid)
- Page may be loading slowly (add wait steps)
- Check execution logs in chat sidebar

**"Recording not capturing events"**
- Make sure you clicked the record button
- Events only captured on BrowserView pages (not home page)
- Check console for errors

**"Flowchart won't save"**
- Name must be 3-100 characters
- Check file write permissions
- Look for validation errors in console

**"AI not responding"**
- Verify API key is correct
- Check internet connection
- Look for model-specific errors in logs
- Try a different model

---

## 📈 Performance

### Browser Performance
- **Startup time**: ~2-3 seconds
- **Tab switching**: < 100ms
- **Screenshot capture**: ~50ms (1920x1080)
- **Memory usage**: ~200-400MB per tab

### AI Performance
- **Response time**: 2-10 seconds (depends on model and task complexity)
- **Streaming**: Real-time token streaming for long responses
- **Vision processing**: 1-3 seconds for screenshot analysis

### Macro Performance
- **Recording overhead**: Minimal (<5ms per event)
- **Playback speed**: Real-time (same speed as recorded)
- **Storage**: ~5-20KB per macro (JSON)

---

## 🛡️ Privacy & Security

### Data Privacy
- **Local execution**: All data stays on your machine
- **No telemetry**: No usage data sent to external servers
- **Session isolation**: Browsing data stored locally in session folders
- **Secure storage**: Cookies and autofill data encrypted locally

### API Key Security
- **Environment variables**: API keys stored in `.env` file (never committed to git)
- **Example file**: Use `.env.example` as a template
- **Access control**: Only main process has access to API keys
- **No hardcoding**: Keys are never embedded in source code

### Important Security Notes
⚠️ **Before publishing or sharing:**
1. Verify `.env` is in `.gitignore` and not tracked by git
2. Never commit API keys, credentials, or personal data
3. Check `debug/` folder is excluded (contains screenshots)
4. Review macros for sensitive information before sharing

⚠️ **User data locations:**
- Macros: `%APPDATA%/cobalt/macros/` (Windows) or `~/Library/Application Support/cobalt/macros/` (Mac)
- Autofill data: Stored locally in encrypted format
- Browsing history: Local only, not synced
- Session data: Cleared on application exit

### Responsible Usage
This tool is for educational and authorized automation purposes only. Users are responsible for:
- Respecting website terms of service
- Obtaining proper authorization for automation tasks
- Not using the tool for malicious purposes
- Protecting their API keys and credentials

---

## 📄 License

MIT License - see LICENSE file for details.

---

## 🙏 Acknowledgments

- **Electron** - Cross-platform desktop framework
- **Playwright** - Browser automation
- **React Flow** - Flowchart visualization
- **OpenAI, Google, Anthropic** - AI models
- **Dagre** - Graph layout algorithm

---

## 📞 Support

For issues and questions:
- Open an issue on GitHub
- Check the troubleshooting section
- Review the architecture diagram

---

**Made with ❤️ for productive browsing**

⭐ Star this repo if you find it useful!
