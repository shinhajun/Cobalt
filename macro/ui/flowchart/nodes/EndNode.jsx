// EndNode.jsx - End node component for macro flowchart

import React from 'react';
import { Handle, Position } from 'reactflow';

const EndNode = ({ data }) => {
  return (
    <div className="custom-node end-node">
      <Handle type="target" position={Position.Left} />

      <div className="node-header">
        <span className="node-icon">🏁</span>
        <span className="node-title">END</span>
      </div>

      <div className="node-content">
        <div className="end-label">
          Macro Complete
        </div>
        {data.totalSteps && (
          <div className="end-stats">
            {data.totalSteps} steps completed
          </div>
        )}
      </div>
    </div>
  );
};

export default EndNode;
