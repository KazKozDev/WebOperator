import type { A11ySnapshot, ActionResult, RetryStrategy, VerificationResult } from './types';

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

export function verify(
  snapshotBefore: A11ySnapshot,
  snapshotAfter: A11ySnapshot | undefined,
  action: ActionResult,
  toolName: string,
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

  const errorDetected = detectErrors(snapshotAfter);
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
    return {
      status: 'success',
      domChanged,
      urlChanged,
      newUrl: urlChanged ? snapshotAfter.url : undefined,
      suggestions: ['Read-only action returned data successfully'],
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

function detectErrors(snapshot: A11ySnapshot): string | undefined {
  const fullText = [
    snapshot.title,
    ...(snapshot.textSnippets ?? []),
    ...snapshot.nodes.map((n) => n.name),
  ].join(' | ').toLowerCase();

  for (const pattern of ERROR_PATTERNS) {
    // Multi-word patterns use includes; single words use word boundary
    const rx = pattern.includes(' ')
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      : new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (rx.test(fullText)) return `detected "${pattern}" on page`;
  }

  // Check for HTTP error codes in title
  const errorCodeMatch = snapshot.title.match(/\b(4\d\d|5\d\d)\b/);
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
    if (v.urlChanged) parts.push('URL changed');
    if (v.elementAppeared) parts.push(`new element: ${v.elementAppeared}`);
  } else if (v.status === 'partial') {
    parts.push('Verification partial (no DOM/URL change)');
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
