// Chat UI Logic
const messagesContainer = document.getElementById('messagesContainer');
const taskInput = document.getElementById('taskInput');
const btnRun = document.getElementById('btnRun');
const btnStop = document.getElementById('btnStop');
const modelSelect = document.getElementById('modelSelect');
const logsContent = document.getElementById('logsContent');
const btnCopyLogs = document.getElementById('btnCopyLogs');

// Chat Tabs
const chatTabsContainer = document.getElementById('chatTabsContainer');
const newChatBtn = document.getElementById('newChatBtn');
const historyBtn = document.getElementById('historyBtn');

// Modals
const settingsModal = document.getElementById('settingsModal');
const settingsIconBtn = document.getElementById('settingsIconBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const historyModal = document.getElementById('historyModal');
const historyModalClose = document.getElementById('historyModalClose');
const historyList = document.getElementById('historyList');

// Chat Room Management
let chatRooms = [];
let activeChatRoomId = 0;
let nextChatRoomId = 1;
let draggedTab = null;
let draggedTabRoomId = null;

let isRunning = false;
let logHistory = [];

// iframe에서 실행되므로 parent window의 electronAPI 사용
const electronAPI = window.parent.electronAPI || window.electronAPI;

// Initialize
function init() {
  // Load chat rooms from localStorage
  loadChatRooms();

  // Load saved model
  const savedModel = localStorage.getItem('selectedModel') || 'gpt-5-mini';
  modelSelect.value = savedModel;

  // Load saved API keys
  loadApiKeys();

  // Load saved vision model
  const savedVisionModel = localStorage.getItem('selectedVisionModel') || 'gpt-5';
  const visionModelSelect = document.getElementById('visionModelSelect');
  if (visionModelSelect) {
    visionModelSelect.value = savedVisionModel;
  }

  // Event listeners
  btnRun.addEventListener('click', runTask);
  btnStop.addEventListener('click', stopTask);
  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      runTask();
    }
  });

  // Chat tabs
  newChatBtn.addEventListener('click', createNewChatRoom);
  historyBtn.addEventListener('click', openHistoryModal);

  // Settings Modal
  settingsIconBtn.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
    // Reload API keys when opening settings
    loadApiKeys();
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  // History Modal
  historyModalClose.addEventListener('click', () => {
    historyModal.style.display = 'none';
  });

  // Close modals when clicking outside
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = 'none';
    }
  });

  historyModal.addEventListener('click', (e) => {
    if (e.target === historyModal) {
      historyModal.style.display = 'none';
    }
  });

  btnCopyLogs.addEventListener('click', copyLogs);

  // Save API Keys button
  const btnSaveKeys = document.getElementById('btnSaveKeys');
  if (btnSaveKeys) {
    btnSaveKeys.addEventListener('click', saveApiKeys);
  }

  // Model selection
  modelSelect.addEventListener('change', () => {
    localStorage.setItem('selectedModel', modelSelect.value);
  });

  // Vision model selection
  if (visionModelSelect) {
    visionModelSelect.addEventListener('change', () => {
      localStorage.setItem('selectedVisionModel', visionModelSelect.value);
    });
  }

  // IPC listeners (via postMessage from parent window)
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type) {
      console.log('[Chat] Received message:', event.data.type, event.data);
      switch (event.data.type) {
        case 'execute-search':
          console.log('[Chat] Execute search with query:', event.data.query);
          // Create new chat tab and execute the search query
          createNewChatRoom();
          // Wait for the new tab to be active
          setTimeout(() => {
            console.log('[Chat] Setting task input and running task');
            taskInput.value = event.data.query;
            // Trigger run task
            runTask();
          }, 50);
          break;

        case 'agent-started':
          addSystemMessage('Task started: ' + event.data.data.task);
          break;

        case 'agent-log':
          addLog(event.data.data);
          break;

        case 'agent-stopped':
          isRunning = false;
          btnRun.style.display = 'flex';
          btnStop.style.display = 'none';
          taskInput.disabled = false;

          // Remove screenshot display
          removeScreenshotDisplay();

          if (event.data.data.success) {
            addAssistantMessage('✅ Task completed!\n\n' + event.data.data.report);
          } else {
            addErrorMessage('❌ Task failed: ' + event.data.data.report);
          }

          removeThinkingIndicator();
          break;

        case 'agent-screenshot':
          // Display screenshot in chat UI with tabId
          if (event.data.data && event.data.data.screenshot) {
            const tabId = event.data.data.tabId; // AI 작업 중인 탭 ID
            updateScreenshotDisplay(event.data.data.screenshot, tabId);
          }
          break;
      }
    }
  });

  // Note: We only use postMessage events from parent window (browser-toolbar.html)
  // Legacy electronAPI listeners are disabled to prevent duplicate events
  // The toolbar forwards IPC events to this iframe via postMessage
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

  // Show analyzing indicator (lightweight)
  addSystemMessage('Analyzing request...');

  // Temporarily disable input
  taskInput.disabled = true;
  taskInput.value = '';

  // Get settings
  const settings = {
    visionModel: document.getElementById('visionModelSelect').value,
    syncResultToBrowserView: document.getElementById('syncResultToBrowserView').checked,
    syncCookies: document.getElementById('syncCookies').checked
  };

  const model = modelSelect.value;

  // Get current chat room's conversation history
  const currentRoom = chatRooms.find(r => r.id === activeChatRoomId);
  const conversationHistory = currentRoom ? currentRoom.messages : [];

  try {
    // Step 1: Analyze if this is a simple question or a browser task
    const analysisResult = await electronAPI.analyzeTask(task, model, conversationHistory);

    if (analysisResult.taskType === 'chat') {
      // Simple question - just get AI response without browser automation
      addAssistantMessage(analysisResult.response);
      taskInput.disabled = false;
    } else {
      // Browser task - start the automation UI
      isRunning = true;
      btnRun.style.display = 'none';
      btnStop.style.display = 'flex';
      addThinkingIndicator();

      const result = await electronAPI.runTask(task, model, settings, conversationHistory);
      if (!result.success) {
        addErrorMessage('Failed to start task: ' + result.error);
        isRunning = false;
        btnRun.style.display = 'flex';
        btnStop.style.display = 'none';
        taskInput.disabled = false;
        removeThinkingIndicator();
      }
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

// Message functions - see end of file for new implementations

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

function clearMessages() {
  messagesContainer.innerHTML = `
    <div class="welcome-message">
      <div class="welcome-icon">
        <img src="cobalt_logo.png" alt="Cobalt" style="width: 80px; height: 80px;">
      </div>
      <h2>Cobalt AI</h2>
      <p>Ask me to automate web tasks</p>
    </div>
  `;
}

// API Keys Management
function loadApiKeys() {
  const openaiKey = localStorage.getItem('openai_api_key');
  const googleKey = localStorage.getItem('google_api_key');
  const claudeKey = localStorage.getItem('claude_api_key');

  const openaiInput = document.getElementById('openaiApiKey');
  const googleInput = document.getElementById('googleApiKey');
  const claudeInput = document.getElementById('claudeApiKey');

  if (openaiInput && openaiKey) {
    try {
      openaiInput.value = atob(openaiKey);
    } catch (e) {
      console.error('Failed to decode OpenAI key:', e);
    }
  }

  if (googleInput && googleKey) {
    try {
      googleInput.value = atob(googleKey);
    } catch (e) {
      console.error('Failed to decode Google key:', e);
    }
  }

  if (claudeInput && claudeKey) {
    try {
      claudeInput.value = atob(claudeKey);
    } catch (e) {
      console.error('Failed to decode Claude key:', e);
    }
  }
}

async function saveApiKeys() {
  const openaiInput = document.getElementById('openaiApiKey');
  const googleInput = document.getElementById('googleApiKey');
  const claudeInput = document.getElementById('claudeApiKey');
  const btnSaveKeys = document.getElementById('btnSaveKeys');

  const openaiKey = openaiInput ? openaiInput.value.trim() : '';
  const googleKey = googleInput ? googleInput.value.trim() : '';
  const claudeKey = claudeInput ? claudeInput.value.trim() : '';

  if (!openaiKey && !googleKey && !claudeKey) {
    alert('⚠️ Please enter at least one API key (OpenAI, Google, or Claude)');
    return;
  }

  // Save to localStorage (base64 encoded)
  if (openaiKey) {
    localStorage.setItem('openai_api_key', btoa(openaiKey));
  } else {
    localStorage.removeItem('openai_api_key');
  }

  if (googleKey) {
    localStorage.setItem('google_api_key', btoa(googleKey));
  } else {
    localStorage.removeItem('google_api_key');
  }

  if (claudeKey) {
    localStorage.setItem('claude_api_key', btoa(claudeKey));
  } else {
    localStorage.removeItem('claude_api_key');
  }

  // Send to Electron main process
  try {
    if (electronAPI && electronAPI.updateApiKeys) {
      await electronAPI.updateApiKeys({
        openai: openaiKey,
        google: googleKey,
        claude: claudeKey
      });
    }

    // Visual feedback
    btnSaveKeys.textContent = 'Saved!';
    btnSaveKeys.style.background = '#000';
    btnSaveKeys.style.color = '#fff';

    setTimeout(() => {
      btnSaveKeys.textContent = 'Save API Keys';
      btnSaveKeys.style.background = '#000';
      btnSaveKeys.style.color = '#fff';
    }, 2000);

    console.log('[Settings] API keys saved successfully');
  } catch (error) {
    console.error('[Settings] Failed to save API keys:', error);
    alert('❌ Failed to save API keys. Please try again.');
  }
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

// ============================================
// Chat Room Management Functions
// ============================================

function loadChatRooms() {
  const saved = localStorage.getItem('chatRooms');
  if (saved) {
    try {
      chatRooms = JSON.parse(saved);
      if (chatRooms.length > 0) {
        nextChatRoomId = Math.max(...chatRooms.map(r => r.id)) + 1;
        activeChatRoomId = chatRooms[0].id;
      } else {
        // Create default room
        createDefaultChatRoom();
      }
    } catch (e) {
      console.error('Failed to load chat rooms:', e);
      createDefaultChatRoom();
    }
  } else {
    createDefaultChatRoom();
  }

  // Render tabs and load active room
  renderChatTabs();
  switchChatRoom(activeChatRoomId);
}

function createDefaultChatRoom() {
  chatRooms = [{
    id: 0,
    title: 'Chat 1',
    messages: [],
    createdAt: Date.now()
  }];
  activeChatRoomId = 0;
  nextChatRoomId = 1;
}

function saveChatRooms() {
  try {
    localStorage.setItem('chatRooms', JSON.stringify(chatRooms));
  } catch (e) {
    console.error('Failed to save chat rooms:', e);
  }
}

function createNewChatRoom() {
  const roomId = nextChatRoomId++;
  const newRoom = {
    id: roomId,
    title: `Chat ${roomId + 1}`,
    messages: [],
    createdAt: Date.now()
  };

  chatRooms.push(newRoom);
  saveChatRooms();
  renderChatTabs();
  switchChatRoom(roomId);
}

function deleteChatRoom(roomId) {
  if (chatRooms.length <= 1) {
    alert('At least one chat room is required.');
    return;
  }

  const room = chatRooms.find(r => r.id === roomId);
  if (!room) {
    console.error('Room not found:', roomId);
    return;
  }

  if (!confirm(`Delete "${room.title}"?`)) {
    return;
  }

  console.log('Deleting chat room:', roomId);

  chatRooms = chatRooms.filter(r => r.id !== roomId);

  // If deleted room was active, switch to first room
  if (activeChatRoomId === roomId) {
    activeChatRoomId = chatRooms[0].id;
    switchChatRoom(activeChatRoomId);
  }

  saveChatRooms();
  renderChatTabs();
  renderHistory(); // Update history modal if open
}

function switchChatRoom(roomId) {
  // Save current room's messages
  saveCurrentRoomMessages();

  // Switch to new room
  activeChatRoomId = roomId;
  const room = chatRooms.find(r => r.id === roomId);

  if (!room) {
    console.error('Room not found:', roomId);
    return;
  }

  // Clear and load messages
  clearMessages();
  room.messages.forEach(msg => {
    if (msg.type === 'user') addUserMessage(msg.text, false);
    else if (msg.type === 'assistant') addAssistantMessage(msg.text, false);
    else if (msg.type === 'system') addSystemMessage(msg.text, false);
    else if (msg.type === 'error') addErrorMessage(msg.text, false);
  });

  // Update tab active state
  updateTabActiveState(roomId);
}

function saveCurrentRoomMessages() {
  const room = chatRooms.find(r => r.id === activeChatRoomId);
  if (room) {
    room.messages = getCurrentMessages();
    saveChatRooms();
  }
}

function getCurrentMessages() {
  const messages = [];
  const messageElements = messagesContainer.querySelectorAll('.message');

  messageElements.forEach(el => {
    if (el.classList.contains('welcome-message')) return;

    let type = 'user';
    if (el.classList.contains('assistant')) type = 'assistant';
    else if (el.classList.contains('system')) type = 'system';
    else if (el.classList.contains('error')) type = 'error';

    messages.push({
      type,
      text: el.textContent.trim(),
      timestamp: Date.now()
    });
  });

  return messages;
}

function renderChatTabs() {
  chatTabsContainer.innerHTML = '';

  chatRooms.forEach(room => {
    const tabEl = document.createElement('div');
    tabEl.className = 'chat-tab';
    tabEl.setAttribute('data-room-id', room.id);
    tabEl.setAttribute('draggable', 'true');

    if (room.id === activeChatRoomId) {
      tabEl.classList.add('active');
    }

    tabEl.innerHTML = `
      <span class="tab-title">${room.title}</span>
      <span class="tab-close">×</span>
    `;

    // Tab click - switch room
    tabEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        e.stopPropagation();
        deleteChatRoom(room.id);
      } else {
        switchChatRoom(room.id);
      }
    });

    // Setup drag events
    setupTabDragEvents(tabEl, room.id);

    chatTabsContainer.appendChild(tabEl);
  });
}

function setupTabDragEvents(tabEl, roomId) {
  tabEl.addEventListener('dragstart', (e) => {
    draggedTab = tabEl;
    draggedTabRoomId = roomId;
    tabEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  tabEl.addEventListener('dragend', () => {
    tabEl.classList.remove('dragging');
    document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('drag-over'));
  });

  tabEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedTab && draggedTab !== tabEl) {
      tabEl.classList.add('drag-over');
    }
  });

  tabEl.addEventListener('dragleave', () => {
    tabEl.classList.remove('drag-over');
  });

  tabEl.addEventListener('drop', (e) => {
    e.preventDefault();
    tabEl.classList.remove('drag-over');

    if (draggedTab && draggedTab !== tabEl) {
      const draggedIndex = chatRooms.findIndex(r => r.id === draggedTabRoomId);
      const targetIndex = chatRooms.findIndex(r => r.id === roomId);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [movedRoom] = chatRooms.splice(draggedIndex, 1);
        chatRooms.splice(targetIndex, 0, movedRoom);
        saveChatRooms();
        renderChatTabs();
      }
    }
  });
}

function updateTabActiveState(roomId) {
  document.querySelectorAll('.chat-tab').forEach(tab => {
    if (parseInt(tab.getAttribute('data-room-id')) === roomId) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
}

function renameChatRoom(roomId) {
  const room = chatRooms.find(r => r.id === roomId);
  if (!room) {
    console.error('Room not found:', roomId);
    return;
  }

  const newName = prompt('Enter new chat room name:', room.title);
  if (newName && newName.trim()) {
    console.log('Renaming chat room:', roomId, 'to', newName.trim());
    room.title = newName.trim();
    saveChatRooms();
    renderChatTabs();
    renderHistory(); // Update history modal if open
  }
}

function openHistoryModal() {
  renderHistory();
  historyModal.style.display = 'flex';
}

function renderHistory() {
  if (chatRooms.length === 0) {
    historyList.innerHTML = `
      <div class="history-empty">
        <div class="history-empty-icon">📭</div>
        <p>No saved chat rooms</p>
      </div>
    `;
    return;
  }

  historyList.innerHTML = '';

  chatRooms.forEach(room => {
    const preview = room.messages.length > 0
      ? room.messages[0].text.substring(0, 50)
      : 'No conversation history';

    const date = new Date(room.createdAt).toLocaleDateString('en-US');

    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-title">
        ${room.title}
        ${room.id === activeChatRoomId ? '<span style="color: #4285f4;">●</span>' : ''}
      </div>
      <div class="history-preview">${preview}</div>
      <div class="history-date">${date} · ${room.messages.length} messages</div>
      <div class="history-actions">
        <button class="btn-rename" data-room-id="${room.id}">Rename</button>
        <button class="btn-delete" data-room-id="${room.id}">Delete</button>
      </div>
    `;

    // Click item to switch room
    item.addEventListener('click', (e) => {
      if (!e.target.classList.contains('btn-rename') && !e.target.classList.contains('btn-delete')) {
        switchChatRoom(room.id);
        historyModal.style.display = 'none';
      }
    });

    // Rename button
    const renameBtn = item.querySelector('.btn-rename');
    if (renameBtn) {
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renameChatRoom(room.id);
      });
    }

    // Delete button
    const deleteBtn = item.querySelector('.btn-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteChatRoom(room.id);
      });
    }

    historyList.appendChild(item);
  });
}

// ============================================
// Message Functions (Modified)
// ============================================

function addUserMessage(text, save = true) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message user';
  messageDiv.textContent = text;
  messagesContainer.appendChild(messageDiv);
  scrollToBottom();

  if (save) {
    saveCurrentRoomMessages();
  }
}

function addAssistantMessage(text, save = true) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  messageDiv.textContent = text;
  messagesContainer.appendChild(messageDiv);
  scrollToBottom();

  if (save) {
    saveCurrentRoomMessages();
  }
}

function addSystemMessage(text, save = true) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message system';
  messageDiv.textContent = text;
  messagesContainer.appendChild(messageDiv);
  scrollToBottom();

  if (save) {
    saveCurrentRoomMessages();
  }
}

function addErrorMessage(text, save = true) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message error';
  messageDiv.textContent = text;
  messagesContainer.appendChild(messageDiv);
  scrollToBottom();

  if (save) {
    saveCurrentRoomMessages();
  }
}

// Screenshot display management - inline chat message style
let lastScreenshotMessageDiv = null;
let lastScreenshotTabId = null;

function updateScreenshotDisplay(screenshotDataURL, tabId) {
  // Get active chat room
  const activeRoom = chatRooms.find(r => r.id === activeChatRoomId);
  if (!activeRoom) return;

  // Store tabId for click handler
  lastScreenshotTabId = tabId;

  // Create or update screenshot message in chat
  if (!lastScreenshotMessageDiv || !messagesContainer.contains(lastScreenshotMessageDiv)) {
    // Create new screenshot message
    lastScreenshotMessageDiv = document.createElement('div');
    lastScreenshotMessageDiv.className = 'message screenshot';
    lastScreenshotMessageDiv.style.cssText = `
      padding: 12px;
      margin-bottom: 12px;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      border-left: 4px solid #667eea;
      border-radius: 8px;
      max-width: 100%;
      cursor: pointer;
      transition: background 0.2s;
    `;

    // Click handler: Switch to AI working tab
    lastScreenshotMessageDiv.addEventListener('click', () => {
      if (lastScreenshotTabId !== undefined && lastScreenshotTabId !== null) {
        console.log('[Chat] Switching to AI tab:', lastScreenshotTabId);
        if (electronAPI && electronAPI.switchToTab) {
          electronAPI.switchToTab(lastScreenshotTabId).then(result => {
            if (result.success) {
              console.log('[Chat] Successfully switched to tab:', lastScreenshotTabId);
            } else {
              console.error('[Chat] Failed to switch tab:', result.error);
            }
          });
        }
      }
    });

    // Hover effects
    lastScreenshotMessageDiv.addEventListener('mouseenter', () => {
      lastScreenshotMessageDiv.style.background = 'linear-gradient(135deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.15) 100%)';
    });
    lastScreenshotMessageDiv.addEventListener('mouseleave', () => {
      lastScreenshotMessageDiv.style.background = 'linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)';
    });

    lastScreenshotMessageDiv.innerHTML = `
      <div style="color: #667eea; font-weight: 600; font-size: 12px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
        <span>🤖</span>
        <span>AI Browser View</span>
        <span class="screenshot-status" style="color: #999; font-weight: 400; font-size: 11px; margin-left: auto;">
          실시간 업데이트 중... ${tabId !== undefined && tabId !== null ? `(탭 ${tabId})` : ''}
        </span>
      </div>
      <div style="border-radius: 6px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); position: relative;">
        <img src="" style="width: 100%; display: block;" />
        <div style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.7); color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; pointer-events: none;">
          클릭하여 탭으로 이동 →
        </div>
      </div>
    `;

    messagesContainer.appendChild(lastScreenshotMessageDiv);
    scrollToBottom();
  }

  // Update image
  const img = lastScreenshotMessageDiv.querySelector('img');
  if (img) {
    img.src = screenshotDataURL;
  }
}

function removeScreenshotDisplay() {
  if (lastScreenshotMessageDiv && messagesContainer.contains(lastScreenshotMessageDiv)) {
    // Mark as completed instead of removing
    const statusSpan = lastScreenshotMessageDiv.querySelector('.screenshot-status');
    if (statusSpan) {
      statusSpan.textContent = '✓ 완료';
      statusSpan.style.color = '#28ca42';
    }
    lastScreenshotMessageDiv = null;
  }
}

// Initialize on load
init();
