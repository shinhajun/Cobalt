/**
 * DOM Service
 * Based on browser-use's service.py
 * Service for getting the DOM tree and other DOM-related information using CDP
 */

import { Page, CDPSession } from 'playwright';
import { Protocol } from 'playwright-core/types/protocol';
import {
  EnhancedDOMTreeNode,
  EnhancedAXNode,
  EnhancedSnapshotNode,
  NodeType,
  SerializedDOMState,
  createEnhancedDOMTreeNode,
} from './views';
import { buildSnapshotLookup, REQUIRED_COMPUTED_STYLES } from './enhancedSnapshot';
import { DOMTreeSerializer } from './serializer/serializer';

export interface DomServiceConfig {
  crossOriginIframes?: boolean;
  paintOrderFiltering?: boolean;
  maxIframes?: number;
  maxIframeDepth?: number;
}

export class DomService {
  private cdpSession: CDPSession | null = null;
  private config: Required<DomServiceConfig>;

  constructor(
    private page: Page,
    config: DomServiceConfig = {}
  ) {
    this.config = {
      crossOriginIframes: config.crossOriginIframes ?? false,
      paintOrderFiltering: config.paintOrderFiltering ?? true,
      maxIframes: config.maxIframes ?? 100,
      maxIframeDepth: config.maxIframeDepth ?? 5,
    };
  }

  /**
   * Get or create CDP session
   */
  private async getCDPSession(): Promise<CDPSession> {
    if (!this.cdpSession) {
      this.cdpSession = await this.page.context().newCDPSession(this.page);
    }
    return this.cdpSession;
  }

  /**
   * Get serialized DOM tree for LLM consumption
   */
  async getSerializedDOMTree(
    previousCachedState: SerializedDOMState | null = null
  ): Promise<{
    state: SerializedDOMState;
    timing: Record<string, number>;
    llmRepresentation: string;
  }> {
    const startTime = Date.now();

    try {
      // Get CDP session
      const cdp = await this.getCDPSession();

      // Fetch all required data in parallel
      const [snapshot, domTree, axTree, viewport] = await Promise.all([
        cdp.send('DOMSnapshot.captureSnapshot', {
          computedStyles: REQUIRED_COMPUTED_STYLES,
        }),
        cdp.send('DOM.getDocument', { depth: -1, pierce: true }),
        cdp.send('Accessibility.getFullAXTree', {}),
        cdp.send('Page.getLayoutMetrics', {}),
      ]);

      const devicePixelRatio = (viewport.visualViewport as any)?.pageScaleFactor || 1.0;

      // Build enhanced DOM tree
      const snapshotLookup = buildSnapshotLookup(snapshot, devicePixelRatio);
      const axNodeMap = this.buildAXNodeMap(axTree);
      const enhancedRoot = this.buildEnhancedDOMTree(
        domTree.root,
        snapshotLookup,
        axNodeMap
      );

      if (!enhancedRoot) {
        return {
          state: { root: null, selectorMap: {} },
          timing: { total: Date.now() - startTime },
          llmRepresentation: 'No DOM tree found.',
        };
      }

      // Serialize the tree
      const serializer = new DOMTreeSerializer(
        enhancedRoot,
        previousCachedState,
        true, // enable bbox filtering
        null, // use default containment threshold
        this.config.paintOrderFiltering
      );

      const { state, timing } = serializer.serializeAccessibleElements();

      // Generate LLM representation
      const llmRepresentation = DOMTreeSerializer.generateLLMRepresentation(state);

      timing.total = Date.now() - startTime;

      return {
        state,
        timing,
        llmRepresentation,
      };
    } catch (error) {
      console.error('[DomService] Error getting serialized DOM tree:', error);
      return {
        state: { root: null, selectorMap: {} },
        timing: { total: Date.now() - startTime, error: 1 },
        llmRepresentation: 'Error: Could not extract DOM tree.',
      };
    }
  }

  /**
   * Build a map of AX node IDs to AX nodes
   */
  private buildAXNodeMap(
    axTree: Protocol.Accessibility.getFullAXTreeReturnValue
  ): Map<string, EnhancedAXNode> {
    const axNodeMap = new Map<string, EnhancedAXNode>();

    for (const node of axTree.nodes) {
      const enhancedAXNode: EnhancedAXNode = {
        axNodeId: node.nodeId,
        ignored: node.ignored ?? false,
        role: node.role?.value || null,
        name: node.name?.value || null,
        description: node.description?.value || null,
        properties: node.properties?.map(prop => ({
          name: prop.name,
          value: prop.value?.value ?? null,
        })) || null,
        childIds: node.childIds || null,
      };

      if (node.backendDOMNodeId) {
        // Store by backend DOM node ID for easier lookup
        axNodeMap.set(node.backendDOMNodeId.toString(), enhancedAXNode);
      }
    }

    return axNodeMap;
  }

  /**
   * Build enhanced DOM tree recursively
   */
  private buildEnhancedDOMTree(
    domNode: Protocol.DOM.Node,
    snapshotLookup: Map<number, EnhancedSnapshotNode>,
    axNodeMap: Map<string, EnhancedAXNode>,
    parentNode: EnhancedDOMTreeNode | null = null
  ): EnhancedDOMTreeNode | null {
    const backendNodeId = domNode.backendNodeId;
    if (!backendNodeId) return null;

    // Get snapshot data
    const snapshotNode = snapshotLookup.get(backendNodeId) || null;

    // Get AX node data
    const axNode = axNodeMap.get(backendNodeId.toString()) || null;

    // Parse attributes
    const attributes: Record<string, string> = {};
    if (domNode.attributes) {
      for (let i = 0; i < domNode.attributes.length; i += 2) {
        const name = domNode.attributes[i];
        const value = domNode.attributes[i + 1] || '';
        attributes[name] = value;
      }
    }

    // Check if scrollable
    const isScrollable = this.isElementScrollable(snapshotNode);

    // Determine visibility (simplified check)
    const isVisible = this.isElementVisible(snapshotNode);

    // Create enhanced node
    const enhancedNode = createEnhancedDOMTreeNode({
      nodeId: domNode.nodeId,
      backendNodeId: backendNodeId,
      nodeType: domNode.nodeType as NodeType,
      nodeName: domNode.nodeName || '',
      nodeValue: domNode.nodeValue || '',
      attributes,
      isScrollable,
      isVisible,
      absolutePosition: snapshotNode?.bounds || null,
      targetId: '',
      frameId: domNode.frameId || null,
      sessionId: null,
      contentDocument: null,
      shadowRootType: null,
      shadowRoots: null,
      parentNode,
      childrenNodes: null,
      axNode,
      snapshotNode,
      tagName: (domNode.nodeName || '').toLowerCase(),
      xpath: '',
    });

    // Process children
    const children: EnhancedDOMTreeNode[] = [];
    if (domNode.children) {
      for (const child of domNode.children) {
        const enhancedChild = this.buildEnhancedDOMTree(child, snapshotLookup, axNodeMap, enhancedNode);
        if (enhancedChild) {
          children.push(enhancedChild);
        }
      }
    }

    enhancedNode.childrenNodes = children.length > 0 ? children : null;

    // Process shadow roots
    if (domNode.shadowRoots && domNode.shadowRoots.length > 0) {
      const shadowRoots: EnhancedDOMTreeNode[] = [];
      for (const shadowRoot of domNode.shadowRoots) {
        const enhancedShadow = this.buildEnhancedDOMTree(shadowRoot, snapshotLookup, axNodeMap, enhancedNode);
        if (enhancedShadow) {
          shadowRoots.push(enhancedShadow);
        }
      }
      enhancedNode.shadowRoots = shadowRoots.length > 0 ? shadowRoots : null;
      enhancedNode.shadowRootType = domNode.shadowRootType as 'open' | 'closed' || null;
    }

    // Process content document (iframe)
    if (domNode.contentDocument) {
      const enhancedContentDoc = this.buildEnhancedDOMTree(domNode.contentDocument, snapshotLookup, axNodeMap, enhancedNode);
      if (enhancedContentDoc) {
        enhancedNode.contentDocument = enhancedContentDoc;
      }
    }

    return enhancedNode;
  }

  /**
   * Check if element is scrollable
   */
  private isElementScrollable(snapshotNode: EnhancedSnapshotNode | null): boolean {
    if (!snapshotNode || !snapshotNode.computedStyles) return false;

    const styles = snapshotNode.computedStyles;
    const overflow = styles['overflow'] || '';
    const overflowX = styles['overflow-x'] || '';
    const overflowY = styles['overflow-y'] || '';

    return (
      overflow === 'scroll' ||
      overflow === 'auto' ||
      overflowX === 'scroll' ||
      overflowX === 'auto' ||
      overflowY === 'scroll' ||
      overflowY === 'auto'
    );
  }

  /**
   * Check if element is visible (simplified)
   */
  private isElementVisible(snapshotNode: EnhancedSnapshotNode | null): boolean {
    if (!snapshotNode) return false;
    if (!snapshotNode.bounds) return false;

    const styles = snapshotNode.computedStyles;
    if (!styles) return true; // Assume visible if no styles

    // Check CSS visibility
    if (styles['display'] === 'none') return false;
    if (styles['visibility'] === 'hidden') return false;

    const opacity = parseFloat(styles['opacity'] || '1');
    if (opacity <= 0.1) return false;

    // Check if has valid bounds
    if (snapshotNode.bounds.width <= 0 || snapshotNode.bounds.height <= 0) {
      return false;
    }

    return true;
  }

  /**
   * Close CDP session
   */
  async close(): Promise<void> {
    if (this.cdpSession) {
      await this.cdpSession.detach();
      this.cdpSession = null;
    }
  }
}
