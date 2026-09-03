import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS, selectAgentTools } from './tools';

function names(goal: string, url = 'https://example.com', firstStep = false): string[] {
  return selectAgentTools({ goal, firstStep, snapshot: { url, nodes: [] } })
    .map((tool) => tool.function.name);
}

describe('selectAgentTools', () => {
  it('offers task attachment upload for application documents', () => {
    expect(names('Upload the CV PDF attachment to this application')).toContain('upload_attachment');
  });
  it('keeps direct web tasks focused on the core palette', () => {
    const selected = names('Click the account button');

    expect(selected).toEqual(expect.arrayContaining(['click', 'type', 'extract', 'done']));
    expect(selected).not.toContain('set_task_plan');
    expect(selected).not.toContain('fill_cells');
    expect(selected.length).toBeLessThan(AGENT_TOOLS.length / 2);
  });

  it('offers planning only before the first action', () => {
    expect(names('Research three sources', 'https://example.com', true)).toContain('set_task_plan');
    expect(names('Research three sources', 'https://example.com', false)).not.toContain('set_task_plan');
  });

  it('adds spreadsheet and tab tools from task context', () => {
    const selected = names('Compare several sites and fill the spreadsheet');

    expect(selected).toEqual(expect.arrayContaining(['open_tab', 'switch_tab', 'fill_cells', 'read_cells']));
  });

  it('adds credential filling when the runtime found a credential', () => {
    const selected = selectAgentTools({ goal: 'Continue', hasCredential: true });

    expect(selected.map((tool) => tool.function.name)).toContain('fill_login_credentials');
  });

  it('offers batch_actions only when the snapshot has multiple safe controls', () => {
    const selected = selectAgentTools({
      goal: 'Fill the profile form',
      snapshot: {
        url: 'https://example.com/profile',
        nodes: [
          { ref: '@e1', role: 'textbox', name: 'First name', bbox: { x: 0, y: 0, w: 10, h: 10 }, inViewport: true },
          { ref: '@e2', role: 'combobox', name: 'Country', bbox: { x: 0, y: 20, w: 10, h: 10 }, inViewport: true },
        ],
      },
    });

    expect(selected.map((tool) => tool.function.name)).toContain('batch_actions');
    expect(names('Fill one field')).not.toContain('batch_actions');
  });

  it('offers solve_captcha when captcha is mentioned or detected', () => {
    expect(names('Solve the captcha and submit')).toContain('solve_captcha');
    expect(names('Реши капчу на странице')).toContain('solve_captcha');
    expect(names('Click the account button')).not.toContain('solve_captcha');
  });
});
