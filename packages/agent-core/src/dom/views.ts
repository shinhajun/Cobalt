/**
 * Data type definitions for DOM extraction system
 * Based on browser-use's views.py
 */

import { Protocol } from 'playwright-core/types/protocol';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_INCLUDE_ATTRIBUTES = [
  'title',
  'type',
  'checked',
  'id',
  'name',
  'role',
  'value',
  'placeholder',
  'data-date-format',
  'alt',
  'aria-label',
  'aria-expanded',
  'data-state',
  'aria-checked',
  'aria-valuemin',
  'aria-valuemax',
  'aria-valuenow',
  'aria-placeholder',
  'pattern',
  'min',
  'max',
  'minlength',
  'maxlength',
  'step',
  'pseudo',
  'selected',
  'expanded',
  'pressed',
  'disabled',
  'invalid',
  'valuemin',
  'valuemax',
  'valuenow',
  'keyshortcuts',
  'haspopup',
  'multiselectable',
  'required',
  'valuetext',
  'level',
  'busy',
  'live',
  'ax_name',
];

export const STATIC_ATTRIBUTES = new Set([
  'class',
  'id',
  'name',
  'type',
  'placeholder',
  'aria-label',
  'title',
  'role',
  'data-testid',
  'data-test',
  'data-cy',
  'data-selenium',
  'for',
  'required',
  'disabled',
  'readonly',
  'checked',
  'selected',
  'multiple',
  'href',
  'target',
  'rel',
  'aria-describedby',
  'aria-labelledby',
  'aria-controls',
  'aria-owns',
  'aria-live',
  'aria-atomic',
  'aria-busy',
  'aria-disabled',
  'aria-hidden',
  'aria-pressed',
  'aria-checked',
  'aria-selected',
  'tabindex',
  'alt',
  'src',
  'lang',
  'itemscope',
  'itemtype',
  'itemprop',
  'pseudo',
  'aria-valuemin',
  'aria-valuemax',
  'aria-valuenow',
  'aria-placeholder',
]);

// ============================================================================
// Enums
// ============================================================================

export enum NodeType {
  ELEMENT_NODE = 1,
  ATTRIBUTE_NODE = 2,
  TEXT_NODE = 3,
  CDATA_SECTION_NODE = 4,
  ENTITY_REFERENCE_NODE = 5,
  ENTITY_NODE = 6,
  PROCESSING_INSTRUCTION_NODE = 7,
  COMMENT_NODE = 8,
  DOCUMENT_NODE = 9,
  DOCUMENT_TYPE_NODE = 10,
  DOCUMENT_FRAGMENT_NODE = 11,
  NOTATION_NODE = 12,
}

// ============================================================================
// Basic Data Structures
// ============================================================================

export interface DOMRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PropagatingBounds {
  tag: string;
  bounds: DOMRect;
  nodeId: number;
  depth: number;
}

// ============================================================================
// Accessibility Node
// ============================================================================

export interface EnhancedAXProperty {
  name: string;
  value: string | boolean | null;
}

export interface EnhancedAXNode {
  axNodeId: string;
  ignored: boolean;
  role: string | null;
  name: string | null;
  description: string | null;
  properties: EnhancedAXProperty[] | null;
  childIds: string[] | null;
}

// ============================================================================
// Snapshot Node
// ============================================================================

export interface EnhancedSnapshotNode {
  isClickable: boolean | null;
  cursorStyle: string | null;

  /** Document coordinates (origin = top-left of page, ignores scroll) */
  bounds: DOMRect | null;

  /** Viewport coordinates (origin = top-left of visible scrollport) */
  clientRects: DOMRect | null;

  /** Scrollable area of the element */
  scrollRects: DOMRect | null;

  /** Computed styles from layout tree */
  computedStyles: Record<string, string> | null;

  /** Paint order from layout tree */
  paintOrder: number | null;

  /** Stacking contexts from layout tree */
  stackingContexts: number | null;
}

// ============================================================================
// Enhanced DOM Tree Node
// ============================================================================

export interface EnhancedDOMTreeNode {
  // DOM Node data
  nodeId: number;
  backendNodeId: number;
  nodeType: NodeType;
  nodeName: string;
  nodeValue: string;
  attributes: Record<string, string>;
  isScrollable: boolean | null;
  isVisible: boolean | null;
  absolutePosition: DOMRect | null;

  // Frames
  targetId: string;
  frameId: string | null;
  sessionId: string | null;
  contentDocument: EnhancedDOMTreeNode | null;

  // Shadow DOM
  shadowRootType: 'open' | 'closed' | null;
  shadowRoots: EnhancedDOMTreeNode[] | null;

  // Navigation
  parentNode: EnhancedDOMTreeNode | null;
  childrenNodes: EnhancedDOMTreeNode[] | null;

  // AX Node data
  axNode: EnhancedAXNode | null;

  // Snapshot Node data
  snapshotNode: EnhancedSnapshotNode | null;

  // Compound control child components
  compoundChildren: any[];

  // UUID for tracking
  uuid: string;

  // Computed properties
  tagName: string;
  xpath: string;
}

// ============================================================================
// Simplified Node (for serialization)
// ============================================================================

export interface SimplifiedNode {
  originalNode: EnhancedDOMTreeNode;
  children: SimplifiedNode[];
  shouldDisplay: boolean;
  isInteractive: boolean;
  isNew: boolean;
  ignoredByPaintOrder: boolean;
  excludedByParent: boolean;
  isShadowHost: boolean;
  isCompoundComponent: boolean;
}

// ============================================================================
// Serialized DOM State
// ============================================================================

export type DOMSelectorMap = Record<number, EnhancedDOMTreeNode>;

export interface SerializedDOMState {
  root: SimplifiedNode | null;
  selectorMap: DOMSelectorMap;
}

export interface SerializedDOMStateWithMethods extends SerializedDOMState {
  llmRepresentation(includeAttributes: string[]): string;
  evalRepresentation(includeAttributes: string[]): string;
}

// ============================================================================
// CDP Data Structures
// ============================================================================

export interface TargetAllTrees {
  snapshot: Protocol.DOMSnapshot.captureSnapshotReturnValue;
  domTree: Protocol.DOM.getDocumentReturnValue;
  axTree: Protocol.Accessibility.getFullAXTreeReturnValue;
  devicePixelRatio: number;
  cdpTiming: Record<string, number>;
}

export interface CurrentPageTargets {
  pageSession: Protocol.Target.TargetInfo;
  iframeSessions: Protocol.Target.TargetInfo[];
}

// ============================================================================
// Utility Functions
// ============================================================================

export function createDOMRect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height };
}

export function createEnhancedDOMTreeNode(partial: Partial<EnhancedDOMTreeNode>): EnhancedDOMTreeNode {
  return {
    nodeId: 0,
    backendNodeId: 0,
    nodeType: NodeType.ELEMENT_NODE,
    nodeName: '',
    nodeValue: '',
    attributes: {},
    isScrollable: null,
    isVisible: null,
    absolutePosition: null,
    targetId: '',
    frameId: null,
    sessionId: null,
    contentDocument: null,
    shadowRootType: null,
    shadowRoots: null,
    parentNode: null,
    childrenNodes: null,
    axNode: null,
    snapshotNode: null,
    compoundChildren: [],
    uuid: generateUUID(),
    tagName: '',
    xpath: '',
    ...partial,
  };
}

export function createSimplifiedNode(
  originalNode: EnhancedDOMTreeNode,
  children: SimplifiedNode[] = []
): SimplifiedNode {
  return {
    originalNode,
    children,
    shouldDisplay: true,
    isInteractive: false,
    isNew: false,
    ignoredByPaintOrder: false,
    excludedByParent: false,
    isShadowHost: false,
    isCompoundComponent: false,
  };
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
