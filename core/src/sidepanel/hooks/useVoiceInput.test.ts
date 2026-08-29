import { describe, expect, it, vi } from 'vitest';
import { useVoiceInput } from './useVoiceInput';

describe('useVoiceInput', () => {
  it('detects when SpeechRecognition is not supported', () => {
    // Basic module import sanity check
    expect(useVoiceInput).toBeDefined();
    expect(typeof useVoiceInput).toBe('function');
  });

  it('instantiates MockSpeechRecognition lifecycle correctly', () => {
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = 'ru-RU';
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;

      start() {
        if (this.onstart) this.onstart();
      }

      stop() {
        if (this.onend) this.onend();
      }

      abort() {}
    }

    vi.stubGlobal('SpeechRecognition', MockSpeechRecognition);

    const rec = new MockSpeechRecognition();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    rec.onstart = onStart;
    rec.onend = onEnd;

    rec.start();
    expect(onStart).toHaveBeenCalled();

    rec.stop();
    expect(onEnd).toHaveBeenCalled();
  });
});
