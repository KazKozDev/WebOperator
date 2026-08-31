import type { A11ySnapshot, ActionResult, RetryStrategy, VerificationResult } from './types';
import { parseBatchActions } from './batch-actions';
import { summarizeExtraction } from './extraction';
import { assessPageHealth } from './page-state';

const ERROR_PATTERNS = [
  'error', 'ошибка', 'fehler', 'erro',
  'not found', 'не найдено', 'page not found', '404',
  'access denied', 'доступ запрещён', 'forbidden', '403',
  'captcha', 'капча', 'verify you are human',
  'something went wrong', 'что-то пошло не так',
  'please try again', 'попробуйте снова',
  'blocked', 'заблокирован',
  'too many requests', 'слишком много запросов', '429',
];

const POPUP_PATTERNS = [
  'cookie', 'cookies', 'куки',
  'gdpr', 'privacy', 'конфиденциальн',
  'newsletter', 'рассылка',
  'not now', 'maybe later', 'отклонить',
  'оповещения', 'уведомления', 'notifications',
  'block content', 'ad block',
  'subscribe to', 'подписаться на',
];

const POPUP_ROLES = new Set(['dialog', 'alertdialog', 'alert', 'modal']);

// Roles whose text is semantically a notice/error message — safe to match
// error patterns against even when the text is not new.
const ALERT_ROLES = new Set(['alert', 'alertdialog', 'status', 'dialog']);

export function verify(
  snapshotBefore: A11ySnapshot,
  snapshotAfter: A11ySnapshot | undefined,
  action: ActionResult,
  toolName: string,
  toolArguments: Record<string, unknown> = {},
): VerificationResult {
  if (!snapshotAfter) {
    return {
      status: 'uncertain',
      domChanged: false,
      urlChanged: false,
      suggestions: ['Could not take verification snapshot — page may have crashed or been closed'],
      recommendedStrategy: 'wait_and_retry',
    };
  }

  if (!action.ok) {
    return verifyFailedAction(snapshotBefore, snapshotAfter, action);
  }

  const domChanged = snapshotBefore.domHash !== snapshotAfter.domHash;
  const urlChanged = snapshotBefore.url !== snapshotAfter.url;

  const errorDetected = detectErrors(snapshotAfter, snapshotBefore);
  const popup = detectPopup(snapshotBefore, snapshotAfter);

  if (errorDetected) {
    return {
      status: 'failed',
      domChanged,
      urlChanged,
      newUrl: urlChanged ? snapshotAfter.url : undefined,
      errorDetected,
      popupDetected: popup.detected,
      popupRefs: popup.refs,
      suggestions: [
        `Page shows error: ${errorDetected}`,
        ...(popup.detected ? [`Pop-up detected (${popup.refs?.join(', ')}) — try closing it first`] : []),
        'Consider refreshing page or trying a different approach',
      ],
      recommendedStrategy: popup.detected ? 'close_popup' : 'try_alternative',
    };
  }

  if (popup.detected && !actionIsPopupDismissal(toolName, snapshotAfter)) {
    // Popup appeared after action but action wasn't targeting it
    return {
      status: 'partial',
      domChanged,
      urlChanged,
      newUrl: urlChanged ? snapshotAfter.url : undefined,
      popupDetected: true,
      popupRefs: popup.refs,
      suggestions: [
        `Popup appeared after action (${popup.refs?.join(', ')})`,
        'Close the popup before continuing with the task',
      ],
      recommendedStrategy: 'close_popup',
    };
  }

  if (toolName === 'extract' || toolName === 'read_cells') {
    // A read-only tool that ran cleanly but brought back nothing is not a step forward. Saying
    // "success" here would advance the plan on an empty result and — because the loop treats a
    // verified step as page progress — reset the loop guard on every repeat.
    const pageIsBlank = assessPageHealth(snapshotAfter).blank;
    const extraction = summarizeExtraction(action.extracted, { pageIsBlank });
    if (!extraction.hasData) {
      return {
        status: 'partial',
        domChanged,
        urlChanged,
        newUrl: urlChanged ? snapshotAfter.url : undefined,
        dataMissing: extraction.reason,
        suggestions: [
          `${toolName} ran but returned no data: ${extraction.reason}`,
          pageIsBlank
            ? `The page at ${snapshotAfter.url} exposes no accessibility nodes — it is an interstitial or is still loading. Repeating ${toolName} cannot help: wait for the real page, or navigate back to the page that held the content.`
            : `Repeating ${toolName} with the same arguments will return the same nothing. Target concrete refs from the snapshot, or reach the content another way.`,
        ],
        recommendedStrategy: pageIsBlank ? 'wait_and_retry' : 'try_alternative',
      };
    }

    return {
      status: 'success',
      domChanged,
      urlChanged,
      newUrl: urlChanged ? snapshotAfter.url : undefined,
      itemsExtracted: extraction.itemCount,
      suggestions: ['Read-only action returned data successfully'],
      recommendedStrategy: 'none',
    };
  }

  if (toolName === 'batch_actions') {
    const actions = parseBatchActions({ name: 'batch_actions', arguments: toolArguments });
    const postconditions = actions.map((child) =>
      verifyToolPostcondition(snapshotBefore, snapshotAfter, child.name, child.arguments),
    );
    const missingRequired = actions.filter(
      (child, index) => (child.name === 'type' || child.name === 'select') && !postconditions[index],
    );
    if (missingRequired.length > 0) {
      return {
        status: 'partial',
        domChanged,
        urlChanged,
        newUrl: urlChanged ? snapshotAfter.url : undefined,
        suggestions: ['Batch ran, but tool-specific verification failed for: ' + missingRequired.map((child) => child.name).join(', ')],
        recommendedStrategy: 'different_selector',
      };
    }
    if (actions.length > 0 && postconditions.every(Boolean)) {
      return {
        status: 'success',
        domChanged,
        urlChanged,
        newUrl: urlChanged ? snapshotAfter.url : undefined,
        suggestions: ['Verified all ' + actions.length + ' batched action postconditions'],
        recommendedStrategy: 'none',
      };
    }
  }

  const postcondition = verifyToolPostcondition(snapshotBefore, snapshotAfter, toolName, toolArguments);
  if (postcondition) {
    return {
      status: 'success',
      domChanged,
      urlChanged,
      newUrl: urlChanged ? snapshotAfter.url : undefined,
      suggestions: [postcondition],
      recommendedStrategy: 'none',
    };
  }

  if (domChanged || urlChanged) {
    const elementAppeared = findNewElement(snapshotBefore, snapshotAfter);
    return {
      status: 'success',
      domChanged,
      urlChanged,
      newUrl: urlChanged ? snapshotAfter.url : undefined,
      elementAppeared,
      suggestions: elementAppeared
        ? [`New element appeared: ${elementAppeared}`]
        : ['Page state changed as expected'],
      recommendedStrategy: 'none',
    };
  }

  // Action succeeded but no observable change
  return {
    status: 'partial',
    domChanged: false,
    urlChanged: false,
    suggestions: [
      'Action reported success but no observable change in page state',
      'Verify manually or try a different selection approach',
    ],
    recommendedStrategy: 'different_selector',
  };
}

function verifyToolPostcondition(
  before: A11ySnapshot,
  after: A11ySnapshot,
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  if (toolName === 'wait') return 'Wait condition completed successfully';
  if (['paste_table', 'fill_cells', 'select_cell', 'set_cell'].includes(toolName)) {
    return 'Spreadsheet action completed its internal verification';
  }

  const ref = typeof args.ref === 'string' ? args.ref : '';
  if (!ref) return undefined;
  const beforeNode = before.nodes.find((node) => node.ref === ref);
  const afterNode = after.nodes.find((node) => node.ref === ref);

  if (toolName === 'type' && afterNode) {
    const expected = String(args.text ?? '');
    const actual = afterNode.value ?? '';
    const mode = String(args.mode ?? 'replace');
    const matches = mode === 'append' ? actual.endsWith(expected) : actual === expected;
    if (matches) return `Input value matches the requested ${mode} operation`;
  }

  if (toolName === 'select' && afterNode) {
    const expected = String(args.value ?? '').trim().toLowerCase();
    const actual = `${afterNode.value ?? ''} ${afterNode.name}`.trim().toLowerCase();
    if (expected && (actual === expected || actual.includes(expected))) {
      return 'Selected value matches the requested option';
    }
  }

  if ((toolName === 'click' || toolName === 'press') && beforeNode && afterNode) {
    const beforeState = JSON.stringify([beforeNode.value ?? '', ...(beforeNode.state ?? [])]);
    const afterState = JSON.stringify([afterNode.value ?? '', ...(afterNode.state ?? [])]);
    if (beforeState !== afterState) return 'Target element state changed as expected';
  }

  return undefined;
}

function verifyFailedAction(
  snapshotBefore: A11ySnapshot,
  snapshotAfter: A11ySnapshot,
  action: ActionResult,
): VerificationResult {
  const domChanged = snapshotBefore.domHash !== snapshotAfter.domHash;
  const urlChanged = snapshotBefore.url !== snapshotAfter.url;
  const errorText = action.error ?? 'Unknown error';
  const popup = detectPopup(snapshotBefore, snapshotAfter);

  const suggestions: string[] = [`Action failed: ${errorText}`];
  let strategy: RetryStrategy;

  if (popup.detected) {
    suggestions.push(`Popup detected (${popup.refs?.join(', ')}) — it may have intercepted the action`);
    strategy = 'close_popup';
  } else if (errorText.includes('not found') || errorText.includes('Element')) {
    suggestions.push('Element may have changed — try a different selector');
    strategy = 'different_selector';
  } else if (errorText.includes('timed out') || errorText.includes('Timeout')) {
    suggestions.push('Page may be slow — wait longer and retry');
    strategy = 'wait_and_retry';
  } else if (errorText.includes('CDP') || errorText.includes('contenteditable')) {
    suggestions.push('DOM action failed, CDP fallback also failed — try coordinates click');
    strategy = 'coordinates_click';
  } else if (domChanged || urlChanged) {
    suggestions.push('Page state changed during action — re-evaluate and retry');
    strategy = 'retry_same';
  } else {
    suggestions.push('Action failed with no DOM change — try alternative approach');
    strategy = 'try_alternative';
  }

  return {
    status: 'failed',
    domChanged,
    urlChanged,
    newUrl: urlChanged ? snapshotAfter.url : undefined,
    errorDetected: errorText,
    popupDetected: popup.detected,
    popupRefs: popup.refs,
    suggestions,
    recommendedStrategy: strategy,
  };
}

// Error patterns are matched only against text that is semantically a notice
// or appeared after the action: the page title, alert/status/dialog nodes,
// new headings, and new text snippets. Text that was already on the page
// before the action (articles, docs mentioning "error" or "blocked") must
// not flag the step as failed.
function detectErrors(snapshotAfter: A11ySnapshot, snapshotBefore: A11ySnapshot): string | undefined {
  const beforeNames = new Set(snapshotBefore.nodes.map((n) => n.name.toLowerCase()));
  const beforeSnippets = new Set((snapshotBefore.textSnippets ?? []).map((t) => t.toLowerCase()));
  const candidates: string[] = [snapshotAfter.title];
  for (const n of snapshotAfter.nodes) {
    if (ALERT_ROLES.has(n.role)) {
      candidates.push(n.name);
    } else if (n.role === 'heading' && !beforeNames.has(n.name.toLowerCase())) {
      candidates.push(n.name);
    }
  }
  for (const t of snapshotAfter.textSnippets ?? []) {
    if (!beforeSnippets.has(t.toLowerCase())) candidates.push(t);
  }
  const noticeText = candidates.join(' | ').toLowerCase();

  for (const pattern of ERROR_PATTERNS) {
    // Multi-word patterns use includes; single words use word boundary
    const rx = pattern.includes(' ')
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      : new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (rx.test(noticeText)) return `detected "${pattern}" on page`;
  }

  // Check for HTTP error codes in title
  const errorCodeMatch = snapshotAfter.title.match(/\b(4\d\d|5\d\d)\b/);
  if (errorCodeMatch) return `HTTP ${errorCodeMatch[0]} error in page title`;

  return undefined;
}

function detectPopup(
  snapshotBefore: A11ySnapshot,
  snapshotAfter: A11ySnapshot,
): { detected: boolean; refs?: string[] } {
  // Check for dialog/modal roles first — those are definitive popups
  const dialogNodes = snapshotAfter.nodes.filter((n) => POPUP_ROLES.has(n.role));
  if (dialogNodes.length > 0) {
    // Only flag if the dialog is new (wasn't there before the action)
    const beforeRoles = new Set(snapshotBefore.nodes.map((n) => n.role));
    const hasNewDialog = dialogNodes.some((n) => !beforeRoles.has(n.role));
    if (hasNewDialog) {
      return { detected: true, refs: dialogNodes.map((n) => n.ref) };
    }
  }

  // Text-based heuristic — only flag genuinely new popup-like elements
  const beforeNames = new Set(snapshotBefore.nodes.map((n) => n.name.toLowerCase()));

  for (const pattern of POPUP_PATTERNS) {
    const candidates = snapshotAfter.nodes.filter(
      (n) =>
        (n.role === 'button' || n.role === 'link' || n.role === 'heading') &&
        n.name.toLowerCase().includes(pattern),
    );
    // Only consider it a popup if the element is genuinely new
    const newCandidates = candidates.filter((n) => !beforeNames.has(n.name.toLowerCase()));
    if (newCandidates.length > 0) {
      return { detected: true, refs: newCandidates.map((n) => n.ref) };
    }
  }

  return { detected: false };
}

function actionIsPopupDismissal(toolName: string, snapshotAfter: A11ySnapshot): boolean {
  if (toolName !== 'click') return false;
  // If any dialog/modal role was removed compared to a typical popup snapshot,
  // this click was likely a dismissal. We check by verifying no dialog roles
  // remain in the snapshot.
  const hasPopupRoles = snapshotAfter.nodes.some((n) => POPUP_ROLES.has(n.role));
  return !hasPopupRoles;
}

function findNewElement(
  snapshotBefore: A11ySnapshot,
  snapshotAfter: A11ySnapshot,
): string | undefined {
  const beforeRefs = new Set(snapshotBefore.nodes.map((n) => n.name.toLowerCase()));
  for (const node of snapshotAfter.nodes) {
    if (!beforeRefs.has(node.name.toLowerCase()) && node.name.length > 2) {
      return node.name;
    }
  }
  return undefined;
}

export function describeVerification(v: VerificationResult): string {
  const parts: string[] = [];
  if (v.status === 'success') {
    parts.push('Verification passed');
    if (v.itemsExtracted !== undefined) parts.push(`${v.itemsExtracted} item(s) extracted`);
    if (v.urlChanged) parts.push('URL changed');
    if (v.elementAppeared) parts.push(`new element: ${v.elementAppeared}`);
  } else if (v.status === 'partial') {
    parts.push(v.dataMissing ? 'Verification partial (no data extracted)' : 'Verification partial (no DOM/URL change)');
  } else if (v.status === 'failed') {
    parts.push('Verification failed');
    if (v.errorDetected) parts.push(`error: ${v.errorDetected}`);
  } else {
    parts.push('Verification uncertain');
  }
  if (v.popupDetected) parts.push('popup detected');
  if (v.suggestions.length > 0) parts.push(`strategy: ${v.recommendedStrategy}`);
  return parts.join(' | ');
}

export function verificationToPrompt(v: VerificationResult): string {
  if (v.status === 'success') return 'Action confirmed — page changed as expected. Continue.';
  if (v.status === 'partial' && v.popupDetected) {
    return `Action completed, but a popup was detected (${v.popupRefs?.join(', ')}). Close the popup before continuing.`;
  }
  if (v.status === 'partial' && v.dataMissing) {
    const lines = ['The action ran, but NO data was extracted — this step did not make progress.'];
    lines.push(...v.suggestions.map((s) => `- ${s}`));
    return lines.join('\n');
  }
  if (v.status === 'partial') {
    const lines = ['Action reported success, but NO observable state or DOM change was detected on the page.'];
    lines.push(...v.suggestions.map((s) => `- ${s}`));
    return lines.join('\n');
  }
  if (v.status === 'failed') {
    const lines = ['Action did not produce the expected result.'];
    lines.push(...v.suggestions.map((s) => `- ${s}`));
    return lines.join('\n');
  }
  return 'Action result unclear. Evaluate the page state and decide what to do next.';
}
