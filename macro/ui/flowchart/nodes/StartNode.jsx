// StartNode.jsx - Start node component for macro flowchart

import React from 'react';
import { Handle, Position } from 'reactflow';

const StartNode = ({ data }) => {
  return (
    <div className="custom-node start-node">
      <div className="node-header">
        <span className="node-icon">▶️</span>
        <span className="node-title">START</span>
      </div>

      <div className="node-content">
        <div className="start-label">
          {data.macroName || 'Macro Start'}
        </div>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
};

export default StartNode;
