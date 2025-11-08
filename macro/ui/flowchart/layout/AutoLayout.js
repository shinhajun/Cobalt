// AutoLayout.js - Dagre-based automatic layout for macro flowchart

import dagre from 'dagre';

/**
 * Calculate positions for nodes using Dagre layout algorithm
 * @param {Array} nodes - Array of React Flow nodes
 * @param {Array} edges - Array of React Flow edges
 * @param {string} direction - 'TB' (top-bottom) or 'LR' (left-right)
 * @returns {Array} Nodes with calculated positions
 */
export function getLayoutedElements(nodes, edges, direction = 'LR') {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 220;
  const nodeHeight = 80;

  // Configure graph settings
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 80,    // Horizontal spacing between nodes
    ranksep: 150,   // Vertical spacing between ranks
    edgesep: 50,    // Edge spacing
    marginx: 50,
    marginy: 50
  });

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: nodeWidth,
      height: nodeHeight
    });
  });

  // Add edges to dagre graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Calculate layout
  dagre.layout(dagreGraph);

  // Apply calculated positions to nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2
      }
    };
  });

  return layoutedNodes;
}

/**
 * Calculate optimal direction based on number of nodes
 * @param {number} nodeCount - Number of nodes in the flow
 * @returns {string} 'TB' or 'LR'
 */
export function getOptimalDirection(nodeCount) {
  // Use horizontal layout for most cases (better for wide screens)
  // Use vertical layout for very small flows
  return nodeCount <= 3 ? 'TB' : 'LR';
}

/**
 * Group nodes by type for better organization
 * @param {Array} nodes - Array of nodes
 * @returns {Object} Nodes grouped by type
 */
export function groupNodesByType(nodes) {
  return nodes.reduce((groups, node) => {
    const type = node.data.type || 'default';
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(node);
    return groups;
  }, {});
}
