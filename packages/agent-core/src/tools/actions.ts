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

// Click element by CSS/XPath/text selector (stable selector usage)
export class ClickSelectorAction implements BaseActionParams {
  selector!: string; // CSS or XPath selector; if starts with // treated as XPath
  nth?: number; // optional: nth match (0-based). Defaults to first
}

export class ClickTextAction implements BaseActionParams {
  text!: string;
  exact?: boolean = false;
}

export class InputTextAction implements BaseActionParams {
  index!: number;
  text!: string;
  clear?: boolean = true;
  submit?: boolean = false; // optional: press Enter after typing
}

// Input text by CSS/XPath selector
export class InputSelectorAction implements BaseActionParams {
  selector!: string;
  text!: string;
  clear?: boolean = true;
  submit?: boolean = false;
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

export class WaitForSelectorAction implements BaseActionParams {
  selector!: string;
  timeoutMs?: number = 5000;
  state?: 'visible' | 'attached' | 'detached' | 'hidden' = 'visible';
}

export class AssertUrlContainsAction implements BaseActionParams {
  includes!: string | string[]; // substring or list of substrings that must appear in current URL
  timeoutMs?: number = 3000; // optional wait for navigation/state changes
}

// ============================================================================
// Content / Page Actions (reference parity)
// ============================================================================

export class ScreenshotAction implements BaseActionParams {
  note?: string; // optional message to annotate
}

export class EvaluateAction implements BaseActionParams {
  code!: string; // JavaScript string to evaluate in the page context
}

export class ExtractAction implements BaseActionParams {
  query?: string; // optional: guidance text (not strictly used)
  extract_links?: boolean = false;
  start_from_char?: number = 0;
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

// Select <select> option by selector
export class SelectDropdownBySelectorAction implements BaseActionParams {
  selector!: string; // CSS/XPath selector targeting a <select>
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

export class DoneStructuredAction implements BaseActionParams {
  data!: any; // arbitrary JSON-like object
  success?: boolean = true;
  text?: string; // optional human summary
}

// ============================================================================
// Union type for all actions
// ============================================================================

export type BrowserActionParams =
  | SearchAction
  | NavigateAction
  | ClickElementAction
  | ClickSelectorAction
  | ClickTextAction
  | InputTextAction
  | InputSelectorAction
  | ScrollAction
  | SendKeysAction
  | ScrollToTextAction
  | WaitForSelectorAction
  | AssertUrlContainsAction
  | ScreenshotAction
  | EvaluateAction
  | ExtractAction
  | GoBackAction
  | WaitAction
  | SelectDropdownAction
  | SelectDropdownBySelectorAction
  | GetDropdownOptionsAction
  | UploadFileAction
  | SwitchTabAction
  | CloseTabAction
  | DoneAction
  | DoneStructuredAction
  | ReadFileAction
  | WriteFileAction
  | ReplaceFileAction;

// File actions
export class WriteFileAction implements BaseActionParams {
  filePath!: string;
  content!: string;
  append?: boolean = false;
  trailingNewline?: boolean = true;
  leadingNewline?: boolean = false;
}

export class ReadFileAction implements BaseActionParams {
  filePath!: string;
}

export class ReplaceFileAction implements BaseActionParams {
  filePath!: string;
  oldStr!: string;
  newStr!: string;
}
