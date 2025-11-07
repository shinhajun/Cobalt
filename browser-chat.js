// Chat UI Logic
const messagesContainer = document.getElementById('messagesContainer');
const taskInput = document.getElementById('taskInput');
const btnRun = document.getElementById('btnRun');
const btnStop = document.getElementById('btnStop');
const modelSelect = document.getElementById('modelSelect');
const logsContent = document.getElementById('logsContent');
const btnCopyLogs = document.getElementById('btnCopyLogs');

// Settings Modal
const settingsModal = document.getElementById('settingsModal');
const settingsIconBtn = document.getElementById('settingsIconBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');

// Quick action buttons
const btnHome = document.getElementById('btnHome');
const btnScreenshot = document.getElementById('btnScreenshot');
const btnRefresh = document.getElementById('btnRefresh');
const btnClearHistory = document.getElementById('btnClearHistory');

let isRunning = false;
let messageHistory = [];
let logHistory = [];

// iframe에서 실행되므로 parent window의 electronAPI 사용
const electronAPI = window.parent.electronAPI || window.electronAPI;

// Initialize
function init() {
  // Load saved model
  const savedModel = localStorage.getItem('selectedModel') || 'gpt-5-mini';
  modelSelect.value = savedModel;

  // Event listeners
  btnRun.addEventListener('click', runTask);
  btnStop.addEventListener('click', stopTask);
  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      runTask();
    }
  });

  // Quick actions
  btnHome.addEventListener('click', () => {
    electronAPI.quickAction('navigate', { url: 'https://google.com' });
    addSystemMessage('Navigating to Google...');
  });

  btnScreenshot.addEventListener('click', () => {
    electronAPI.quickAction('screenshot');
    addSystemMessage('Taking screenshot...');
  });

  btnRefresh.addEventListener('click', () => {
    electronAPI.quickAction('refresh');
    addSystemMessage('Refreshing page...');
  });

  btnClearHistory.addEventListener('click', () => {
    if (confirm('Clear chat history?')) {
      clearMessages();
    }
  });

  // Settings Modal
  settingsIconBtn.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  // Close modal when clicking outside
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = 'none';
    }
  });

  btnCopyLogs.addEventListener('click', copyLogs);

  // Model selection
  modelSelect.addEventListener('change', () => {
    localStorage.setItem('selectedModel', modelSelect.value);
  });

  // Example item clicks
  document.querySelectorAll('.example-item').forEach(item => {
    item.addEventListener('click', () => {
      const text = item.textContent.replace('💡 ', '');
      taskInput.value = text;
      taskInput.focus();
    });
  });

  // IPC listeners
  electronAPI.onAgentStarted((data) => {
    addSystemMessage('Task started: ' + data.task);
  });

  electronAPI.onAgentLog((log) => {
    addLog(log);
  });

  electronAPI.onAgentStopped((data) => {
    isRunning = false;
    btnRun.style.display = 'flex';
    btnStop.style.display = 'none';
    taskInput.disabled = false;

    if (data.success) {
      addAssistantMessage('✅ Task completed!\n\n' + data.report);
    } else {
      addErrorMessage('❌ Task failed: ' + data.report);
    }

    removeThinkingIndicator();
  });

  electronAPI.onAgentScreenshot((data) => {
    // Screenshot events are handled by BrowserView now
    // We can optionally show a notification
  });
}

// Run task
async function runTask() {
  const task = taskInput.value.trim();
  if (!task) {
    alert('Please enter a task');
    return;
  }

  if (isRunning) {
    return;
  }

  // Clear welcome message on first task
  const welcome = document.querySelector('.welcome-message');
  if (welcome) {
    welcome.remove();
  }

  // Add user message
  addUserMessage(task);

  // Show thinking indicator
  addThinkingIndicator();

  // UI state
  isRunning = true;
  btnRun.style.display = 'none';
  btnStop.style.display = 'flex';
  taskInput.disabled = true;
  taskInput.value = '';

  // Get settings
  const settings = {
    captchaVisionModel: document.getElementById('visionModelSelect').value,
    syncResultToBrowserView: document.getElementById('syncResultToBrowserView').checked,
    syncCookies: document.getElementById('syncCookies').checked
  };

  // Send to main process
  const model = modelSelect.value;
  try {
    const result = await electronAPI.runTask(task, model, settings);
    if (!result.success) {
      addErrorMessage('Failed to start task: ' + result.error);
      isRunning = false;
      btnRun.style.display = 'flex';
      btnStop.style.display = 'none';
      taskInput.disabled = false;
      removeThinkingIndicator();
    }
  } catch (error) {
    addErrorMessage('Error: ' + error.message);
    isRunning = false;
    btnRun.style.display = 'flex';
    btnStop.style.display = 'none';
    taskInput.disabled = false;
    removeThinkingIndicator();
  }
}

// Stop task
async function stopTask() {
  try {
    await electronAPI.stopTask();
    addSystemMessage('Stopping task...');
  } catch (error) {
    addErrorMessage('Error stopping task: ' + error.message);
  }
}

// Message functions
function addUserMessage(text) {
  const message = {
    role: 'user',
    content: text,
    timestamp: Date.now()
  };
  messageHistory.push(message);
  renderMessage(message);
}

function addAssistantMessage(text) {
  const message = {
    role: 'assistant',
    content: text,
    timestamp: Date.now()
  };
  messageHistory.push(message);
  renderMessage(message);
}

function addSystemMessage(text) {
  const message = {
    role: 'system',
    content: text,
    timestamp: Date.now()
  };
  messageHistory.push(message);
  renderMessage(message);
}

function addErrorMessage(text) {
  const message = {
    role: 'error',
    content: text,
    timestamp: Date.now()
  };
  messageHistory.push(message);
  renderMessage(message);
}

function addThinkingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'message assistant thinking-message';
  indicator.innerHTML = `
    <div class="thinking-indicator">
      <div class="thinking-dots">
        <div class="thinking-dot"></div>
        <div class="thinking-dot"></div>
        <div class="thinking-dot"></div>
      </div>
      <span style="color: #aaa; font-size: 0.9rem;">AI is thinking...</span>
    </div>
  `;
  messagesContainer.appendChild(indicator);
  scrollToBottom();
}

function removeThinkingIndicator() {
  const indicator = document.querySelector('.thinking-message');
  if (indicator) {
    indicator.remove();
  }
}

function renderMessage(message) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${message.role}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = message.content;

  const timeDiv = document.createElement('div');
  timeDiv.className = 'message-time';
  timeDiv.textContent = formatTime(message.timestamp);

  messageDiv.appendChild(contentDiv);
  messageDiv.appendChild(timeDiv);

  messagesContainer.appendChild(messageDiv);
  scrollToBottom();
}

function clearMessages() {
  messageHistory = [];
  messagesContainer.innerHTML = `
    <div class="welcome-message">
      <div class="welcome-icon">👋</div>
      <h2>Welcome to AI Browser Agent</h2>
      <p>I can help you automate web tasks, solve CAPTCHAs, extract data, and more!</p>
      <div class="welcome-examples">
        <div class="example-item">💡 "구글에서 AI 뉴스 검색해줘"</div>
        <div class="example-item">💡 "이 페이지에서 가격 정보 추출해줘"</div>
        <div class="example-item">💡 "3개 사이트 열어서 헤드라인 비교해줘"</div>
      </div>
    </div>
  `;

  // Re-attach example click handlers
  document.querySelectorAll('.example-item').forEach(item => {
    item.addEventListener('click', () => {
      const text = item.textContent.replace('💡 ', '');
      taskInput.value = text;
      taskInput.focus();
    });
  });
}

// Log functions
function addLog(log) {
  logHistory.push(log);

  const logEntry = document.createElement('div');
  logEntry.className = `log-entry ${log.type || 'system'}`;

  // Handle timestamp safely
  let timestamp = 'N/A';
  if (log.timestamp) {
    const date = new Date(log.timestamp);
    if (!isNaN(date.getTime())) {
      timestamp = date.toLocaleTimeString();
    }
  }

  const message = typeof log.data === 'string' ? log.data : log.data.message || JSON.stringify(log.data);

  logEntry.textContent = `[${timestamp}] ${message}`;

  logsContent.appendChild(logEntry);

  // Auto-scroll logs
  logsContent.scrollTop = logsContent.scrollHeight;

  // Limit log entries
  if (logsContent.children.length > 500) {
    logsContent.removeChild(logsContent.firstChild);
  }
}

function copyLogs() {
  const logs = logHistory.map(log => {
    // Handle timestamp safely
    let timestamp = 'N/A';
    if (log.timestamp) {
      const date = new Date(log.timestamp);
      if (!isNaN(date.getTime())) {
        timestamp = date.toLocaleTimeString();
      }
    }

    const message = typeof log.data === 'string' ? log.data : log.data.message || JSON.stringify(log.data);
    return `[${timestamp}] ${message}`;
  }).join('\n');

  navigator.clipboard.writeText(logs).then(() => {
    btnCopyLogs.textContent = '✓ Copied!';
    setTimeout(() => {
      btnCopyLogs.textContent = 'Copy Logs';
    }, 2000);
  });
}

// Utility functions
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Initialize on load
init();
