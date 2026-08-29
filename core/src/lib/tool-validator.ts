/**
 * Tool validation and safety policy enforcement.
 * Follows Claude Extension structured tool validation and risk categorization.
 */

import type { ToolCall } from './types';

export type ToolRiskLevel = 'safe' | 'low' | 'high';

export interface ToolValidationResult {
  valid: boolean;
  error?: string;
  sanitizedArgs?: Record<string, unknown>;
  riskLevel: ToolRiskLevel;
  requiresConfirmation?: boolean;
}

const HIGH_RISK_TOOLS = new Set([
  'submit',
  'delete',
  'publish',
  'purchase',
  'payment',
]);

const HIGH_RISK_KEYWORDS = [
  'delete', 'remove', 'destroy', 'publish', 'unpublish', 'buy', 'pay', 'order',
  'send', 'submit', 'удалить', 'купить', 'оплатить', 'опубликовать',
];

/**
 * Validates tool call arguments and determines security risk level.
 */
export function validateAndClassifyToolCall(
  toolCall: ToolCall,
  customConfirmKeywords: string[] = []
): ToolValidationResult {
  const name = toolCall.name?.trim();
  const args = toolCall.arguments ?? {};

  if (!name) {
    return { valid: false, error: 'Tool name is missing', riskLevel: 'safe' };
  }

  // 1. Tool-specific parameter validation
  switch (name) {
    case 'set_task_plan': {
      if (!args.steps || typeof args.steps !== 'string') {
        return { valid: false, error: 'set_task_plan requires a "steps" string', riskLevel: 'safe' };
      }
      return { valid: true, sanitizedArgs: args, riskLevel: 'safe' };
    }

    case 'click': {
      if (!args.ref || typeof args.ref !== 'string') {
        return { valid: false, error: 'click requires a valid "ref" string (e.g. @e1)', riskLevel: 'low' };
      }
      const isRisky = checkTextForRisk(String(args.reason ?? ''), customConfirmKeywords);
      return {
        valid: true,
        sanitizedArgs: args,
        riskLevel: isRisky ? 'high' : 'low',
        requiresConfirmation: isRisky,
      };
    }

    case 'type': {
      if (!args.ref || typeof args.ref !== 'string') {
        return { valid: false, error: 'type requires a valid "ref" string', riskLevel: 'low' };
      }
      if (typeof args.text !== 'string') {
        return { valid: false, error: 'type requires a "text" string', riskLevel: 'low' };
      }
      const isRisky = checkTextForRisk(args.text, customConfirmKeywords);
      return {
        valid: true,
        sanitizedArgs: args,
        riskLevel: isRisky ? 'high' : 'low',
        requiresConfirmation: isRisky,
      };
    }

    case 'navigate': {
      if (!args.url || typeof args.url !== 'string') {
        return { valid: false, error: 'navigate requires a "url" string', riskLevel: 'low' };
      }
      try {
        const parsed = new URL(args.url.startsWith('http') ? args.url : `https://${args.url}`);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return { valid: false, error: 'navigate only supports http and https URLs', riskLevel: 'safe' };
        }
      } catch {
        return { valid: false, error: `Invalid URL format: ${args.url}`, riskLevel: 'safe' };
      }
      return { valid: true, sanitizedArgs: args, riskLevel: 'low' };
    }

    case 'done': {
      return { valid: true, sanitizedArgs: args, riskLevel: 'safe' };
    }

    case 'extract':
    case 'scroll':
    case 'wait':
    case 'screenshot':
    case 'hint':
    case 'inspect':
    case 'press': {
      return { valid: true, sanitizedArgs: args, riskLevel: 'safe' };
    }

    default: {
      if (HIGH_RISK_TOOLS.has(name)) {
        return { valid: true, sanitizedArgs: args, riskLevel: 'high', requiresConfirmation: true };
      }
      return { valid: true, sanitizedArgs: args, riskLevel: 'low' };
    }
  }
}

function checkTextForRisk(text: string, customKeywords: string[]): boolean {
  const lower = text.toLowerCase();
  const allKeywords = [...HIGH_RISK_KEYWORDS, ...customKeywords.map((k) => k.toLowerCase())];
  return allKeywords.some((kw) => kw && lower.includes(kw));
}
