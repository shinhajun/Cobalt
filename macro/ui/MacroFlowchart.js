// MacroFlowchart.js - Flowchart viewer and editor

const { ipcRenderer } = require('electron');
const path = require('path');

class MacroFlowchartUI {
  constructor(macroData) {
    this.macro = macroData;
    this.currentEditingStep = null;
    this.init();
  }

  init() {
    this.renderMacroInfo();
    this.renderSteps();
    this.attachEventListeners();
  }

  renderSteps() {
    const container = document.getElementById('flowchartSteps');
    container.innerHTML = '';

    if (!this.macro.steps || this.macro.steps.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No steps recorded</p>';
      return;
    }

    this.macro.steps.forEach((step, index) => {
      const stepElement = this.createStepElement(step, index);
      container.appendChild(stepElement);

      // Add arrow between steps
      if (index < this.macro.steps.length - 1) {
        const arrow = document.createElement('div');
        arrow.className = 'step-arrow';
        arrow.innerHTML = '↓';
        container.appendChild(arrow);
      }
    });
  }

  createStepElement(step, index) {
    const div = document.createElement('div');
    div.className = 'flowchart-step';
    div.dataset.stepIndex = index;

    let content = `
      <div class="step-header">
        <span class="step-number">[${step.stepNumber || (index + 1)}]</span>
        <span class="step-type">${this.getStepTypeLabel(step.type)}</span>
        <span class="step-time">⏱ ${(step.timestamp / 1000).toFixed(1)}s</span>
      </div>
    `;

    // Add specific content based on step type
    if (step.type === 'input') {
      content += this.createInputStepContent(step, index);
    } else if (step.type === 'click') {
      content += this.createClickStepContent(step);
    } else if (step.type === 'navigation') {
      content += this.createNavigationStepContent(step);
    } else if (step.type === 'keypress') {
      content += this.createKeypressStepContent(step);
    } else if (step.type === 'wait') {
      content += this.createWaitStepContent(step);
    } else {
      content += `<div class="step-details">${step.description || ''}</div>`;
    }

    div.innerHTML = content;
    return div;
  }

  createInputStepContent(step, index) {
    const currentValue = this.getCurrentInputValue(step);
    const modeLabel = this.getInputModeLabel(step.inputMode || 'static');

    return `
      <div class="step-details">
        <div class="target-info">
          Target: ${step.target?.description || 'Input field'} ${step.target?.selector ? `(${step.target.selector})` : ''}
        </div>

        <div class="input-value-section">
          <div class="input-label">📝 Input Value (${modeLabel}):</div>
          <div class="input-value-display">
            <input type="text"
                   class="value-preview"
                   value="${this.escapeHtml(currentValue)}"
                   readonly>
            <button class="btn-edit-value" data-step-index="${index}">
              ✏️ Edit
            </button>
          </div>

          ${this.createInputOptions(step)}
        </div>
      </div>
    `;
  }

  createClickStepContent(step) {
    return `
      <div class="step-details">
        Target: ${step.target?.description || 'Element'} ${step.target?.selector ? `(${step.target.selector})` : ''}
      </div>
    `;
  }

  createNavigationStepContent(step) {
    return `
      <div class="step-details">
        <strong>${step.url}</strong>
      </div>
    `;
  }

  createKeypressStepContent(step) {
    return `
      <div class="step-details">
        Press key: <strong>${step.key}</strong>
      </div>
    `;
  }

  createWaitStepContent(step) {
    const seconds = (step.timeout / 1000).toFixed(1);
    return `
      <div class="step-details">
        Wait ${seconds}s for ${step.condition}
      </div>
    `;
  }

  createInputOptions(step) {
    let options = '<div class="input-options">';

    if (step.inputMode === 'prompt' && step.promptConfig && step.promptConfig.question) {
      options += `
        <div class="option-badge">
          ❓ Will ask: "${this.escapeHtml(step.promptConfig.question)}"
        </div>
      `;
    } else if (step.inputMode === 'ai' && step.aiConfig && step.aiConfig.prompt) {
      options += `
        <div class="option-badge">
          🤖 AI: "${this.escapeHtml(step.aiConfig.prompt.substring(0, 50))}${step.aiConfig.prompt.length > 50 ? '...' : ''}"
        </div>
      `;
    }

    options += '</div>';
    return options;
  }

  getCurrentInputValue(step) {
    if (step.inputMode === 'static' || !step.inputMode) {
      return step.staticValue || '';
    } else if (step.inputMode === 'prompt') {
      return '[Will ask user]';
    } else if (step.inputMode === 'ai') {
      return '[AI generated]';
    }
    return '';
  }

  getInputModeLabel(mode) {
    const labels = {
      'static': 'Fixed',
      'prompt': 'User Input',
      'ai': 'AI Generated'
    };
    return labels[mode] || 'Fixed';
  }

  getStepTypeLabel(type) {
    const labels = {
      'navigation': 'Navigate to URL',
      'click': 'Click on element',
      'input': 'Type text ✏️',
      'keypress': 'Press key',
      'wait': 'Wait',
      'scroll': 'Scroll'
    };
    return labels[type] || type;
  }

  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  // Event listeners
  attachEventListeners() {
    // Edit value buttons
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-edit-value') || e.target.closest('.btn-edit-value')) {
        const btn = e.target.classList.contains('btn-edit-value') ? e.target : e.target.closest('.btn-edit-value');
        const stepIndex = parseInt(btn.dataset.stepIndex);
        this.openEditModal(stepIndex);
      }
    });

    // Modal controls
    const cancelBtn = document.getElementById('cancelEdit');
    const applyBtn = document.getElementById('applyEdit');
    const closeBtn = document.getElementById('modalClose');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeEditModal());
    }

    if (applyBtn) {
      applyBtn.addEventListener('click', () => this.applyInputChanges());
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeEditModal());
    }

    // Input mode radio buttons
    document.querySelectorAll('input[name="inputMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.updateModalView(e.target.value);
      });
    });

    // Run macro button
    const runBtn = document.getElementById('runMacro');
    if (runBtn) {
      runBtn.addEventListener('click', () => this.runMacro());
    }

    // Save macro button
    const saveBtn = document.getElementById('saveMacro');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveMacro());
    }

    // Delete macro button
    const deleteBtn = document.getElementById('deleteMacro');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this.deleteMacro());
    }

    // Click outside modal to close
    const modal = document.getElementById('editInputModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeEditModal();
        }
      });
    }
  }

  openEditModal(stepIndex) {
    const step = this.macro.steps[stepIndex];
    this.currentEditingStep = stepIndex;

    // Populate modal with current values
    const targetField = document.getElementById('targetField');
    if (targetField) {
      targetField.textContent = `${step.target?.description || 'Input field'} ${step.target?.selector ? `(${step.target.selector})` : ''}`;
    }

    // Set input mode
    const mode = step.inputMode || 'static';
    const modeRadio = document.querySelector(`input[name="inputMode"][value="${mode}"]`);
    if (modeRadio) modeRadio.checked = true;

    // Set values
    const staticValueInput = document.getElementById('staticValue');
    const promptQuestionInput = document.getElementById('promptQuestion');
    const promptDefaultInput = document.getElementById('promptDefault');
    const aiPromptInput = document.getElementById('aiPrompt');

    if (staticValueInput) staticValueInput.value = step.staticValue || '';
    if (promptQuestionInput) promptQuestionInput.value = step.promptConfig?.question || '';
    if (promptDefaultInput) promptDefaultInput.value = step.promptConfig?.defaultValue || '';
    if (aiPromptInput) aiPromptInput.value = step.aiConfig?.prompt || '';

    // Update view
    this.updateModalView(mode);

    // Show modal
    const modal = document.getElementById('editInputModal');
    if (modal) {
      modal.classList.add('show');
    }
  }

  updateModalView(mode) {
    const staticSection = document.getElementById('staticValueSection');
    const promptSection = document.getElementById('promptSection');
    const aiSection = document.getElementById('aiSection');

    if (staticSection) staticSection.style.display = mode === 'static' ? 'block' : 'none';
    if (promptSection) promptSection.style.display = mode === 'prompt' ? 'block' : 'none';
    if (aiSection) aiSection.style.display = mode === 'ai' ? 'block' : 'none';
  }

  applyInputChanges() {
    if (this.currentEditingStep === null) return;

    const step = this.macro.steps[this.currentEditingStep];
    const mode = document.querySelector('input[name="inputMode"]:checked')?.value || 'static';

    step.inputMode = mode;

    if (mode === 'static') {
      const staticValue = document.getElementById('staticValue')?.value || '';
      step.staticValue = staticValue;
    } else if (mode === 'prompt') {
      if (!step.promptConfig) step.promptConfig = {};
      step.promptConfig.enabled = true;
      step.promptConfig.question = document.getElementById('promptQuestion')?.value || '';
      step.promptConfig.defaultValue = document.getElementById('promptDefault')?.value || '';
    } else if (mode === 'ai') {
      if (!step.aiConfig) step.aiConfig = {};
      step.aiConfig.enabled = true;
      step.aiConfig.prompt = document.getElementById('aiPrompt')?.value || '';
      step.aiConfig.model = 'gpt-4o-mini';
    }

    // Re-render steps
    this.renderSteps();
    this.attachEventListeners();
    this.closeEditModal();

    console.log('[MacroFlowchart] Updated step:', step);
  }

  closeEditModal() {
    const modal = document.getElementById('editInputModal');
    if (modal) {
      modal.classList.remove('show');
    }
    this.currentEditingStep = null;
  }

  async runMacro() {
    console.log('[MacroFlowchart] Running macro:', this.macro);

    try {
      const model = localStorage.getItem('selectedModel') || 'gpt-5-mini';
      const result = await ipcRenderer.invoke('execute-macro', {
        macroData: this.macro,
        model
      });

      if (result.success) {
        alert('Macro executed successfully!');
      } else {
        alert('Macro execution failed: ' + result.error);
      }
    } catch (error) {
      console.error('[MacroFlowchart] Failed to run macro:', error);
      alert('Failed to run macro: ' + error.message);
    }
  }

  async saveMacro() {
    console.log('[MacroFlowchart] Saving macro:', this.macro);

    try {
      // Prompt for name if it's "Untitled Macro" or "New Macro"
      if (this.macro.name === 'Untitled Macro' || this.macro.name === 'New Macro') {
        const name = prompt('Enter a name for this macro:', this.macro.name);
        if (name) {
          this.macro.name = name;
          document.getElementById('macroName').textContent = name;
        }
      }

      this.macro.updatedAt = Date.now();

      const result = await ipcRenderer.invoke('save-macro', this.macro);

      if (result.success) {
        alert('Macro saved successfully!');
      } else {
        alert('Failed to save macro: ' + result.error);
      }
    } catch (error) {
      console.error('[MacroFlowchart] Failed to save macro:', error);
      alert('Failed to save macro: ' + error.message);
    }
  }

  async deleteMacro() {
    const confirmed = confirm(`Are you sure you want to delete "${this.macro.name}"?`);
    if (!confirmed) return;

    try {
      // Close window
      window.close();
    } catch (error) {
      console.error('[MacroFlowchart] Failed to delete macro:', error);
    }
  }

  renderMacroInfo() {
    const macroName = document.getElementById('macroName');
    const createdAt = document.getElementById('createdAt');
    const stepCount = document.getElementById('stepCount');
    const duration = document.getElementById('duration');

    if (macroName) macroName.textContent = this.macro.name || 'Untitled Macro';
    if (createdAt) createdAt.textContent = new Date(this.macro.createdAt).toLocaleString();
    if (stepCount) stepCount.textContent = this.macro.steps?.length || 0;

    if (duration) {
      const durationMs = this.macro.metadata?.duration || 0;
      duration.textContent = `${(durationMs / 1000).toFixed(1)}s`;
    }
  }
}

// Initialize when loaded
window.addEventListener('DOMContentLoaded', async () => {
  console.log('[MacroFlowchart] DOM loaded, fetching macro data...');

  try {
    const macroData = await ipcRenderer.invoke('get-current-macro');

    if (macroData) {
      console.log('[MacroFlowchart] Received macro data:', macroData);
      window.macroUI = new MacroFlowchartUI(macroData);
    } else {
      console.error('[MacroFlowchart] No macro data received');
      document.body.innerHTML = '<div style="text-align:center; padding: 40px;">No macro data found</div>';
    }
  } catch (error) {
    console.error('[MacroFlowchart] Failed to load macro:', error);
    document.body.innerHTML = '<div style="text-align:center; padding: 40px;">Failed to load macro: ' + error.message + '</div>';
  }
});
