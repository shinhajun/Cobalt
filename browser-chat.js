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

  // IPC listeners (via postMessage from parent window)
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type) {
      switch (event.data.type) {
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

          if (event.data.data.success) {
            addAssistantMessage('✅ Task completed!\n\n' + event.data.data.report);
          } else {
            addErrorMessage('❌ Task failed: ' + event.data.data.report);
          }

          removeThinkingIndicator();
          break;

        case 'agent-screenshot':
          // Screenshot events are handled by BrowserView now
          // We can optionally show a notification
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
    title: '채팅방 1',
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
    title: `채팅방 ${roomId + 1}`,
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
    alert('최소 1개의 채팅방이 필요합니다.');
    return;
  }

  if (!confirm('이 채팅방을 삭제하시겠습니까?')) {
    return;
  }

  chatRooms = chatRooms.filter(r => r.id !== roomId);

  // If deleted room was active, switch to first room
  if (activeChatRoomId === roomId) {
    activeChatRoomId = chatRooms[0].id;
    switchChatRoom(activeChatRoomId);
  }

  saveChatRooms();
  renderChatTabs();
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
  if (!room) return;

  const newName = prompt('채팅방 이름 변경:', room.title);
  if (newName && newName.trim()) {
    room.title = newName.trim();
    saveChatRooms();
    renderChatTabs();
    renderHistory();
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
        <p>저장된 채팅방이 없습니다</p>
      </div>
    `;
    return;
  }

  historyList.innerHTML = '';

  chatRooms.forEach(room => {
    const preview = room.messages.length > 0
      ? room.messages[0].text.substring(0, 50)
      : '대화 내용이 없습니다';

    const date = new Date(room.createdAt).toLocaleDateString('ko-KR');

    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-title">
        ${room.title}
        ${room.id === activeChatRoomId ? '<span style="color: #4285f4;">●</span>' : ''}
      </div>
      <div class="history-preview">${preview}</div>
      <div class="history-date">${date} · ${room.messages.length}개 메시지</div>
      <div class="history-actions">
        <button class="btn-rename" data-room-id="${room.id}">이름변경</button>
        <button class="btn-delete" data-room-id="${room.id}">삭제</button>
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
    item.querySelector('.btn-rename').addEventListener('click', (e) => {
      e.stopPropagation();
      renameChatRoom(room.id);
    });

    // Delete button
    item.querySelector('.btn-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChatRoom(room.id);
    });

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

// Initialize on load
init();
