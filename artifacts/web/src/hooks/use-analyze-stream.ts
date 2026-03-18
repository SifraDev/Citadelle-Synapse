import { useState, useCallback } from "react";
import type { AnalyzeDocumentsBodyMode } from "@workspace/api-client-react";

interface UseAnalyzeStreamProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export function useAnalyzeStream({ onSuccess, onError }: UseAnalyzeStreamProps = {}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState("");
  const [isPurged, setIsPurged] = useState(false);

  const analyze = useCallback(async (files: File[], mode: AnalyzeDocumentsBodyMode, customQuery?: string) => {
    setIsAnalyzing(true);
    setResult("");
    setIsPurged(false);

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("mode", mode);
      if (customQuery) {
        formData.append("customQuery", customQuery);
      }

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Analysis failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Stream not available");

      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // Parse basic SSE format if present, otherwise just append raw chunk
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              // Try to parse JSON if the chunk is JSON formatted
              const parsed = JSON.parse(data);
              setResult((prev) => prev + (parsed.text || parsed.content || ""));
            } catch {
              // If not JSON, just append the raw text safely
              // Handle escaped newlines properly
              setResult((prev) => prev + data.replace(/\\n/g, '\n'));
            }
          } else if (line.trim() !== "") {
            // Raw text fallback
            setResult((prev) => prev + line.replace(/\\n/g, '\n'));
          }
        }
      }

      setIsPurged(true);
      onSuccess?.();
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
  }, []);

  return { analyze, isAnalyzing, result, isPurged, reset };
}
