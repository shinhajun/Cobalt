// MacroFlowViewer.jsx - Main React Flow component for macro visualization

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';

import NavigationNode from './nodes/NavigationNode';
import ClickNode from './nodes/ClickNode';
import InputNode from './nodes/InputNode';
import WaitNode from './nodes/WaitNode';
import KeypressNode from './nodes/KeypressNode';
import StartNode from './nodes/StartNode';
import EndNode from './nodes/EndNode';

import { getLayoutedElements, getOptimalDirection } from './layout/AutoLayout';

// Import validation utilities from window global (loaded via script tag)
const { validateMacroName } = window.MacroValidation || {};

const { ipcRenderer } = window.require('electron');

// Define custom node types
const nodeTypes = {
  navigation: NavigationNode,
  click: ClickNode,
  input: InputNode,
  wait: WaitNode,
  keypress: KeypressNode,
  start: StartNode,
  end: EndNode
};

const MacroFlowViewer = ({ macroData }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [macro, setMacro] = useState(macroData);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingNode, setEditingNode] = useState(null);

  // Save modal states
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [macroName, setMacroName] = useState('');
  const [nameError, setNameError] = useState('');

  // Edit modal states
  const [editInputMode, setEditInputMode] = useState('static');
  const [editStaticValue, setEditStaticValue] = useState('');
  const [editPromptQuestion, setEditPromptQuestion] = useState('');
  const [editPromptDefault, setEditPromptDefault] = useState('');
  const [editPromptPlaceholder, setEditPromptPlaceholder] = useState('');
  const [editAiPrompt, setEditAiPrompt] = useState('');
  const [editAiModel, setEditAiModel] = useState('gpt-4o-mini');
  const [editAiTemperature, setEditAiTemperature] = useState(0.7);

  // Convert macro steps to React Flow nodes and edges
  const initializeFlow = useCallback(() => {
    if (!macro || !macro.steps || macro.steps.length === 0) {
      console.warn('[MacroFlowViewer] No steps to display');
      return;
    }

    console.log('[MacroFlowViewer] Initializing flow with', macro.steps.length, 'steps');

    // Create START node
    const startNode = {
      id: 'start',
      type: 'start',
      data: {
        macroName: macro.name
      },
      position: { x: 0, y: 0 }
    };

    // Create nodes from macro steps
    const flowNodes = macro.steps.map((step, index) => ({
      id: `step-${step.stepNumber}`,
      type: step.type,
      data: {
        ...step,
        label: step.description
      },
      position: { x: 0, y: 0 } // Will be set by layout engine
    }));

    // Create END node
    const endNode = {
      id: 'end',
      type: 'end',
      data: {
        totalSteps: macro.steps.length
      },
      position: { x: 0, y: 0 }
    };

    // Combine all nodes
    const allNodes = [startNode, ...flowNodes, endNode];

    // Create edges
    const flowEdges = [];

    // Edge from START to first step
    if (macro.steps.length > 0) {
      flowEdges.push({
        id: 'edge-start',
        source: 'start',
        target: `step-${macro.steps[0].stepNumber}`,
        type: 'smoothstep',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20
        },
        style: { stroke: '#10b981', strokeWidth: 2 }
      });
    }

    // Edges between consecutive steps
    for (let i = 0; i < macro.steps.length - 1; i++) {
      flowEdges.push({
        id: `edge-${i}`,
        source: `step-${macro.steps[i].stepNumber}`,
        target: `step-${macro.steps[i + 1].stepNumber}`,
        type: 'smoothstep',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20
        },
        style: { stroke: '#667eea', strokeWidth: 2 }
      });
    }

    // Edge from last step to END
    if (macro.steps.length > 0) {
      flowEdges.push({
        id: 'edge-end',
        source: `step-${macro.steps[macro.steps.length - 1].stepNumber}`,
        target: 'end',
        type: 'smoothstep',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20
        },
        style: { stroke: '#ef4444', strokeWidth: 2 }
      });
    }

    // Apply auto-layout
    const direction = getOptimalDirection(allNodes.length);
    const layoutedNodes = getLayoutedElements(allNodes, flowEdges, direction);

    setNodes(layoutedNodes);
    setEdges(flowEdges);
  }, [macro, setNodes, setEdges]);

  // Initialize flow on mount and when macro changes
  useEffect(() => {
    initializeFlow();
  }, [initializeFlow]);

  // Handle node edit
  const handleEditNode = useCallback((nodeData) => {
    console.log('[MacroFlowViewer] Editing node:', nodeData);
    setEditingNode(nodeData);

    // Initialize edit form with node data
    const mode = nodeData.inputMode || nodeData.mode || 'static';
    setEditInputMode(mode);
    setEditStaticValue(nodeData.staticValue || nodeData.value || '');

    // Prompt config
    const promptCfg = nodeData.promptConfig || {};
    setEditPromptQuestion(promptCfg.question || '');
    setEditPromptDefault(promptCfg.defaultValue || nodeData.staticValue || '');
    setEditPromptPlaceholder(promptCfg.placeholder || '');

    // AI config
    const aiCfg = nodeData.aiConfig || {};
    setEditAiPrompt(aiCfg.prompt || '');
    setEditAiModel(aiCfg.model || 'gpt-4o-mini');
    setEditAiTemperature(aiCfg.temperature || 0.7);

    setShowEditModal(true);
  }, []);

  // Expose edit handler to nodes
  useEffect(() => {
    window.onEditInputNode = handleEditNode;
    return () => {
      window.onEditInputNode = null;
    };
  }, [handleEditNode]);

  // Handle edge connection
  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  // Handle node deletion
  const onNodesDelete = useCallback((deleted) => {
    console.log('[MacroFlowViewer] Deleting nodes:', deleted);

    // Prevent deletion of start and end nodes
    const hasProtectedNodes = deleted.some(node => node.id === 'start' || node.id === 'end');
    if (hasProtectedNodes) {
      alert('❌ Cannot delete START or END nodes');
      return;
    }

    // Update macro steps by removing deleted nodes
    const deletedStepIds = deleted.map(node => {
      const match = node.id.match(/step-(\d+)/);
      return match ? parseInt(match[1]) : null;
    }).filter(id => id !== null);

    const updatedSteps = macro.steps.filter(step => !deletedStepIds.includes(step.stepNumber));

    // Renumber steps
    updatedSteps.forEach((step, index) => {
      step.stepNumber = index + 1;
    });

    setMacro({ ...macro, steps: updatedSteps });
  }, [macro, setMacro]);

  // Handle edge deletion
  const onEdgesDelete = useCallback((deleted) => {
    console.log('[MacroFlowViewer] Deleting edges:', deleted);
    // Edges are managed automatically by React Flow
  }, []);

  // Run macro
  const handleRun = async () => {
    console.log('[MacroFlowViewer] Running macro:', macro.name);
    try {
      const model = localStorage.getItem('selectedModel') || 'gpt-5-mini';
      const result = await ipcRenderer.invoke('execute-macro', {
        macroData: macro,
        model
      });
      if (result.success) {
        alert('✅ Macro executed successfully!');
      } else {
        alert('❌ Macro execution failed: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('[MacroFlowViewer] Failed to run macro:', error);
      alert('❌ Failed to run macro: ' + error.message);
    }
  };

  // Optimize macro with AI
  const handleOptimize = async () => {
    console.log('[MacroFlowViewer] Optimizing macro');
    setIsOptimizing(true);

    try {
      // Get selected model from localStorage (same as chat UI)
      const model = localStorage.getItem('selectedModel') || 'gpt-5-mini';
      console.log('[MacroFlowViewer] Using model:', model);

      // Call AI optimizer with model
      const result = await ipcRenderer.invoke('optimize-macro', { macroData: macro, model });

      if (result.success) {
        setMacro(result.optimizedMacro);
        alert(`✅ Optimization complete!\n\nRemoved ${result.removedSteps.length} steps\n${result.aiSuggestions.length} AI suggestions available`);
      } else {
        alert('❌ Optimization failed: ' + result.error);
      }
    } catch (error) {
      console.error('[MacroFlowViewer] Optimization failed:', error);
      alert('❌ Optimization failed: ' + error.message);
    } finally {
      setIsOptimizing(false);
    }
  };

  // Handle name input change
  // Note: validateMacroName is imported from shared validation utilities
  const handleNameChange = (e) => {
    const newName = e.target.value;
    setMacroName(newName);

    // Real-time validation - only show error if user has typed something
    if (newName.trim().length > 0) {
      const error = validateMacroName(newName);
      setNameError(error || '');
    } else {
      setNameError('');
    }
  };

  // Confirm save with validated name
  const confirmSave = async () => {
    const error = validateMacroName(macroName);
    if (error) {
      setNameError(error);
      return;
    }

    // Update macro name and save
    const updatedMacro = {
      ...macro,
      name: macroName.trim(),
      updatedAt: Date.now()
    };

    try {
      const result = await ipcRenderer.invoke('save-macro', updatedMacro);

      if (result.success) {
        setMacro(updatedMacro);
        setShowSaveModal(false);
        alert('✅ Macro saved successfully!');
      } else {
        alert('❌ Failed to save macro: ' + result.error);
      }
    } catch (error) {
      console.error('[MacroFlowViewer] Save failed:', error);
      alert('❌ Failed to save macro: ' + error.message);
    }
  };

  // Confirm edit input step
  const confirmEditInput = () => {
    if (!editingNode) return;

    console.log('[MacroFlowViewer] Saving edited input step:', editingNode.stepNumber);

    // Find the step in macro
    const stepIndex = macro.steps.findIndex(s => s.stepNumber === editingNode.stepNumber);
    if (stepIndex === -1) {
      alert('❌ Step not found');
      return;
    }

    // Update step with new configuration
    const updatedSteps = [...macro.steps];
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      inputMode: editInputMode,
      mode: editInputMode, // For compatibility
      staticValue: editStaticValue,
      value: editStaticValue, // For compatibility
      promptConfig: {
        enabled: editInputMode === 'prompt',
        question: editPromptQuestion,
        defaultValue: editPromptDefault,
        placeholder: editPromptPlaceholder
      },
      aiConfig: {
        enabled: editInputMode === 'ai',
        prompt: editAiPrompt,
        model: editAiModel,
        temperature: editAiTemperature,
        examples: []
      },
      editable: true
    };

    // Update macro
    const updatedMacro = {
      ...macro,
      steps: updatedSteps,
      updatedAt: Date.now()
    };

    setMacro(updatedMacro);
    setShowEditModal(false);

    console.log('[MacroFlowViewer] Input step updated successfully');
  };

  // Save macro
  const handleSave = async () => {
    console.log('[MacroFlowViewer] Saving macro');

    try {
      // Check if name needs to be entered/changed
      if (macro.name === 'Untitled Macro' || macro.name === 'New Macro') {
        // Show modal for name input - start with empty string for better UX
        setMacroName('');
        setNameError('');
        setShowSaveModal(true);
      } else {
        // Direct save without name prompt
        macro.updatedAt = Date.now();
        const result = await ipcRenderer.invoke('save-macro', macro);

        if (result.success) {
          alert('✅ Macro saved successfully!');
        } else {
          alert('❌ Failed to save macro: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[MacroFlowViewer] Save failed:', error);
      alert('❌ Failed to save macro: ' + error.message);
    }
  };

  // Add new node to the flow
  const handleAddNode = useCallback((nodeType) => {
    console.log('[MacroFlowViewer] Adding new node:', nodeType);

    // Create new step
    const newStepNumber = macro.steps.length + 1;
    const newStep = {
      type: nodeType,
      stepNumber: newStepNumber,
      timestamp: Date.now()
    };

    // Add default properties based on type
    switch (nodeType) {
      case 'navigation':
        newStep.url = 'https://example.com';
        newStep.description = 'Navigate to URL';
        break;
      case 'click':
        newStep.description = 'Click element';
        newStep.selector = '';
        break;
      case 'input':
        newStep.description = 'Enter text';
        newStep.selector = '';
        newStep.value = '';
        newStep.mode = 'direct';
        break;
      case 'wait':
        newStep.description = 'Wait';
        newStep.duration = 1000;
        break;
      case 'keypress':
        newStep.description = 'Press key';
        newStep.key = 'Enter';
        break;
    }

    const updatedMacro = {
      ...macro,
      steps: [...macro.steps, newStep]
    };

    setMacro(updatedMacro);
  }, [macro, setMacro]);

  return (
    <div className="macro-flow-viewer">
      <div className="flow-header">
        <div className="macro-info">
          <h2>{macro.name}</h2>
          <span className="step-count">{macro.steps?.length || 0} steps</span>
        </div>

        <div className="flow-toolbar">
          <button className="btn btn-run" onClick={handleRun} title="Run macro">
            ▶️ Run
          </button>
          <button
            className="btn btn-optimize"
            onClick={handleOptimize}
            disabled={isOptimizing}
            title="Optimize flow with AI"
          >
            {isOptimizing ? '⏳ Optimizing...' : '⚡ Optimize'}
          </button>
          <button className="btn btn-save" onClick={handleSave} title="Save macro">
            💾 Save
          </button>
        </div>
      </div>

      <div className="node-toolbar">
        <span className="toolbar-label">Add Node:</span>
        <button className="toolbar-btn" onClick={() => handleAddNode('navigation')} title="Add Navigation Step">
          🌐 Navigate
        </button>
        <button className="toolbar-btn" onClick={() => handleAddNode('click')} title="Add Click Step">
          👆 Click
        </button>
        <button className="toolbar-btn" onClick={() => handleAddNode('input')} title="Add Input Step">
          ⌨️ Input
        </button>
        <button className="toolbar-btn" onClick={() => handleAddNode('wait')} title="Add Wait Step">
          ⏱️ Wait
        </button>
        <button className="toolbar-btn" onClick={() => handleAddNode('keypress')} title="Add Keypress Step">
          🔑 Keypress
        </button>
        <span className="toolbar-hint">💡 Tip: Select a node and press Delete to remove it</span>
      </div>

      <div className="flow-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          nodeTypes={nodeTypes}
          nodesDeletable={true}
          edgesDeletable={true}
          fitView
          attributionPosition="bottom-left"
        >
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              switch (node.type) {
                case 'start':
                  return '#10b981';
                case 'end':
                  return '#ef4444';
                case 'navigation':
                  return '#667eea';
                case 'click':
                  return '#f59e0b';
                case 'input':
                  return '#10b981';
                case 'wait':
                  return '#6b7280';
                case 'keypress':
                  return '#8b5cf6';
                default:
                  return '#6b7280';
              }
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
          />
          <Background variant="dots" gap={12} size={1} />
        </ReactFlow>
      </div>

      {/* Save Macro Modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Save Macro</h3>
            <p className="modal-description">Enter a name for your macro</p>

            <div className="form-group">
              <label htmlFor="macro-name">Macro Name:</label>
              <input
                id="macro-name"
                type="text"
                value={macroName}
                onChange={handleNameChange}
                onKeyDown={(e) => {
                  e.stopPropagation(); // Prevent React Flow from capturing keyboard events
                  if (e.key === 'Enter' && !nameError) {
                    confirmSave();
                  } else if (e.key === 'Escape') {
                    setShowSaveModal(false);
                  }
                }}
                onKeyPress={(e) => e.stopPropagation()}
                onKeyUp={(e) => e.stopPropagation()}
                placeholder="Enter macro name (3-100 characters)"
                autoFocus
                className={nameError ? 'input-error' : ''}
              />
              {nameError && <div className="error-message">❌ {nameError}</div>}
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={confirmSave}
                disabled={!!nameError || !macroName.trim()}
              >
                💾 Save
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setShowSaveModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Input Modal */}
      {showEditModal && editingNode && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content edit-input-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Input Step</h3>
            <p className="modal-description">
              Configure how this input field will be filled: {editingNode.target?.description || 'Input Field'}
            </p>

            {/* Input Mode Selection */}
            <div className="form-group">
              <label>Input Mode:</label>
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="inputMode"
                    value="static"
                    checked={editInputMode === 'static'}
                    onChange={(e) => setEditInputMode(e.target.value)}
                  />
                  <span>Static Value</span>
                  <small>Use a fixed value every time</small>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="inputMode"
                    value="prompt"
                    checked={editInputMode === 'prompt'}
                    onChange={(e) => setEditInputMode(e.target.value)}
                  />
                  <span>Prompt User</span>
                  <small>Ask user for input when running</small>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="inputMode"
                    value="ai"
                    checked={editInputMode === 'ai'}
                    onChange={(e) => setEditInputMode(e.target.value)}
                  />
                  <span>AI Generated</span>
                  <small>Generate value using AI</small>
                </label>
              </div>
            </div>

            {/* Static Mode Configuration */}
            {editInputMode === 'static' && (
              <div className="form-group">
                <label htmlFor="edit-static-value">Value:</label>
                <input
                  id="edit-static-value"
                  type="text"
                  value={editStaticValue}
                  onChange={(e) => setEditStaticValue(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  onKeyPress={(e) => e.stopPropagation()}
                  onKeyUp={(e) => e.stopPropagation()}
                  placeholder="Enter the value to input"
                  className="input-field"
                />
              </div>
            )}

            {/* Prompt Mode Configuration */}
            {editInputMode === 'prompt' && (
              <>
                <div className="form-group">
                  <label htmlFor="edit-prompt-question">Question to ask user:</label>
                  <input
                    id="edit-prompt-question"
                    type="text"
                    value={editPromptQuestion}
                    onChange={(e) => setEditPromptQuestion(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    onKeyPress={(e) => e.stopPropagation()}
                    onKeyUp={(e) => e.stopPropagation()}
                    placeholder="e.g., What is your email address?"
                    className="input-field"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit-prompt-default">Default value:</label>
                  <input
                    id="edit-prompt-default"
                    type="text"
                    value={editPromptDefault}
                    onChange={(e) => setEditPromptDefault(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    onKeyPress={(e) => e.stopPropagation()}
                    onKeyUp={(e) => e.stopPropagation()}
                    placeholder="Default value (optional)"
                    className="input-field"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit-prompt-placeholder">Placeholder:</label>
                  <input
                    id="edit-prompt-placeholder"
                    type="text"
                    value={editPromptPlaceholder}
                    onChange={(e) => setEditPromptPlaceholder(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    onKeyPress={(e) => e.stopPropagation()}
                    onKeyUp={(e) => e.stopPropagation()}
                    placeholder="Placeholder text (optional)"
                    className="input-field"
                  />
                </div>
              </>
            )}

            {/* AI Mode Configuration */}
            {editInputMode === 'ai' && (
              <>
                <div className="form-group">
                  <label htmlFor="edit-ai-prompt">AI Prompt:</label>
                  <textarea
                    id="edit-ai-prompt"
                    value={editAiPrompt}
                    onChange={(e) => setEditAiPrompt(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    onKeyPress={(e) => e.stopPropagation()}
                    onKeyUp={(e) => e.stopPropagation()}
                    placeholder="e.g., Generate a random email address for testing"
                    className="textarea-field"
                    rows={3}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit-ai-model">Model:</label>
                  <select
                    id="edit-ai-model"
                    value={editAiModel}
                    onChange={(e) => setEditAiModel(e.target.value)}
                    className="select-field"
                  >
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-5-mini">GPT-5 Mini</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="edit-ai-temperature">Temperature: {editAiTemperature}</label>
                  <input
                    id="edit-ai-temperature"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={editAiTemperature}
                    onChange={(e) => setEditAiTemperature(parseFloat(e.target.value))}
                    className="range-field"
                  />
                  <small>Lower = more deterministic, Higher = more creative</small>
                </div>
              </>
            )}

            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={confirmEditInput}
              >
                ✅ Save Changes
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setShowEditModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MacroFlowViewer;
