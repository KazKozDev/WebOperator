import { chatOpenAICompatible } from './openai-client';
import type { OllamaChatOptions, OllamaChatResult } from './ollama-client';

const GEMINI_OPENAI_CHAT_COMPLETIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export async function chatGemini(opts: OllamaChatOptions, apiKey: string, model: string): Promise<OllamaChatResult> {
  return chatOpenAICompatible({
    opts,
    apiKey,
    model,
    label: 'Gemini',
    url: GEMINI_OPENAI_CHAT_COMPLETIONS_URL,
  });
}
