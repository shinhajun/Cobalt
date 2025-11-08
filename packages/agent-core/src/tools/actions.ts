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
  index?: number; // optional: container element index to scroll inside
}

export class SendKeysAction implements BaseActionParams {
  keys!: string;
}

export class ScrollToTextAction implements BaseActionParams {
  text!: string; // visible text to find
  partial?: boolean = true; // partial match by default
}

// ============================================================================
// Navigation Helpers / Utility Actions
// ============================================================================

export class GoBackAction implements BaseActionParams {}

export class WaitAction implements BaseActionParams {
  seconds?: number = 3;
}

export class SelectDropdownAction implements BaseActionParams {
  index!: number;
  option!: string; // visible text or value
}

export class GetDropdownOptionsAction implements BaseActionParams {
  index!: number;
}

export class UploadFileAction implements BaseActionParams {
  index!: number;
  filePath!: string; // absolute or workspace-relative path
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
  | ScrollToTextAction
  | GoBackAction
  | WaitAction
  | SelectDropdownAction
  | GetDropdownOptionsAction
  | UploadFileAction
  | SwitchTabAction
  | CloseTabAction
  | DoneAction;
