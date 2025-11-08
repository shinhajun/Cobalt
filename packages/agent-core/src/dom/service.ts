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

/**
 * Frame context for tracking iframe hierarchy and offsets
 */
interface FrameContext {
  htmlFrames: EnhancedDOMTreeNode[];
  totalFrameOffset: { x: number; y: number };
  iframeScrollPositions: Record<number, { scrollTop: number; scrollLeft: number }>;
  viewport: {
    width: number;
    height: number;
    pageScaleFactor: number;
  };
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
   * Capture iframe scroll positions before DOM snapshot
   * Critical for correct visibility detection in scrolled iframes
   */
  private async getIframeScrollPositions(): Promise<Record<number, { scrollTop: number; scrollLeft: number }>> {
    try {
      const cdp = await this.getCDPSession();

      const result = await cdp.send('Runtime.evaluate', {
        expression: `
          (() => {
            const scrollData = {};
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach((iframe, index) => {
              try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (doc) {
                  scrollData[index] = {
                    scrollTop: doc.documentElement?.scrollTop || doc.body?.scrollTop || 0,
                    scrollLeft: doc.documentElement?.scrollLeft || doc.body?.scrollLeft || 0
                  };
                }
              } catch (e) {
                // Cross-origin iframe - can't access
                scrollData[index] = { scrollTop: 0, scrollLeft: 0 };
              }
            });
            return scrollData;
          })()
        `,
        returnByValue: true,
      });

      return (result.result?.value as Record<number, { scrollTop: number; scrollLeft: number }>) || {};
    } catch (error) {
      console.error('[DomService] Error capturing iframe scroll positions:', error);
      return {};
    }
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

      // Fetch all required data in parallel, including iframe scroll positions
      const [snapshot, domTree, axTree, viewport, iframeScrollPositions] = await Promise.all([
        cdp.send('DOMSnapshot.captureSnapshot', {
          computedStyles: REQUIRED_COMPUTED_STYLES,
        }),
        cdp.send('DOM.getDocument', { depth: -1, pierce: true }),
        cdp.send('Accessibility.getFullAXTree', {}),
        cdp.send('Page.getLayoutMetrics', {}),
        this.getIframeScrollPositions(),
      ]);

      const devicePixelRatio = (viewport.visualViewport as any)?.pageScaleFactor || 1.0;
      const viewportWidth = (viewport.visualViewport as any)?.clientWidth || 1920;
      const viewportHeight = (viewport.visualViewport as any)?.clientHeight || 1080;

      // Build enhanced DOM tree with frame context
      const snapshotLookup = buildSnapshotLookup(snapshot, devicePixelRatio);
      const axNodeMap = this.buildAXNodeMap(axTree);

      const initialFrameContext: FrameContext = {
        htmlFrames: [],
        totalFrameOffset: { x: 0, y: 0 },
        iframeScrollPositions,
        viewport: {
          width: viewportWidth,
          height: viewportHeight,
          pageScaleFactor: devicePixelRatio,
        },
      };

      const enhancedRoot = this.buildEnhancedDOMTree(
        domTree.root,
        snapshotLookup,
        axNodeMap,
        null,
        initialFrameContext
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
   * Build enhanced DOM tree recursively with frame context tracking
   */
  private buildEnhancedDOMTree(
    domNode: Protocol.DOM.Node,
    snapshotLookup: Map<number, EnhancedSnapshotNode>,
    axNodeMap: Map<string, EnhancedAXNode>,
    parentNode: EnhancedDOMTreeNode | null = null,
    frameContext: FrameContext = {
      htmlFrames: [],
      totalFrameOffset: { x: 0, y: 0 },
      iframeScrollPositions: {},
      viewport: { width: 1920, height: 1080, pageScaleFactor: 1.0 },
    }
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

    const tagName = (domNode.nodeName || '').toLowerCase();

    // Check if scrollable (enhanced detection)
    const isScrollable = this.isElementScrollable(snapshotNode);

    // Create enhanced node (visibility will be set after we have the node reference)
    const enhancedNode = createEnhancedDOMTreeNode({
      nodeId: domNode.nodeId,
      backendNodeId: backendNodeId,
      nodeType: domNode.nodeType as NodeType,
      nodeName: domNode.nodeName || '',
      nodeValue: domNode.nodeValue || '',
      attributes,
      isScrollable,
      isVisible: null, // Will be set after frame context tracking
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
      tagName,
      xpath: '',
    });

    // Track HTML and IFRAME elements for frame context
    const updatedFrameContext = { ...frameContext };
    if (tagName === 'html') {
      // Add HTML element to frame stack
      updatedFrameContext.htmlFrames = [...frameContext.htmlFrames, enhancedNode];
    }

    // Determine visibility using parent frame-aware check
    enhancedNode.isVisible = this.isElementVisibleAccordingToAllParents(
      enhancedNode,
      updatedFrameContext
    );

    // Process children with updated frame context
    const children: EnhancedDOMTreeNode[] = [];
    if (domNode.children) {
      for (const child of domNode.children) {
        const enhancedChild = this.buildEnhancedDOMTree(
          child,
          snapshotLookup,
          axNodeMap,
          enhancedNode,
          updatedFrameContext
        );
        if (enhancedChild) {
          children.push(enhancedChild);
        }
      }
    }

    enhancedNode.childrenNodes = children.length > 0 ? children : null;

    // Process shadow roots with updated frame context
    if (domNode.shadowRoots && domNode.shadowRoots.length > 0) {
      const shadowRoots: EnhancedDOMTreeNode[] = [];
      for (const shadowRoot of domNode.shadowRoots) {
        const enhancedShadow = this.buildEnhancedDOMTree(
          shadowRoot,
          snapshotLookup,
          axNodeMap,
          enhancedNode,
          updatedFrameContext
        );
        if (enhancedShadow) {
          shadowRoots.push(enhancedShadow);
        }
      }
      enhancedNode.shadowRoots = shadowRoots.length > 0 ? shadowRoots : null;
      enhancedNode.shadowRootType = domNode.shadowRootType as 'open' | 'closed' || null;
    }

    // Process content document (iframe) with iframe offset
    if (domNode.contentDocument) {
      // For iframes, update frame offset based on iframe's position
      let iframeFrameContext = { ...updatedFrameContext };
      if (tagName === 'iframe' && snapshotNode?.bounds) {
        iframeFrameContext = {
          ...updatedFrameContext,
          totalFrameOffset: {
            x: updatedFrameContext.totalFrameOffset.x + snapshotNode.bounds.x,
            y: updatedFrameContext.totalFrameOffset.y + snapshotNode.bounds.y,
          },
        };
      }

      const enhancedContentDoc = this.buildEnhancedDOMTree(
        domNode.contentDocument,
        snapshotLookup,
        axNodeMap,
        enhancedNode,
        iframeFrameContext
      );
      if (enhancedContentDoc) {
        enhancedNode.contentDocument = enhancedContentDoc;
      }
    }

    return enhancedNode;
  }

  /**
   * Enhanced scrollability detection
   * Matches browser-use's enhanced detection combining CDP with CSS analysis
   */
  private isElementScrollable(snapshotNode: EnhancedSnapshotNode | null): boolean {
    if (!snapshotNode) return false;

    // First check CSS properties
    const styles = snapshotNode.computedStyles;
    if (styles) {
      const overflow = (styles['overflow'] || '').toLowerCase();
      const overflowX = (styles['overflow-x'] || overflow).toLowerCase();
      const overflowY = (styles['overflow-y'] || overflow).toLowerCase();

      const hasScrollCSS =
        overflow === 'scroll' ||
        overflow === 'auto' ||
        overflow === 'overlay' ||
        overflowX === 'scroll' ||
        overflowX === 'auto' ||
        overflowX === 'overlay' ||
        overflowY === 'scroll' ||
        overflowY === 'auto' ||
        overflowY === 'overlay';

      if (hasScrollCSS) return true;
    }

    // Enhanced detection: check if content overflows container
    const scrollRects = snapshotNode.scrollRects;
    const clientRects = snapshotNode.clientRects;

    if (scrollRects && clientRects) {
      const hasVerticalScroll = scrollRects.height > clientRects.height + 1;
      const hasHorizontalScroll = scrollRects.width > clientRects.width + 1;

      if (hasVerticalScroll || hasHorizontalScroll) {
        // Content overflows, check if CSS allows scrolling
        if (styles) {
          const overflow = (styles['overflow'] || 'visible').toLowerCase();
          const overflowX = (styles['overflow-x'] || overflow).toLowerCase();
          const overflowY = (styles['overflow-y'] || overflow).toLowerCase();

          const allowsScroll =
            ['auto', 'scroll', 'overlay'].includes(overflow) ||
            ['auto', 'scroll', 'overlay'].includes(overflowX) ||
            ['auto', 'scroll', 'overlay'].includes(overflowY);

          return allowsScroll;
        }
      }
    }

    return false;
  }

  /**
   * Check if element is visible according to all parent frames
   * Critical browser-use feature for correct iframe visibility detection
   */
  private isElementVisibleAccordingToAllParents(
    node: EnhancedDOMTreeNode,
    frameContext: FrameContext
  ): boolean {
    const snapshotNode = node.snapshotNode;
    if (!snapshotNode) return false;

    // 1. Check CSS visibility properties
    const styles = snapshotNode.computedStyles;
    if (styles) {
      const display = (styles['display'] || '').toLowerCase();
      const visibility = (styles['visibility'] || '').toLowerCase();
      const opacity = parseFloat(styles['opacity'] || '1');

      if (display === 'none') return false;
      if (visibility === 'hidden') return false;
      if (opacity <= 0) return false;
    }

    // 2. Check element has valid bounds
    let currentBounds = snapshotNode.bounds;
    if (!currentBounds) return false;
    if (currentBounds.width <= 0 || currentBounds.height <= 0) return false;

    // 3. Iterate through all parent HTML frames to check viewport intersection
    const htmlFrames = frameContext.htmlFrames;
    if (htmlFrames.length === 0) {
      // No parent frames, element is visible
      return true;
    }

    // Apply iframe offset transformations
    let transformedBounds = {
      x: currentBounds.x + frameContext.totalFrameOffset.x,
      y: currentBounds.y + frameContext.totalFrameOffset.y,
      width: currentBounds.width,
      height: currentBounds.height,
    };

    // Check intersection with each parent HTML frame's viewport
    for (const htmlFrame of htmlFrames) {
      const frameSnapshot = htmlFrame.snapshotNode;
      if (!frameSnapshot) continue;

      const frameScrollRects = frameSnapshot.scrollRects;
      const frameBounds = frameSnapshot.bounds;

      if (!frameBounds) continue;

      // Adjust for scroll position
      let scrollX = 0;
      let scrollY = 0;

      if (frameScrollRects) {
        scrollX = frameScrollRects.x || 0;
        scrollY = frameScrollRects.y || 0;
      }

      // Calculate element position relative to frame's scroll position
      const adjustedX = transformedBounds.x - scrollX;
      const adjustedY = transformedBounds.y - scrollY;

      // Check if element intersects with frame's viewport
      // Add 1000px buffer below viewport (browser-use does this for lazy-loaded content)
      const viewportLeft = 0;
      const viewportTop = 0;
      const viewportRight = frameContext.viewport.width;
      const viewportBottom = frameContext.viewport.height;

      const elementRight = adjustedX + transformedBounds.width;
      const elementBottom = adjustedY + transformedBounds.height;

      const intersects =
        adjustedX < viewportRight &&
        elementRight > viewportLeft &&
        adjustedY < viewportBottom + 1000 && // +1000px buffer below
        elementBottom > viewportTop - 1000; // +1000px buffer above

      if (!intersects) {
        // Element is scrolled out of view in this frame
        return false;
      }
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
