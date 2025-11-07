# AI Agent - Autonomous Web Automation

> 🤖 **AI-powered web automation agent that thinks, plans, and executes complex tasks autonomously**

An Electron-based desktop application that combines Playwright browser automation with advanced AI models (GPT-5/Gemini) to perform complex web tasks automatically, including CAPTCHA solving, Cloudflare bypass, and intelligent decision-making.

---

## ✨ Key Features

### 🧠 **Intelligent Automation**
- **ReAct Loop Architecture**: Plans and executes multi-step tasks autonomously
- **Vision-Based Interaction**: Uses AI vision to understand and interact with web pages
- **Smart Tool Usage**: Automatically selects the right tools for each task
- **Persistent Memory**: Stores and recalls information across actions

### 🔓 **Advanced Challenge Solving**
- ✅ **reCAPTCHA v2**: Auto-solves checkbox and grid challenges (3x3, 4x4)
- ✅ **Text CAPTCHA**: OCR-based text extraction
- ✅ **Cloudflare Bypass**: Multi-stage aggressive bypass (100+ seconds)
- ✅ **Custom Challenges**: Vision-guided detection and solving

### 🛠️ **Rich Tool Suite**
- **Browser Actions**: Navigate, click, type, extract text
- **Mathematical Tools**: Calculate expressions, extract numbers
- **Memory System**: Store/retrieve information during execution
- **Date/Time Tools**: Current datetime, date differences
- **Data Extraction**: Extract emails, URLs, numbers from text
- **Formatting Tools**: Format as JSON or Markdown tables

### 🎨 **User Experience**
- **Real-time UI**: Live browser view with screenshot streaming
- **Comprehensive Logs**: Detailed execution logs with timestamps
- **Multi-Model Support**: OpenAI GPT-5 family + Google Gemini
- **Dark Theme**: Clean, modern interface

---

## 📋 Quick Start

### Prerequisites
- Node.js 16+ and npm
- Chrome/Chromium browser installed
- OpenAI API key OR Google API key

### Installation

1. **Clone the repository**
```bash
git clone <your-repo-url>
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

Create a `.env` file in the project root:
```env
OPENAI_API_KEY=sk-proj-...
GOOGLE_API_KEY=AIzaSy...
CAPTCHA_VISION_MODEL=gpt-5  # Optional: defaults to gpt-5
```

4. **Build the project**
```bash
npm run build
```

5. **Launch the application**
```bash
npm start
```

---

## 🎯 Usage

### Basic Task Example

1. **Launch the app** (`npm start`)
2. **Enter a task** in the left panel:
   ```
   구글에서 'AI news'를 검색하고 상위 3개 결과의 제목을 가져와줘
   ```
3. **Select a model** (e.g., gpt-5-mini)
4. **Click "Run Task"**
5. **Watch the agent work** in real-time on the right panel

### Advanced Task Examples

**Memory + Calculation**
```
아마존에서 'laptop' 검색하고, 상위 5개 제품의 가격을
메모리에 저장한 다음, 평균 가격을 계산해줘
```

**Multi-Page Data Collection**
```
네이버 뉴스에서 'AI' 관련 기사 5개를 찾고,
각 기사의 제목, 날짜, URL을 표 형식으로 정리해줘
```

**Date/Time Operations**
```
현재 날짜를 확인하고, 2024년 1월 1일부터
며칠이 지났는지 계산해서 알려줘
```

See [USAGE_EXAMPLES.md](USAGE_EXAMPLES.md) for comprehensive examples.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│  ┌────────────────┐        ┌──────────────────────┐    │
│  │  BrowserController  │ ← → │   LLMService         │    │
│  │  (Playwright)       │     │   (ReAct Loop)       │    │
│  └────────────────┘        └──────────────────────┘    │
│         ↑                           ↑                     │
│         │                           │                     │
│         └───────── AgentTools ──────┘                    │
│              (Memory, Calculate, Extract...)             │
└─────────────────────────────────────────────────────────┘
                         ↕ IPC
┌─────────────────────────────────────────────────────────┐
│              Electron Renderer (UI)                      │
│  ┌──────────────┐     ┌────────────────────────┐       │
│  │  Task Input   │     │  Live Browser View      │       │
│  │  Model Select │     │  Screenshot Stream      │       │
│  │  Run/Stop     │     │  Execution Logs         │       │
│  └──────────────┘     └────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### Core Components

**1. BrowserController** (`packages/agent-core/src/browserController.ts`)
- Playwright wrapper with stealth mode
- CAPTCHA detection and solving
- Cloudflare bypass strategies
- Screenshot streaming

**2. LLMService** (`packages/agent-core/src/llmService.ts`)
- ReAct loop implementation (max 15 iterations)
- Vision model integration
- Tool orchestration
- Prompt engineering

**3. AgentTools** (`packages/agent-core/src/agentTools.ts`)
- Mathematical calculations
- Memory system (store/retrieve)
- Date/time operations
- Text extraction (emails, URLs, numbers)
- Data formatting (JSON, tables)

**4. Electron Main** (`electron-main.js`)
- IPC handler
- Task lifecycle management
- API key configuration

**5. UI** (`ui.html`)
- Split-pane layout
- Real-time screenshot display
- Execution logs with copy function

---

## 🔧 Configuration

### Model Selection

| Model | Use Case | Speed | Cost | Accuracy |
|-------|----------|-------|------|----------|
| **gpt-5-mini** | General tasks | ⚡⚡⚡ | 💰 | ⭐⭐⭐⭐ |
| **gpt-5** | Complex reasoning | ⚡⚡ | 💰💰 | ⭐⭐⭐⭐⭐ |
| **gpt-5-nano** | Speed-critical | ⚡⚡⚡ | 💰 | ⭐⭐⭐ |
| **gemini-2.5-pro** | Vision tasks | ⚡⚡ | 💰💰 | ⭐⭐⭐⭐⭐ |
| **gemini-2.5-flash** | High-speed | ⚡⚡⚡ | 💰 | ⭐⭐⭐⭐ |

### Environment Variables

```env
# Required (at least one)
OPENAI_API_KEY=sk-proj-...
GOOGLE_API_KEY=AIzaSy...

# Optional
CAPTCHA_VISION_MODEL=gpt-5  # Model for vision-based CAPTCHA solving
```

---

## 📚 Available Tools

### Browser Actions
```json
{"type": "BROWSER_ACTION", "command": "navigate", "url": "..."}
{"type": "BROWSER_ACTION", "command": "click", "selector": "..."}
{"type": "BROWSER_ACTION", "command": "type", "selector": "...", "text": "..."}
{"type": "BROWSER_ACTION", "command": "getText", "selector": "..."}
{"type": "BROWSER_ACTION", "command": "getPageContent"}
{"type": "BROWSER_ACTION", "command": "pressKey", "selector": "...", "key": "Enter"}
```

### CAPTCHA Tools
```json
{"type": "TOOL_ACTION", "tool": "solveCaptcha"}
{"type": "TOOL_ACTION", "tool": "visionInteract", "instruction": "..."}
```

### Utility Tools
```json
{"type": "TOOL_ACTION", "tool": "calculate", "expression": "3*5+2"}
{"type": "TOOL_ACTION", "tool": "storeMemory", "key": "...", "value": ...}
{"type": "TOOL_ACTION", "tool": "retrieveMemory", "key": "..."}
{"type": "TOOL_ACTION", "tool": "getCurrentDateTime", "format": "full"}
{"type": "TOOL_ACTION", "tool": "extractNumbers", "text": "..."}
{"type": "TOOL_ACTION", "tool": "formatAsTable", "data": [...]}
```

See [USAGE_EXAMPLES.md](USAGE_EXAMPLES.md) for detailed tool documentation.

---

## 🚀 Performance

### Anti-Detection Features
- ✅ Disables `webdriver` property
- ✅ Custom user-agent (Chrome 131)
- ✅ Realistic browser fingerprint
- ✅ Human-like typing delays (80-150ms)
- ✅ Random mouse movements
- ✅ Storage state persistence (cookies)

### Optimization
- **Page Content Caching**: 2-second TTL to reduce redundant DOM queries
- **Screenshot Streaming**: JPEG with 70% quality for faster transmission
- **Parallel Tool Calls**: Independent actions run concurrently
- **Smart Retries**: Auto-retry failed actions with fallback strategies

### Timeouts
| Operation | Timeout | Notes |
|-----------|---------|-------|
| Navigation (domcontentloaded) | 20s | Fastest, preferred |
| Navigation (load) | 25s | Fallback |
| Cloudflare bypass | 100s+ | Multi-stage (25s + 15s + 15s + 20s + 30s) |
| reCAPTCHA challenge | 3-8s | Per round |
| LLM inference | 15-30s | Depends on model |

---

## 🛡️ Security & Privacy

- **Local Execution**: All automation runs on your machine
- **API Keys**: Stored in `.env` (not committed to git)
- **No Data Logging**: Agent doesn't log sensitive info
- **Session Isolation**: Each task runs in fresh browser context

⚠️ **Disclaimer**: This tool is for educational and authorized testing purposes only. Always respect website terms of service and robots.txt.

---

## 🐛 Troubleshooting

### Common Issues

**"API key not configured"**
- Ensure `.env` file exists in project root
- Check API key format (OpenAI starts with `sk-`, Google starts with `AIza`)

**"Browser launch failed"**
- Install Chrome/Chromium browser
- Check for port conflicts (Playwright uses random ports)

**"Max iterations reached"**
- Task is too complex for 15 iterations
- Break into smaller subtasks
- Increase `MAX_ITERATIONS` in `llmService.ts` (not recommended)

**"Element not found"**
- Page may be loading slowly
- Selector may be incorrect
- Try using vision-based interaction

**Cloudflare won't bypass**
- Some Cloudflare configs are very aggressive
- Try running task again
- Consider manual intervention

---

## 📊 Technical Specifications

**Tech Stack**
- **Frontend**: Electron 31, HTML/CSS/JavaScript
- **Backend**: Node.js, TypeScript
- **Browser Automation**: Playwright 1.52
- **AI/LLM**: LangChain, OpenAI SDK, Google Generative AI SDK

**System Requirements**
- **OS**: Windows 10+, macOS 10.15+, Linux (Ubuntu 20.04+)
- **RAM**: 4GB minimum, 8GB recommended
- **Disk**: 500MB for installation
- **Network**: Stable internet connection

---

## 🗺️ Roadmap

### In Progress
- [ ] Better error recovery strategies
- [ ] Support for more CAPTCHA types

### Planned
- [ ] File download/upload support
- [ ] Multi-tab management
- [ ] Persistent memory across tasks
- [ ] Custom plugin system
- [ ] API endpoint for programmatic access
- [ ] Task templates/presets
- [ ] Scheduled/recurring tasks

### Under Consideration
- [ ] Mobile browser support
- [ ] Proxy/VPN integration
- [ ] Multi-language UI
- [ ] Cloud deployment option

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see LICENSE file for details.

---

## 🙏 Acknowledgments

- **Playwright** for excellent browser automation
- **LangChain** for LLM orchestration
- **OpenAI & Google** for powerful AI models
- **Electron** for cross-platform desktop framework

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/discussions)
- **Email**: your-email@example.com

---

**Made with ❤️ by the AI Agent Team**

⭐ Star this repo if you find it useful!
