import type { AgentPlan, PlanStep } from './types';

export function parsePlanSteps(thinkingText: string, goal: string): AgentPlan {
  const steps: PlanStep[] = [];
  const lines = thinkingText.split(/\n/);

  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*]\s*)?(?:\[[ xX]\]\s*)?(?:step\s*)?(\d+)[.):]\s+(.+)/i);
    if (match) {
      steps.push({
        index: parseInt(match[1], 10),
        description: cleanPlanDescription(match[2]),
        status: 'pending',
      });
    }
  }

  if (steps.length === 0) {
    const alt = thinkingText.match(/plan[:\s]*([\s\S]*?)(?:\n\s*\n|$)/i)?.at(1);
    if (alt) {
      const altLines = alt.split(/[\n;]+/).filter(Boolean);
      for (let i = 0; i < altLines.length; i++) {
        const cleaned = cleanPlanDescription(altLines[i].replace(/^\s*(?:[-*]\s*)?(?:\[[ xX]\]\s*)?(?:step\s*)?\d+[.):]\s*/i, ''));
        if (cleaned) {
          steps.push({ index: i + 1, description: cleaned, status: 'pending' });
        }
      }
    }
  }

  return {
    goal,
    steps: steps.map((step, index) => ({
      ...step,
      status: index === 0 ? 'active' : step.status,
    })),
    currentStep: 0,
    createdAt: Date.now(),
  };
}

export function hasStructuredPlan(plan: AgentPlan, _goal: string): boolean {
  return plan.steps.length > 0;
}

export function advancePlan(plan: AgentPlan): AgentPlan {
  if (plan.steps[plan.currentStep]) {
    plan.steps[plan.currentStep].status = 'done';
  }

  const nextIndex = plan.steps.findIndex((step) => step.status === 'pending' || step.status === 'failed');
  if (nextIndex >= 0) {
    plan.currentStep = nextIndex;
    plan.steps[nextIndex].status = 'active';
  }
  return plan;
}

export function completePlan(plan: AgentPlan): AgentPlan {
  for (const step of plan.steps) {
    if (step.status !== 'failed') step.status = 'done';
  }
  plan.currentStep = Math.max(0, plan.steps.length - 1);
  return plan;
}

export function shouldAdvancePlanAfterTool(plan: AgentPlan, toolName: string): boolean {
  const activeStep = plan.steps[plan.currentStep];
  if (!activeStep) return false;

  const text = activeStep.description.toLowerCase();

  if (toolName === 'extract' || toolName === 'read_cells') {
    return hasAny(text, ['extract', 'collect', 'read', 'capture', 'verify', 'check', 'find', 'identify', 'locate', 'получ', 'извлек', 'собер', 'провер', 'найд']);
  }

  if (
    toolName === 'fill_cells' ||
    toolName === 'paste_table' ||
    toolName === 'set_cell' ||
    toolName === 'fill_login_credentials'
  ) {
    return hasAny(text, ['fill', 'write', 'enter', 'paste', 'login', 'sign in', 'заполн', 'введ', 'встав', 'логин', 'войти']);
  }

  if (toolName === 'navigate') {
    return hasAny(text, ['open', 'go', 'navigate', 'visit', 'перей', 'открой', 'зайди']);
  }

  if (toolName === 'click') {
    return hasAny(text, ['click', 'open', 'select', 'choose', 'submit', 'search', 'нажм', 'клик', 'открой', 'выбер', 'поиск']);
  }

  if (toolName === 'type' || toolName === 'press') {
    return hasAny(text, ['type', 'enter', 'submit', 'search', 'fill', 'write', 'введ', 'нажм', 'поиск', 'заполн']);
  }

  return false;
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function cleanPlanDescription(text: string): string {
  return text
    .replace(/\s*[-–—]\s*(?:verify|verification|check|success criteria)\s*:\s*.+$/i, '')
    .trim();
}

export function markPlanStepFailed(plan: AgentPlan, _stepDescription: string): AgentPlan {
  const activeStep = plan.steps.find((s) => s.status === 'active');
  if (activeStep) {
    activeStep.status = 'failed';
  }
  return plan;
}

export function planContext(plan: AgentPlan): string {
  if (plan.steps.length === 0) return '';

  const lines: string[] = ['[PLAN]'];
  for (const step of plan.steps) {
    const marker = step.status === 'done' ? '✓' : step.status === 'active' ? '▶' : step.status === 'failed' ? '✗' : '○';
    lines.push(`  ${marker} ${step.index}. ${step.description}`);
  }

  const remaining = plan.steps.filter((s) => s.status === 'pending' || s.status === 'active');
  if (remaining.length > 0) {
    lines.push(`\nCurrent step: ${remaining[0].description}`);
  }

  return lines.join('\n');
}

export function planSummary(plan: AgentPlan): string {
  const done = plan.steps.filter((s) => s.status === 'done').length;
  const failed = plan.steps.filter((s) => s.status === 'failed').length;
  return `${done}/${plan.steps.length} steps done${failed > 0 ? ` (${failed} failed)` : ''}`;
}
