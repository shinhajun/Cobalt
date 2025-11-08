// NavigationNode.jsx - Navigation step node component

import React from 'react';
import { Handle, Position } from 'reactflow';

const NavigationNode = ({ data }) => {
  return (
    <div className="custom-node navigation-node">
      <Handle type="target" position={Position.Left} />

      <div className="node-header">
        <span className="node-icon">🌐</span>
        <span className="node-title">Navigate</span>
      </div>

      <div className="node-content">
        <div className="url-display" title={data.url}>
          {data.url}
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

export default NavigationNode;
