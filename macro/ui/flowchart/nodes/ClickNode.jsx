// ClickNode.jsx - Click action node component

import React from 'react';
import { Handle, Position } from 'reactflow';

const ClickNode = ({ data }) => {
  return (
    <div className="custom-node click-node">
      <Handle type="target" position={Position.Left} />

      <div className="node-header">
        <span className="node-icon">👆</span>
        <span className="node-title">Click</span>
      </div>

      <div className="node-content">
        <div className="target-description">
          {data.target?.description || 'Element'}
        </div>
        {data.target?.selector && (
          <div className="selector-hint" title={data.target.selector}>
            {data.target.selector.length > 30
              ? data.target.selector.substring(0, 30) + '...'
              : data.target.selector}
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

export default ClickNode;
