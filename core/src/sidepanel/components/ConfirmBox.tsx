import type { AgentStep, AgentTask } from '@/lib/types';

export function ConfirmBox({ task, onDecide }: { task: AgentTask; onDecide: (allow: boolean) => void }) {
  const step = task.steps[task.steps.length - 1];
  const call = step?.toolCall;
  const summary = describeToolCall(call);

  return (
    <div className="confirm-box">
      <strong>Confirmation required</strong>
      <div className="confirm-summary">{summary}</div>
      {call && (
        <details className="confirm-details">
          <summary>Show technical details</summary>
          <code>{call.name} {JSON.stringify(call.arguments)}</code>
        </details>
      )}
      <div className="controls">
        <button onClick={() => onDecide(true)}>Allow</button>
        <button className="danger" onClick={() => onDecide(false)}>Cancel</button>
      </div>
    </div>
  );
}

export function describeToolCall(call: AgentStep['toolCall'] | undefined): string {
  if (!call) return 'The agent is waiting for your approval to continue.';
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const reason = typeof args.reason === 'string' ? args.reason : '';
  switch (call.name) {
    case 'set_task_plan':
      return `Set the visible task plan${reason ? ` — ${reason}` : ''}.`;
    case 'click': {
      const label = typeof args.label === 'string' ? args.label : (typeof args.ref === 'string' ? args.ref : 'an element');
      return `Click ${label}${reason ? ` — ${reason}` : ''}.`;
    }
    case 'type': {
      const text = typeof args.text === 'string' ? args.text : '';
      const masked = text.length > 20 ? `${text.slice(0, 17)}...` : text;
      return `Type "${masked}" into ${typeof args.ref === 'string' ? args.ref : 'the field'}${reason ? ` — ${reason}` : ''}.`;
    }
    case 'press': {
      const key = typeof args.key === 'string' ? args.key : 'key';
      const mods = typeof args.modifiers === 'string' ? ` (${args.modifiers})` : '';
      return `Press ${key}${mods}${reason ? ` — ${reason}` : ''}.`;
    }
    case 'select': {
      const value = typeof args.value === 'string' ? args.value : 'option';
      return `Select "${value}" in ${typeof args.ref === 'string' ? args.ref : 'the dropdown'}.`;
    }
    case 'scroll': {
      const dir = typeof args.direction === 'string' ? args.direction : 'down';
      return `Scroll ${dir}.`;
    }
    case 'navigate': {
      const url = typeof args.url === 'string' ? args.url : 'page';
      return `Navigate to ${url}.`;
    }
    case 'wait': {
      const ms = typeof args.ms === 'number' ? args.ms : 1000;
      return `Wait for ${ms}ms${typeof args.until === 'string' ? ` until ${args.until}` : ''}.`;
    }
    case 'extract':
      return `Extract data from the page${reason ? ` — ${reason}` : ''}.`;
    case 'done':
      return 'Finish the task and return the final answer.';
    case 'open_tab': {
      const url = typeof args.url === 'string' ? args.url : 'new tab';
      return `Open a new tab at ${url}${reason ? ` — ${reason}` : ''}.`;
    }
    case 'switch_tab': {
      const tabId = typeof args.tabId === 'number' ? args.tabId : 'target tab';
      return `Switch to tab #${tabId}${reason ? ` — ${reason}` : ''}.`;
    }
    case 'list_tabs':
      return 'Inspect open browser tabs.';
    case 'close_tabs': {
      const ids = Array.isArray(args.tabIds) ? args.tabIds.join(', ') : 'selected tabs';
      return `Close tabs [${ids}]${reason ? ` — ${reason}` : ''}.`;
    }
    case 'bookmark_tabs': {
      const folder = typeof args.folderTitle === 'string' ? ` in folder "${args.folderTitle}"` : '';
      return `Bookmark current tabs${folder}.`;
    }
    case 'group_tabs': {
      const title = typeof args.title === 'string' ? ` "${args.title}"` : '';
      return `Create tab group${title}.`;
    }
    case 'ungroup_tabs':
      return 'Ungroup selected tabs.';
    case 'paste_table':
      return `Paste table data into active sheet/editor${reason ? ` — ${reason}` : ''}.`;
    case 'fill_cells':
      return `Fill spreadsheet cells starting at ${typeof args.startCell === 'string' ? args.startCell : 'A1'}${reason ? ` — ${reason}` : ''}.`;
    case 'select_cell':
      return `Select spreadsheet cell ${typeof args.cell === 'string' ? args.cell : ''}${reason ? ` — ${reason}` : ''}.`;
    case 'set_cell':
      return `Set cell ${typeof args.cell === 'string' ? args.cell : ''} = ${typeof args.value === 'string' ? args.value : ''}${reason ? ` — ${reason}` : ''}.`;
    case 'read_cells':
      return `Read spreadsheet range ${typeof args.range === 'string' ? args.range : ''}${reason ? ` — ${reason}` : ''}.`;
    case 'define_sheet_contract': {
      const rows = typeof args.rows === 'number' ? args.rows : 0;
      const cols = Array.isArray(args.columns) ? args.columns.join(', ') : '';
      return `Define sheet contract (${rows} rows: ${cols}).`;
    }
    case 'fill_login_credentials':
      return `Fill saved login credentials into the page${reason ? ` — ${reason}` : ''}.`;
    default:
      return `Run ${call.name}${reason ? ` — ${reason}` : ''}.`;
  }
}
