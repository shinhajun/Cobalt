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
    setEditingNode(nodeData);
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

  // Save macro
  const handleSave = async () => {
    console.log('[MacroFlowViewer] Saving macro');

    try {
      // Prompt for name if needed
      if (macro.name === 'Untitled Macro' || macro.name === 'New Macro') {
        const name = prompt('Enter a name for this macro:', macro.name);
        if (name) {
          macro.name = name;
        }
      }

      macro.updatedAt = Date.now();

      const result = await ipcRenderer.invoke('save-macro', macro);

      if (result.success) {
        alert('✅ Macro saved successfully!');
      } else {
        alert('❌ Failed to save macro: ' + result.error);
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

      {/* Edit Modal - will be implemented separately */}
      {showEditModal && editingNode && (
        <div className="edit-modal">
          <div className="modal-content">
            <h3>Edit Input Step</h3>
            <p>Modal content here...</p>
            <button onClick={() => setShowEditModal(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MacroFlowViewer;
