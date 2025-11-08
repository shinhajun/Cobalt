/**
 * Enhanced Snapshot Processing
 * Based on browser-use's enhanced_snapshot.py
 * Provides functions for parsing CDP DOMSnapshot data
 */

import { Protocol } from 'playwright-core/types/protocol';
import { DOMRect, EnhancedSnapshotNode } from './views';

// Only ESSENTIAL computed styles
export const REQUIRED_COMPUTED_STYLES = [
  'display',
  'visibility',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'cursor',
  'pointer-events',
  'position',
  'background-color',
];

/**
 * Parse rare boolean data from snapshot
 */
function parseRareBooleanData(rareData: Protocol.DOMSnapshot.RareBooleanData | undefined, index: number): boolean | null {
  if (!rareData) return null;
  return rareData.index.includes(index) ? true : null;
}

/**
 * Parse computed styles from layout tree using string indices
 */
function parseComputedStyles(strings: string[], styleIndices: number[]): Record<string, string> {
  const styles: Record<string, string> = {};
  for (let i = 0; i < styleIndices.length && i < REQUIRED_COMPUTED_STYLES.length; i++) {
    const styleIndex = styleIndices[i];
    if (styleIndex >= 0 && styleIndex < strings.length) {
      styles[REQUIRED_COMPUTED_STYLES[i]] = strings[styleIndex];
    }
  }
  return styles;
}

/**
 * Build a lookup table of backend node ID to enhanced snapshot data
 */
export function buildSnapshotLookup(
  snapshot: Protocol.DOMSnapshot.captureSnapshotReturnValue,
  devicePixelRatio: number = 1.0
): Map<number, EnhancedSnapshotNode> {
  const snapshotLookup = new Map<number, EnhancedSnapshotNode>();

  if (!snapshot.documents || snapshot.documents.length === 0) {
    return snapshotLookup;
  }

  const strings = snapshot.strings;

  for (const document of snapshot.documents) {
    const nodes = document.nodes;
    const layout = document.layout;

    // Build backend node id to snapshot index lookup
    const backendNodeToSnapshotIndex = new Map<number, number>();
    if (nodes.backendNodeId) {
      nodes.backendNodeId.forEach((backendNodeId, i) => {
        backendNodeToSnapshotIndex.set(backendNodeId, i);
      });
    }

    // Pre-build layout index map to eliminate O(n²) lookups
    const layoutIndexMap = new Map<number, number>();
    if (layout?.nodeIndex) {
      layout.nodeIndex.forEach((nodeIndex, layoutIdx) => {
        if (!layoutIndexMap.has(nodeIndex)) {
          layoutIndexMap.set(nodeIndex, layoutIdx);
        }
      });
    }

    // Build snapshot lookup for each backend node id
    for (const [backendNodeId, snapshotIndex] of backendNodeToSnapshotIndex) {
      let isClickable: boolean | null = null;
      if (nodes.isClickable) {
        isClickable = parseRareBooleanData(nodes.isClickable, snapshotIndex);
      }

      // Find corresponding layout node
      let cursorStyle: string | null = null;
      let bounds: DOMRect | null = null;
      let clientRects: DOMRect | null = null;
      let scrollRects: DOMRect | null = null;
      let computedStyles: Record<string, string> | null = null;
      let paintOrder: number | null = null;
      let stackingContexts: number | null = null;

      if (layoutIndexMap.has(snapshotIndex) && layout) {
        const layoutIdx = layoutIndexMap.get(snapshotIndex)!;

        // Parse bounding box
        if (layout.bounds && layoutIdx < layout.bounds.length) {
          const boundsArray = layout.bounds[layoutIdx];
          if (boundsArray.length >= 4) {
            // CDP coordinates are in device pixels, convert to CSS pixels
            bounds = {
              x: boundsArray[0] / devicePixelRatio,
              y: boundsArray[1] / devicePixelRatio,
              width: boundsArray[2] / devicePixelRatio,
              height: boundsArray[3] / devicePixelRatio,
            };
          }
        }

        // Parse client rects (viewport coordinates)
        if (layout.clientRects && layoutIdx < layout.clientRects.length) {
          const clientRectsArray = layout.clientRects[layoutIdx];
          if (clientRectsArray.length >= 4) {
            clientRects = {
              x: clientRectsArray[0] / devicePixelRatio,
              y: clientRectsArray[1] / devicePixelRatio,
              width: clientRectsArray[2] / devicePixelRatio,
              height: clientRectsArray[3] / devicePixelRatio,
            };
          }
        }

        // Parse scroll rects
        if (layout.scrollRects && layoutIdx < layout.scrollRects.length) {
          const scrollRectsArray = layout.scrollRects[layoutIdx];
          if (scrollRectsArray.length >= 4) {
            scrollRects = {
              x: scrollRectsArray[0] / devicePixelRatio,
              y: scrollRectsArray[1] / devicePixelRatio,
              width: scrollRectsArray[2] / devicePixelRatio,
              height: scrollRectsArray[3] / devicePixelRatio,
            };
          }
        }

        // Parse computed styles
        if (layout.styles && layoutIdx < layout.styles.length) {
          const styleIndices = layout.styles[layoutIdx];
          computedStyles = parseComputedStyles(strings, styleIndices);
          cursorStyle = computedStyles['cursor'] || null;
        }

        // Parse paint order
        if (layout.paintOrders && layoutIdx < layout.paintOrders.length) {
          paintOrder = layout.paintOrders[layoutIdx];
        }

        // Parse stacking contexts
        if (layout.stackingContexts) {
          const stackingData = layout.stackingContexts as any;
          if (stackingData.index && stackingData.index.includes(layoutIdx)) {
            const contextIdx = stackingData.index.indexOf(layoutIdx);
            if (stackingData.value && contextIdx < stackingData.value.length) {
              stackingContexts = stackingData.value[contextIdx];
            }
          }
        }
      }

      snapshotLookup.set(backendNodeId, {
        isClickable,
        cursorStyle,
        bounds,
        clientRects,
        scrollRects,
        computedStyles,
        paintOrder,
        stackingContexts,
      });
    }
  }

  return snapshotLookup;
}
