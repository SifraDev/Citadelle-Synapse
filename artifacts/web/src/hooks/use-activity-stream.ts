import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ActivityEntry } from "@workspace/api-client-react";
import { getGetActivityLogsQueryKey } from "@workspace/api-client-react";

export function useActivityStream() {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource("/api/activity/stream");

    es.onopen = () => setIsConnected(true);
    
    es.onerror = () => {
      setIsConnected(false);
      // EventSource auto-reconnects, so we just update status
    };

    es.addEventListener("activity", (event) => {
      try {
        const newEntry = JSON.parse(event.data) as ActivityEntry;
        queryClient.setQueryData<ActivityEntry[]>(
          getGetActivityLogsQueryKey({ limit: 50 }),
          (oldData) => {
            if (!oldData) return [newEntry];
            return [newEntry, ...oldData].slice(0, 50);
          }
        );
      } catch (err) {
        console.error("Failed to parse SSE message", err);
      }
    });

    return () => {
      es.close();
      setIsConnected(false);
    };
  }, [queryClient]);

  return { isConnected };
}
