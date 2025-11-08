// InputNode.jsx - Input/Type text node component with inline editing

import React, { useState } from 'react';
import { Handle, Position } from 'reactflow';

const InputNode = ({ data, isConnectable }) => {
  const [isEditing, setIsEditing] = useState(false);

  const getInputModeLabel = (mode) => {
    const labels = {
      'static': '📌 Static',
      'prompt': '❓ Ask User',
      'ai': '🤖 AI Generated'
    };
    return labels[mode] || '📌 Static';
  };

  const getCurrentValue = () => {
    if (data.inputMode === 'static' || !data.inputMode) {
      return data.staticValue || '';
    } else if (data.inputMode === 'prompt') {
      return '[Will ask user]';
    } else if (data.inputMode === 'ai') {
      return '[AI generated]';
    }
    return '';
  };

  const handleEditClick = () => {
    // Trigger edit modal via event
    if (window.onEditInputNode) {
      window.onEditInputNode(data);
    }
    setIsEditing(true);
  };

  return (
    <div className="custom-node input-node">
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
      />

      <div className="node-header">
        <span className="node-icon">✏️</span>
        <span className="node-title">Type Text</span>
      </div>

      <div className="node-content">
        <div className="target-description">
          {data.target?.description || 'Input field'}
        </div>

        <div className="input-value-section">
          <div className="input-mode-badge">
            {getInputModeLabel(data.inputMode)}
          </div>
          <div className="input-value" title={getCurrentValue()}>
            {getCurrentValue().length > 25
              ? getCurrentValue().substring(0, 25) + '...'
              : getCurrentValue()}
          </div>
        </div>

        <button className="node-edit-btn" onClick={handleEditClick}>
          ✏️ Edit
        </button>
      </div>

      <div className="node-footer">
        <span className="step-number">#{data.stepNumber}</span>
        <span className="step-time">{(data.timestamp / 1000).toFixed(1)}s</span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
      />
    </div>
  );
};

export default InputNode;
