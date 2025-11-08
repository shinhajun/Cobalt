// KeypressNode.jsx - Keypress action node component

import React from 'react';
import { Handle, Position } from 'reactflow';

const KeypressNode = ({ data }) => {
  return (
    <div className="custom-node keypress-node">
      <Handle type="target" position={Position.Left} />

      <div className="node-header">
        <span className="node-icon">⌨️</span>
        <span className="node-title">Press Key</span>
      </div>

      <div className="node-content">
        <div className="key-display">
          {data.key}
        </div>
      </div>

      <div className="node-footer">
        <span className="step-number">#{data.stepNumber}</span>
        <span className="step-time">{(data.timestamp / 1000).toFixed(1)}s</span>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
};

export default KeypressNode;
