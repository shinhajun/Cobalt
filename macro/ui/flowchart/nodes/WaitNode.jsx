// WaitNode.jsx - Wait/Delay node component

import React from 'react';
import { Handle, Position } from 'reactflow';

const WaitNode = ({ data }) => {
  const seconds = (data.timeout / 1000).toFixed(1);

  return (
    <div className="custom-node wait-node">
      <Handle type="target" position={Position.Left} />

      <div className="node-header">
        <span className="node-icon">⏱️</span>
        <span className="node-title">Wait</span>
      </div>

      <div className="node-content">
        <div className="wait-duration">
          {seconds}s
        </div>
        {data.condition && (
          <div className="wait-condition">
            for {data.condition}
          </div>
        )}
      </div>

      <div className="node-footer">
        <span className="step-number">#{data.stepNumber}</span>
        <span className="step-time">{(data.timestamp / 1000).toFixed(1)}s</span>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
};

export default WaitNode;
