/**
 * Paint Order Filtering
 * Based on browser-use's paint_order.py
 * Removes elements that are fully covered by other elements based on paint order
 */

import { SimplifiedNode } from '../views';

/**
 * Closed axis-aligned rectangle with (x1,y1) bottom-left, (x2,y2) top-right
 */
class Rect {
  constructor(
    public readonly x1: number,
    public readonly y1: number,
    public readonly x2: number,
    public readonly y2: number
  ) {
    if (!(x1 <= x2 && y1 <= y2)) {
      throw new Error('Invalid rectangle coordinates');
    }
  }

  area(): number {
    return (this.x2 - this.x1) * (this.y2 - this.y1);
  }

  intersects(other: Rect): boolean {
    return !(
      this.x2 <= other.x1 ||
      other.x2 <= this.x1 ||
      this.y2 <= other.y1 ||
      other.y2 <= this.y1
    );
  }

  contains(other: Rect): boolean {
    return (
      this.x1 <= other.x1 &&
      this.y1 <= other.y1 &&
      this.x2 >= other.x2 &&
      this.y2 >= other.y2
    );
  }
}

/**
 * Maintains a disjoint set of rectangles
 * No external dependencies - fine for a few thousand rectangles
 */
class RectUnionPure {
  private rects: Rect[] = [];

  /**
   * Return list of up to 4 rectangles = a \ b
   * Assumes a intersects b
   */
  private splitDiff(a: Rect, b: Rect): Rect[] {
    const parts: Rect[] = [];

    // Bottom slice
    if (a.y1 < b.y1) {
      parts.push(new Rect(a.x1, a.y1, a.x2, b.y1));
    }
    // Top slice
    if (b.y2 < a.y2) {
      parts.push(new Rect(a.x1, b.y2, a.x2, a.y2));
    }

    // Middle (vertical) strip: y overlap is [max(a.y1,b.y1), min(a.y2,b.y2)]
    const yLo = Math.max(a.y1, b.y1);
    const yHi = Math.min(a.y2, b.y2);

    // Left slice
    if (a.x1 < b.x1) {
      parts.push(new Rect(a.x1, yLo, b.x1, yHi));
    }
    // Right slice
    if (b.x2 < a.x2) {
      parts.push(new Rect(b.x2, yLo, a.x2, yHi));
    }

    return parts;
  }

  /**
   * True iff r is fully covered by the current union
   */
  contains(r: Rect): boolean {
    if (this.rects.length === 0) {
      return false;
    }

    let stack = [r];
    for (const s of this.rects) {
      const newStack: Rect[] = [];
      for (const piece of stack) {
        if (s.contains(piece)) {
          // piece completely gone
          continue;
        }
        if (piece.intersects(s)) {
          newStack.push(...this.splitDiff(piece, s));
        } else {
          newStack.push(piece);
        }
      }
      if (newStack.length === 0) {
        // everything eaten – covered
        return true;
      }
      stack = newStack;
    }
    return false; // something survived
  }

  /**
   * Insert r unless it is already covered
   * Returns True if the union grew
   */
  add(r: Rect): boolean {
    if (this.contains(r)) {
      return false;
    }

    let pending = [r];
    let i = 0;
    while (i < this.rects.length) {
      const s = this.rects[i];
      const newPending: Rect[] = [];
      let changed = false;
      for (const piece of pending) {
        if (piece.intersects(s)) {
          newPending.push(...this.splitDiff(piece, s));
          changed = true;
        } else {
          newPending.push(piece);
        }
      }
      pending = newPending;
      i++;
    }

    // Any left-over pieces are new, non-overlapping areas
    this.rects.push(...pending);
    return true;
  }
}

/**
 * Calculates which elements should be removed based on the paint order parameter
 */
export class PaintOrderRemover {
  constructor(private root: SimplifiedNode) {}

  /**
   * Calculate paint order and mark elements that are fully covered
   */
  calculatePaintOrder(): void {
    const allSimplifiedNodesWithPaintOrder: SimplifiedNode[] = [];

    // Collect all nodes with paint order
    const collectPaintOrder = (node: SimplifiedNode): void => {
      if (
        node.originalNode.snapshotNode &&
        node.originalNode.snapshotNode.paintOrder !== null &&
        node.originalNode.snapshotNode.bounds !== null
      ) {
        allSimplifiedNodesWithPaintOrder.push(node);
      }

      for (const child of node.children) {
        collectPaintOrder(child);
      }
    };

    collectPaintOrder(this.root);

    // Group by paint order
    const groupedByPaintOrder = new Map<number, SimplifiedNode[]>();
    for (const node of allSimplifiedNodesWithPaintOrder) {
      if (node.originalNode.snapshotNode && node.originalNode.snapshotNode.paintOrder !== null) {
        const paintOrder = node.originalNode.snapshotNode.paintOrder;
        if (!groupedByPaintOrder.has(paintOrder)) {
          groupedByPaintOrder.set(paintOrder, []);
        }
        groupedByPaintOrder.get(paintOrder)!.push(node);
      }
    }

    const rectUnion = new RectUnionPure();

    // Process from highest to lowest paint order
    const sortedPaintOrders = Array.from(groupedByPaintOrder.entries()).sort((a, b) => b[0] - a[0]);

    for (const [paintOrder, nodes] of sortedPaintOrders) {
      const rectsToAdd: Rect[] = [];

      for (const node of nodes) {
        if (!node.originalNode.snapshotNode || !node.originalNode.snapshotNode.bounds) {
          continue;
        }

        const bounds = node.originalNode.snapshotNode.bounds;
        const rect = new Rect(
          bounds.x,
          bounds.y,
          bounds.x + bounds.width,
          bounds.y + bounds.height
        );

        if (rectUnion.contains(rect)) {
          node.ignoredByPaintOrder = true;
        }

        // Don't add to the nodes if opacity is less than 0.8 or background-color is transparent
        if (node.originalNode.snapshotNode.computedStyles) {
          const backgroundColor = node.originalNode.snapshotNode.computedStyles['background-color'] || 'rgba(0, 0, 0, 0)';
          const opacity = parseFloat(node.originalNode.snapshotNode.computedStyles['opacity'] || '1');

          if (backgroundColor === 'rgba(0, 0, 0, 0)' || opacity < 0.8) {
            continue;
          }
        }

        rectsToAdd.push(rect);
      }

      for (const rect of rectsToAdd) {
        rectUnion.add(rect);
      }
    }
  }
}
