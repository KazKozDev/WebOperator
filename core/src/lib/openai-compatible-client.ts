import { chatOpenAICompatible } from './openai-client';
import type { OllamaChatOptions, OllamaChatResult } from './ollama-client';

const LABEL = 'OpenAI-compatible';

/**
 * Any server that speaks the OpenAI chat-completions dialect: LM Studio, vLLM, llama.cpp,
 * LiteLLM, Together, Groq, Fireworks, a corporate gateway. The base URL is the whole
 * configuration, so a new endpoint costs a paste rather than a new client file.
 */
export async function chatOpenAICompatibleProvider(
  opts: OllamaChatOptions,
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<OllamaChatResult> {
  return chatOpenAICompatible({
    opts,
    apiKey,
    model,
    label: LABEL,
    url: resolveChatCompletionsUrl(baseUrl),
    // Local servers accept unauthenticated requests; a hosted gateway still fails loudly on 401.
    requireApiKey: false,
  });
}

/**
 * People paste whatever their provider's docs printed: the bare host, the `/v1` root, or the
 * full endpoint. Accept all three rather than making the trailing path a support question.
 */
export function resolveChatCompletionsUrl(baseUrl: string): string {
  const raw = baseUrl.trim();
  if (!raw) throw new Error(`${LABEL} base URL is empty`);

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`${LABEL} base URL is not a valid URL: ${raw}`);
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  if (path.endsWith('/chat/completions')) return `${parsed.origin}${path}`;
  if (path === '') return `${parsed.origin}/v1/chat/completions`;
  return `${parsed.origin}${path}/chat/completions`;
}
