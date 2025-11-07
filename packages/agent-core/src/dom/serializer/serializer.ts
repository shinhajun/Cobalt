/**
 * DOM Tree Serializer
 * Based on browser-use's serializer/serializer.py
 * Serializes enhanced DOM trees to string format for LLM consumption
 */

import { ClickableElementDetector } from './clickableElements';
import { PaintOrderRemover } from './paintOrder';
import { capTextLength, rectContainedWithin } from '../utils';
import {
  DOMSelectorMap,
  EnhancedDOMTreeNode,
  NodeType,
  PropagatingBounds,
  SerializedDOMState,
  SimplifiedNode,
  createSimplifiedNode,
  DEFAULT_INCLUDE_ATTRIBUTES,
} from '../views';

const DISABLED_ELEMENTS = new Set(['style', 'script', 'head', 'meta', 'link', 'title']);

const SVG_ELEMENTS = new Set([
  'path',
  'rect',
  'g',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'use',
  'defs',
  'clipPath',
  'mask',
  'pattern',
  'image',
  'text',
  'tspan',
]);

interface PropagatingElementConfig {
  tag: string;
  role: string | null;
}

export class DOMTreeSerializer {
  // Configuration - elements that propagate bounds to their children
  private static readonly PROPAGATING_ELEMENTS: PropagatingElementConfig[] = [
    { tag: 'a', role: null },  // Any <a> tag
    { tag: 'button', role: null },  // Any <button> tag
    { tag: 'div', role: 'button' },  // <div role="button">
    { tag: 'div', role: 'combobox' },  // <div role="combobox">
    { tag: 'span', role: 'button' },  // <span role="button">
    { tag: 'span', role: 'combobox' },  // <span role="combobox">
    { tag: 'input', role: 'combobox' },  // <input role="combobox">
  ];

  private static readonly DEFAULT_CONTAINMENT_THRESHOLD = 0.99; // 99% containment

  private interactiveCounter: number = 1;
  private selectorMap: DOMSelectorMap = {};
  private previousCachedSelectorMap: DOMSelectorMap | null = null;
  private clickableCache: Map<number, boolean> = new Map();
  private enableBboxFiltering: boolean = true;
  private containmentThreshold: number;
  private paintOrderFiltering: boolean = true;
  public timingInfo: Record<string, number> = {};

  constructor(
    private rootNode: EnhancedDOMTreeNode,
    previousCachedState: SerializedDOMState | null = null,
    enableBboxFiltering: boolean = true,
    containmentThreshold: number | null = null,
    paintOrderFiltering: boolean = true
  ) {
    this.previousCachedSelectorMap = previousCachedState?.selectorMap || null;
    this.enableBboxFiltering = enableBboxFiltering;
    this.containmentThreshold = containmentThreshold || DOMTreeSerializer.DEFAULT_CONTAINMENT_THRESHOLD;
    this.paintOrderFiltering = paintOrderFiltering;
  }

  /**
   * Main serialization method
   */
  serializeAccessibleElements(): { state: SerializedDOMState; timing: Record<string, number> } {
    const startTotal = Date.now();

    // Reset state
    this.interactiveCounter = 1;
    this.selectorMap = {};
    this.clickableCache.clear();

    // Step 1: Create simplified tree
    const startStep1 = Date.now();
    const simplifiedTree = this.createSimplifiedTree(this.rootNode);
    this.timingInfo['create_simplified_tree'] = Date.now() - startStep1;

    if (!simplifiedTree) {
      return {
        state: { root: null, selectorMap: {} },
        timing: this.timingInfo,
      };
    }

    // Step 2: Remove elements based on paint order
    if (this.paintOrderFiltering) {
      const startStep2 = Date.now();
      new PaintOrderRemover(simplifiedTree).calculatePaintOrder();
      this.timingInfo['calculate_paint_order'] = Date.now() - startStep2;
    }

    // Step 3: Optimize tree
    const startStep3 = Date.now();
    const optimizedTree = this.optimizeTree(simplifiedTree);
    this.timingInfo['optimize_tree'] = Date.now() - startStep3;

    // Step 4: Apply bounding box filtering
    let filteredTree = optimizedTree;
    if (this.enableBboxFiltering && optimizedTree) {
      const startStep4 = Date.now();
      filteredTree = this.applyBoundingBoxFiltering(optimizedTree);
      this.timingInfo['bbox_filtering'] = Date.now() - startStep4;
    }

    // Step 5: Assign interactive indices
    const startStep5 = Date.now();
    this.assignInteractiveIndices(filteredTree);
    this.timingInfo['assign_interactive_indices'] = Date.now() - startStep5;

    this.timingInfo['serialize_accessible_elements_total'] = Date.now() - startTotal;

    return {
      state: { root: filteredTree, selectorMap: this.selectorMap },
      timing: this.timingInfo,
    };
  }

  /**
   * Create simplified tree from enhanced DOM tree
   */
  private createSimplifiedTree(node: EnhancedDOMTreeNode): SimplifiedNode | null {
    // Skip disabled elements
    if (DISABLED_ELEMENTS.has(node.tagName)) {
      return null;
    }

    // Skip SVG decorative elements
    if (SVG_ELEMENTS.has(node.tagName)) {
      return null;
    }

    // Create simplified node
    const simplified = createSimplifiedNode(node);

    // Check if interactive
    const isInteractive = this.isClickable(node);
    simplified.isInteractive = isInteractive;

    // Process children
    const children: SimplifiedNode[] = [];
    if (node.childrenNodes) {
      for (const child of node.childrenNodes) {
        const simplifiedChild = this.createSimplifiedTree(child);
        if (simplifiedChild) {
          children.push(simplifiedChild);
        }
      }
    }

    // Process shadow roots
    if (node.shadowRoots) {
      simplified.isShadowHost = true;
      for (const shadowRoot of node.shadowRoots) {
        const simplifiedShadow = this.createSimplifiedTree(shadowRoot);
        if (simplifiedShadow) {
          children.push(simplifiedShadow);
        }
      }
    }

    simplified.children = children;

    return simplified;
  }

  /**
   * Optimize tree by removing unnecessary non-interactive parents
   */
  private optimizeTree(node: SimplifiedNode | null): SimplifiedNode | null {
    if (!node) return null;

    // Recursively optimize children
    const optimizedChildren: SimplifiedNode[] = [];
    for (const child of node.children) {
      const optimized = this.optimizeTree(child);
      if (optimized) {
        optimizedChildren.push(optimized);
      }
    }

    node.children = optimizedChildren;

    // If this node is not interactive and has no interactive descendants, remove it
    if (!node.isInteractive && node.children.length === 0) {
      return null;
    }

    return node;
  }

  /**
   * Apply bounding box filtering to remove children contained within parent bounds
   */
  private applyBoundingBoxFiltering(node: SimplifiedNode): SimplifiedNode {
    this.filterChildrenByBoundingBox(node, null);
    return node;
  }

  /**
   * Recursively filter children based on bounding box containment
   */
  private filterChildrenByBoundingBox(
    node: SimplifiedNode,
    propagatingBounds: PropagatingBounds | null
  ): void {
    // Check if this node starts propagating bounds
    let currentPropagatingBounds = propagatingBounds;

    if (node.originalNode.snapshotNode?.bounds && this.shouldPropagateBounds(node.originalNode)) {
      currentPropagatingBounds = {
        tag: node.originalNode.tagName,
        bounds: node.originalNode.snapshotNode.bounds,
        nodeId: node.originalNode.backendNodeId,
        depth: 0,
      };
    }

    // Process children
    for (const child of node.children) {
      // Check if child is contained within propagating bounds
      if (
        currentPropagatingBounds &&
        child.originalNode.snapshotNode?.bounds &&
        this.shouldFilterByBounds(child.originalNode)
      ) {
        const childBounds = child.originalNode.snapshotNode.bounds;
        if (rectContainedWithin(childBounds, currentPropagatingBounds.bounds, this.containmentThreshold)) {
          child.excludedByParent = true;
        }
      }

      // Recurse
      this.filterChildrenByBoundingBox(child, currentPropagatingBounds);
    }
  }

  /**
   * Check if element should propagate bounds to children
   */
  private shouldPropagateBounds(node: EnhancedDOMTreeNode): boolean {
    for (const config of DOMTreeSerializer.PROPAGATING_ELEMENTS) {
      if (node.tagName === config.tag) {
        if (config.role === null || node.attributes.role === config.role) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if element should be filtered by bounds
   */
  private shouldFilterByBounds(node: EnhancedDOMTreeNode): boolean {
    // Don't filter form elements
    const formElements = new Set(['input', 'select', 'textarea', 'button']);
    if (formElements.has(node.tagName)) {
      return false;
    }

    // Don't filter elements with explicit onclick
    if (node.attributes.onclick) {
      return false;
    }

    // Don't filter elements with aria-label
    if (node.attributes['aria-label']) {
      return false;
    }

    return true;
  }

  /**
   * Assign interactive indices and mark new nodes
   */
  private assignInteractiveIndices(node: SimplifiedNode | null): void {
    if (!node) return;

    // Check if this node is new
    if (this.previousCachedSelectorMap) {
      const wasPresent = Object.values(this.previousCachedSelectorMap).some(
        n => n.backendNodeId === node.originalNode.backendNodeId
      );
      if (!wasPresent) {
        node.isNew = true;
      }
    }

    // Assign index if interactive and not excluded
    if (node.isInteractive && !node.ignoredByPaintOrder && !node.excludedByParent) {
      this.selectorMap[node.originalNode.backendNodeId] = node.originalNode;
    }

    // Recurse to children
    for (const child of node.children) {
      this.assignInteractiveIndices(child);
    }
  }

  /**
   * Check if node is clickable (with caching)
   */
  private isClickable(node: EnhancedDOMTreeNode): boolean {
    const cached = this.clickableCache.get(node.backendNodeId);
    if (cached !== undefined) {
      return cached;
    }

    const result = ClickableElementDetector.isInteractive(node);
    this.clickableCache.set(node.backendNodeId, result);
    return result;
  }

  /**
   * Generate LLM representation
   */
  static generateLLMRepresentation(
    state: SerializedDOMState,
    includeAttributes: string[] = DEFAULT_INCLUDE_ATTRIBUTES
  ): string {
    if (!state.root) {
      return 'No interactive elements found.';
    }

    const lines: string[] = [];
    this.serializeNode(state.root, lines, 0, includeAttributes, state.selectorMap);
    return lines.join('\n');
  }

  /**
   * Serialize a single node
   */
  private static serializeNode(
    node: SimplifiedNode,
    lines: string[],
    depth: number,
    includeAttributes: string[],
    selectorMap: DOMSelectorMap
  ): void {
    if (!node.shouldDisplay || node.ignoredByPaintOrder || node.excludedByParent) {
      return;
    }

    const indent = '  '.repeat(depth);
    const original = node.originalNode;

    // Get backend node ID if this element is in selector map
    let backendNodeId: number | null = null;
    for (const [id, n] of Object.entries(selectorMap)) {
      if (n.backendNodeId === original.backendNodeId) {
        backendNodeId = parseInt(id);
        break;
      }
    }

    // Build tag representation
    let tagRep = `<${original.tagName}`;

    // Add attributes
    const attrs: string[] = [];
    for (const attr of includeAttributes) {
      if (original.attributes[attr]) {
        const value = capTextLength(original.attributes[attr], 50);
        attrs.push(`${attr}="${value}"`);
      }
    }

    if (attrs.length > 0) {
      tagRep += ' ' + attrs.join(' ');
    }

    // Add text content if any
    let textContent = '';
    if (original.nodeType === NodeType.TEXT_NODE && original.nodeValue) {
      textContent = capTextLength(original.nodeValue.trim(), 100);
    }

    // Format line
    let line = indent;
    if (node.isNew) {
      line += '*';  // Mark new elements
    }
    if (backendNodeId !== null) {
      line += `[${backendNodeId}]`;
    }
    line += tagRep;
    if (textContent) {
      line += `>${textContent}</${original.tagName}>`;
    } else {
      line += ' />';
    }

    // Add shadow DOM marker
    if (node.isShadowHost) {
      line += ' |SHADOW|';
    }

    // Add scrollable marker
    if (original.isScrollable) {
      line += ' |SCROLL|';
    }

    lines.push(line);

    // Recurse to children
    for (const child of node.children) {
      this.serializeNode(child, lines, depth + 1, includeAttributes, selectorMap);
    }
  }
}
