/**
 * Action parameter models
 *
 * Based on browser-use's action models
 */

import { BaseActionParams } from './registry.js';

// ============================================================================
// Navigation Actions
// ============================================================================

export class SearchAction implements BaseActionParams {
  query!: string;
  engine: 'duckduckgo' | 'google' | 'bing' = 'google';
}

export class NavigateAction implements BaseActionParams {
  url!: string;
  newTab?: boolean = false;
}

// ============================================================================
// Element Interaction Actions
// ============================================================================

export class ClickElementAction implements BaseActionParams {
  index!: number;
}

export class InputTextAction implements BaseActionParams {
  index!: number;
  text!: string;
  clear?: boolean = true;
}

// ============================================================================
// Page Actions
// ============================================================================

export class ScrollAction implements BaseActionParams {
  down!: boolean;
  pages?: number = 1.0;
}

export class SendKeysAction implements BaseActionParams {
  keys!: string;
}

// ============================================================================
// Tab Management Actions
// ============================================================================

export class SwitchTabAction implements BaseActionParams {
  tabId!: string;
}

export class CloseTabAction implements BaseActionParams {
  tabId!: string;
}

// ============================================================================
// Task Control Actions
// ============================================================================

export class DoneAction implements BaseActionParams {
  text!: string;
  success?: boolean = true;
}

// ============================================================================
// Union type for all actions
// ============================================================================

export type BrowserActionParams =
  | SearchAction
  | NavigateAction
  | ClickElementAction
  | InputTextAction
  | ScrollAction
  | SendKeysAction
  | SwitchTabAction
  | CloseTabAction
  | DoneAction;
