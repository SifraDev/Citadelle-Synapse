import { useState, useCallback } from "react";
import type { AnalyzeDocumentsBodyMode } from "@workspace/api-client-react";

interface UseAnalyzeStreamProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

interface StatusInfo {
  phase: string;
  message: string;
}

function parseSSEMessages(raw: string): Array<{ event: string; data: string }> {
  const results: Array<{ event: string; data: string }> = [];
  const messages = raw.split("\n\n");
  for (const message of messages) {
    if (!message.trim()) continue;
    let eventName = "message";
    let dataStr = "";
    for (const line of message.split("\n")) {
      if (line.startsWith("event: ")) {
        eventName = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        dataStr += line.slice(6);
      }
    }
    if (dataStr) {
      results.push({ event: eventName, data: dataStr });
    }
  }
  return results;
}

export function useAnalyzeStream({ onSuccess, onError }: UseAnalyzeStreamProps = {}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState("");
  const [isPurged, setIsPurged] = useState(false);
  const [status, setStatus] = useState<StatusInfo | null>(null);

  const analyze = useCallback(async (files: File[], mode: AnalyzeDocumentsBodyMode, customQuery?: string) => {
    setIsAnalyzing(true);
    setResult("");
    setIsPurged(false);
    setStatus(null);

    let hadError = false;

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("mode", mode);
      if (customQuery) {
        formData.append("customQuery", customQuery);
      }

      const analyzeUrl = typeof __ANALYZE_PROXY_PATH__ !== "undefined"
        ? __ANALYZE_PROXY_PATH__
        : "/api/analyze";

      const response = await fetch(analyzeUrl, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Analysis failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Stream not available");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lastDoubleNewline = buffer.lastIndexOf("\n\n");
        if (lastDoubleNewline === -1) continue;

        const completePart = buffer.substring(0, lastDoubleNewline + 2);
        buffer = buffer.substring(lastDoubleNewline + 2);

        const messages = parseSSEMessages(completePart);
        for (const msg of messages) {
          try {
            const parsed = JSON.parse(msg.data);

            switch (msg.event) {
              case "chunk":
                if (parsed.content) {
                  setResult((prev) => prev + parsed.content);
                }
                break;
              case "status":
                setStatus({ phase: parsed.phase, message: parsed.message });
                if (parsed.phase === "complete") {
                  setIsPurged(true);
                }
                break;
              case "error":
                hadError = true;
                onError?.(parsed.message || "Analysis error");
                break;
              case "done":
                break;
            }
          } catch {
            // skip malformed JSON
          }
        }
      }

      if (buffer.trim()) {
        const remaining = parseSSEMessages(buffer);
        for (const msg of remaining) {
          try {
            const parsed = JSON.parse(msg.data);
            if (msg.event === "chunk" && parsed.content) {
              setResult((prev) => prev + parsed.content);
            } else if (msg.event === "error") {
              hadError = true;
              onError?.(parsed.message || "Analysis error");
            } else if (msg.event === "status" && parsed.phase === "complete") {
              setIsPurged(true);
            }
          } catch {
            // skip malformed
          }
        }
      }

      if (!hadError) {
        setIsPurged(true);
        onSuccess?.();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unknown error occurred";
      onError?.(msg);
    } finally {
      setIsAnalyzing(false);
    }
  }, [onSuccess, onError]);

  const reset = useCallback(() => {
    setResult("");
    setIsPurged(false);
    setIsAnalyzing(false);
    setStatus(null);
  }, []);

  return { analyze, isAnalyzing, result, isPurged, status, reset };
}
