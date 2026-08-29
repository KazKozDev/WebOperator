import { useEffect, useState } from 'react';
import { AgentPortClient } from '@/lib/port-channel';
import type { SWEvent } from '@/lib/types';

/**
 * React hook connecting the Side Panel UI to the Background Service Worker
 * through a resilient bidirectional Port channel.
 */
export function useAgentPort(
  onEvent: (event: SWEvent) => void,
  tabIdGetter?: () => number | undefined
): { client: AgentPortClient | null } {
  const [client, setClient] = useState<AgentPortClient | null>(null);

  useEffect(() => {
    const portClient = new AgentPortClient(tabIdGetter);
    setClient(portClient);

    const unsubscribe = portClient.subscribe((event) => {
      onEvent(event);
    });

    return () => {
      unsubscribe();
      portClient.dispose();
      setClient(null);
    };
  }, [onEvent, tabIdGetter]);

  return { client };
}
