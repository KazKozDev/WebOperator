import type { A11ySnapshot, CSMessage, CSResponse } from './types';

/**
 * Cross-frame snapshots.
 *
 * The content script runs in every frame, and `chrome.tabs.sendMessage` without a `frameId`
 * delivers to all of them and resolves with whichever replies first — which on a page with
 * hidden service iframes is not the document anyone wants. Every caller therefore names its
 * frame (`sendToContent` defaults to the main document), and a snapshot is taken frame by frame
 * and merged here: the top document keeps plain `@eN` refs, and each child frame gets namespaced
 * `@f<frameId>eN` refs. `frameIdFromRef` reads that prefix back so an action lands in the frame
 * that owns the element.
 *
 * A child frame's bboxes stay in that frame's own coordinate space — nothing here knows where
 * the iframe sits in the parent. Actions are element-based (`data-agent-ref`), so they work
 * regardless; only coordinate consumers (set-of-mark boxes) skip the nodes marked with a frame.
 */

const FRAME_REF = /^@f(\d+)e/;

export function frameIdFromRef(ref: string): number {
  const match = FRAME_REF.exec(ref);
  return match ? Number(match[1]) : 0;
}

export interface FrameSnapshotOptions {
  allElements?: boolean;
  /** Nodes to request per child frame. The top document always gets the full budget. */
  frameMaxNodes?: number;
}

/**
 * Take a snapshot of the top document and merge in every reachable child frame.
 * Frames that do not answer (cross-origin without the script, about:blank, already gone)
 * are skipped — a partial snapshot beats no snapshot.
 */
export async function takeFrameSnapshot(
  tabId: number,
  send: (msg: CSMessage) => Promise<CSResponse>,
  options: FrameSnapshotOptions = {},
): Promise<A11ySnapshot> {
  const top = await send({ kind: 'snapshot:take', options: { allElements: options.allElements } });
  if (top.kind !== 'snapshot') throw new Error('Snapshot failed');

  const childFrames = await listChildFrames(tabId);
  if (childFrames.length === 0) return top.snapshot;

  const merged = top.snapshot;
  for (const frameId of childFrames) {
    try {
      const res = await chrome.tabs.sendMessage(
        tabId,
        {
          kind: 'snapshot:take',
          options: {
            allElements: options.allElements,
            refPrefix: `f${frameId}`,
            maxNodes: options.frameMaxNodes ?? 60,
          },
        } satisfies CSMessage,
        { frameId },
      ) as CSResponse;
      if (res?.kind !== 'snapshot') continue;

      for (const node of res.snapshot.nodes) merged.nodes.push({ ...node, frameId });
      for (const snippet of res.snapshot.textSnippets ?? []) {
        merged.textSnippets = merged.textSnippets ?? [];
        if (!merged.textSnippets.includes(snippet)) merged.textSnippets.push(snippet);
      }
    } catch {
      /* frame unreachable — skip it */
    }
  }
  return merged;
}

/** Frame ids in the tab other than the top document, or [] when they cannot be listed. */
async function listChildFrames(tabId: number): Promise<number[]> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => document.readyState,
    });
    return results
      .map((result) => result.frameId)
      .filter((frameId): frameId is number => typeof frameId === 'number' && frameId !== 0);
  } catch {
    return [];
  }
}
