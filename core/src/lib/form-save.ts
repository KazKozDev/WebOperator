import type { A11yNode, A11ySnapshot } from './types';

const saveLabel = /^(?:save|submit|guardar|enviar|enregistrer|salvar|сохранить|отправить)(?:$|[\s…!.])/iu;
// Create flows often confirm with "Request created" or "Заявка создана" on a new URL.
// Verbs other than saved/submitted need a record noun, so a bare "Sent" folder heading does not count.
const saved = /^(?:(?:(?:all |your )?(?:changes|draft|record|form|settings|profile|item) (?:have been |has been |was |is )?)?(?:successfully )?(?:saved|submitted)(?: successfully)?|(?:your )?(?:request|ticket|order|application|message|entry|record|item) (?:(?:#|№) ?[\w-]+ )?(?:have been |has been |was |is )?(?:successfully )?(?:created|received|sent|submitted|accepted)(?: successfully)?|(?:все изменения |изменения |черновик )?сохранен[оы]?|(?:ваш[аеи]? )?(?:заявка|запись|заказ|сообщение|обращение) (?:(?:#|№) ?[\w-]+ )?(?:успешно )?(?:создан|отправлен|принят|сохранен)[аоы]?|(?:cambios )?guardad[oa]s?)[!. ]*$/iu;
const rejected = /(?:could(?:n't| not) (?:be )?save|failed to save|not saved|save failed|could not submit|не удалось сохран|не сохранен|no se (?:pudo|ha podido) guardar)/iu;

export function isSaveNotice(text: string): boolean {
  return saved.test(text.trim().replaceAll('ё', 'е')) || rejected.test(text);
}

export function hasAutosaveHint(hint?: string): boolean {
  return /auto[ -]?save|automatically saved|saved automatically|автосохран/iu.test(hint ?? '');
}

export function isSaveLabel(label: string): boolean {
  return saveLabel.test(label.trim());
}

export function isFormSave(before: A11ySnapshot, name: string, args: Record<string, unknown>): boolean {
  const target = args.ref ? before.nodes.find(n => n.ref === args.ref) : before.nodes.find(n => n.state?.includes('focused'));
  if (!target) return false;
  if (name === 'type' && hasAutosaveHint(target.field?.hint)) return true;
  const saveButton = target.role === 'button' && isSaveLabel(target.name) &&
    (Boolean(target.formRef) || before.nodes.some(n => n.role === 'textbox' && n.frameId === target.frameId));
  if (name === 'click') return saveButton;
  const enter = name === 'press' && String(args.key).toLowerCase() === 'enter';
  if (!enter && !(name === 'type' && String(args.submit) === 'true')) return false;
  if (enter && target.state?.includes('multiline') && !args.modifiers) return false;
  if (target.role === 'button') return saveButton;
  return Boolean(target.formRef && before.nodes.some(n => n.formRef === target.formRef && n.role === 'button' && isSaveLabel(n.name)));
}

export function saveOutcome(before: A11ySnapshot, after: A11ySnapshot, ref: unknown) {
  const target = before.nodes.find(n => ref ? n.ref === ref : n.state?.includes('focused'));
  const relevant = (n: A11yNode) => (n.frameId ?? 0) === (target?.frameId ?? 0) &&
    (!n.formRef || n.formRef === target?.formRef);
  const fieldError = after.nodes.find(n => relevant(n) && n.field?.error && (n.ref === target?.ref ||
    (target?.formRef && n.formRef === target.formRef) ||
    !before.nodes.some(old => old.ref === n.ref && old.field?.error === n.field?.error)));
  if (fieldError) return { status: 'rejected' as const, message: fieldError.field!.error! };
  const notices = (s: A11ySnapshot) => s.nodes.filter(n => relevant(n) && ['status', 'alert', 'heading'].includes(n.role)).map(n => n.text || n.name);
  const previous = new Set([...notices(before), ...(before.textSnippets ?? [])]);
  const fresh = notices(after).filter(t => !previous.has(t));
  // Unscoped page prose may mention other forms. Use only whole, fresh
  // confirmation messages when the target frame has a single form context.
  if (!(target?.frameId) && (after.frameCount ?? 1) === 1 && new Set(before.nodes.map(n => n.formRef).filter(Boolean)).size <= 1) {
    fresh.push(...(after.textSnippets ?? []).filter(t => !previous.has(t)));
  }
  const formAlert = after.nodes.find(n => n.role === 'alert' && relevant(n) && target?.formRef && n.formRef === target.formRef &&
    !previous.has(n.text || n.name) && !isSaveNotice(n.text || n.name) && (n.text || n.name));
  const error = fresh.find(t => rejected.test(t)) ?? (formAlert?.text || formAlert?.name);
  if (error) return { status: 'rejected' as const, message: error };
  if (fresh.some(t => saved.test(t.trim().replaceAll('ё', 'е')))) return { status: 'saved' as const };
  return { status: 'unconfirmed' as const };
}

// A value in the original editor is only a draft. A fresh document at the
// same record URL can confirm it when each identifiable field matches.
export function matchesReopenedForm(before: A11ySnapshot, after: A11ySnapshot, args: Record<string, unknown>, leftRecord = false): boolean {
  if (before.url !== after.url) return false;
  const reloaded = before.documentStart && after.documentStart && before.documentStart !== after.documentStart;
  if (!reloaded && !leftRecord) return false;
  const target = before.nodes.find(n => args.ref ? n.ref === args.ref : n.state?.includes('focused'));
  if (!target?.formRef || target.frameId) return false;
  const fields = before.nodes.filter(n => n.formRef === target.formRef && ['textbox', 'combobox', 'searchbox'].includes(n.role));
  if (!fields.length || fields.some(n => !n.name || n.value === '••••••')) return false;
  return fields.every(n => {
    const matches = after.nodes.filter(candidate => candidate.name === n.name && candidate.role === n.role && !candidate.frameId);
    const expected = n.ref === target.ref && typeof args.text === 'string'
      ? (args.mode === 'append' ? n.value ?? '' : '') + args.text
      : n.value ?? '';
    return matches.length === 1 && !matches[0].field?.error && (matches[0].value ?? '') === expected;
  });
}
