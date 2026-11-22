import { useState } from 'react';
import type { PromptRefinementResult } from '@/lib/types';
import { MAX_PROMPT_LENGTH, refinementWarnings } from '@/lib/prompt-refinement';

export function PromptRefinementPreview({ original, result, disabled, onApply, onDiscard }: {
  original: string;
  result: PromptRefinementResult;
  disabled: boolean;
  onApply: (prompt: string) => void;
  onDiscard: () => void;
}) {
  const [prompt, setPrompt] = useState(result.prompt);
  const warnings = refinementWarnings(original, prompt);
  return (
    <section className="prompt-preview" aria-label="Review improved task">
      <label>
        Improved task — edit before applying
        <textarea aria-label="Improved task" value={prompt} maxLength={MAX_PROMPT_LENGTH} onChange={(event) => setPrompt(event.target.value)} disabled={disabled} />
      </label>
      <details><summary>Original task</summary><pre>{original}</pre></details>
      {result.changes.length > 0 && <div><strong>What changed</strong><ul>{result.changes.map((change, index) => <li key={index}>{change}</li>)}</ul></div>}
      {result.questions.length > 0 && <div><strong>Details to clarify</strong><ul>{result.questions.map((question, index) => <li key={index}>{question}</li>)}</ul><p>You can fill these details into the improved task before applying.</p></div>}
      {warnings.length > 0 && <div role="alert"><strong>Check original values</strong><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
      {disabled && <p>The original task changed or is running. Generate a new version before applying.</p>}
      <div className="prompt-preview-actions">
        <button type="button" className="text-btn" onClick={onDiscard}>Discard</button>
        <button type="button" className="text-btn" disabled={disabled || !prompt.trim()} onClick={() => onApply(prompt.trim())}>Apply prompt</button>
      </div>
    </section>
  );
}
