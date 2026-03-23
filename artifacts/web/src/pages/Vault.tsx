import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { 
  UploadCloud, 
  File, 
  Trash2, 
  Sparkles, 
  ShieldAlert, 
  CheckCircle2, 
  Loader2,
  Lock,
  Info,
  FileDown
} from "lucide-react";
import { useAnalyzeStream } from "@/hooks/use-analyze-stream";
import type { AnalyzeDocumentsBodyMode } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export default function Vault() {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<AnalyzeDocumentsBodyMode>("summarize");
  const [customQuery, setCustomQuery] = useState("");
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const { toast } = useToast();

  const { analyze, isAnalyzing, result, isPurged, status, reset } = useAnalyzeStream({
    onError: (err) => toast({ title: "Analysis Failed", description: err, variant: "destructive" })
  });

  const handleDownloadDraft = useCallback(async () => {
    if (!result) return;
    setIsGeneratingDraft(true);
    try {
      const draftUrl = typeof __DRAFT_PROXY_PATH__ !== "undefined"
        ? __DRAFT_PROXY_PATH__
        : "/api/draft";
      const draftHeaders: Record<string, string> = { "Content-Type": "application/json" };
      const dt = typeof __DASHBOARD_TOKEN__ !== "undefined" ? __DASHBOARD_TOKEN__ : "";
      if (dt) {
        draftHeaders["X-Dashboard-Token"] = dt;
      }
      const response = await fetch(draftUrl, {
        method: "POST",
        headers: draftHeaders,
        body: JSON.stringify({ analysisText: result, mode }),
      });
      if (!response.ok) {
        let errorMsg = "Draft generation failed";
        try {
          const err = await response.json();
          if (err.error) errorMsg = err.error;
        } catch {}
        throw new Error(errorMsg);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `safe-draft-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Safe Draft Downloaded", description: "PII-redacted PDF has been generated and downloaded." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Draft generation failed";
      toast({ title: "Draft Failed", description: msg, variant: "destructive" });
    } finally {
      setIsGeneratingDraft(false);
    }
  }, [result, mode, toast]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(prev => [...prev, ...acceptedFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: { 'application/pdf': ['.pdf'], 'text/plain': ['.txt'] },
    disabled: isAnalyzing
  });

  const handleAnalyze = () => {
    if (files.length === 0) return;
    analyze(files, mode, mode === 'custom' ? customQuery : undefined);
  };

  const handleReset = () => {
    setFiles([]);
    reset();
  };

  return (
    <div className="h-full flex flex-col gap-6 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-display text-foreground">Document Vault</h1>
        <p className="text-muted-foreground mt-1 flex items-center gap-2">
          <Lock className="w-4 h-4" /> Secure, zero-retention live analysis via Venice AI.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="bg-card rounded-2xl border border-border p-5 shadow-lg shadow-black/20 flex flex-col gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Analysis Mode</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'summarize', label: 'Summarize' },
                { id: 'extract_clauses', label: 'Extract Clauses' },
                { id: 'flag_risks', label: 'Flag Risks' },
                { id: 'custom', label: 'Custom Query' }
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id as AnalyzeDocumentsBodyMode)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all duration-200 ${
                    mode === m.id 
                      ? "bg-primary/10 border-primary text-primary shadow-[0_0_10px_rgba(var(--primary),0.1)]" 
                      : "bg-background border-border text-muted-foreground hover:border-muted-foreground/50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            
            <AnimatePresence>
              {mode === 'custom' && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <textarea
                    placeholder="Enter custom prompt for the AI..."
                    value={customQuery}
                    onChange={(e) => setCustomQuery(e.target.value)}
                    className="w-full mt-2 bg-background border border-border rounded-lg p-3 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all resize-none h-24"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div 
            {...getRootProps()} 
            className={`flex-1 min-h-[200px] border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-6 text-center transition-all duration-300 cursor-pointer
              ${isDragActive ? "border-primary bg-primary/5" : "border-border bg-card hover:border-muted-foreground/50"}
              ${isAnalyzing ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}
            `}
          >
            <input {...getInputProps()} />
            <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center mb-4">
              <UploadCloud className={`h-6 w-6 ${isDragActive ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <p className="font-medium text-foreground text-sm">Drag & drop PDFs or TXT files here</p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse files</p>
          </div>

          {files.length > 0 && (
            <div className="bg-card rounded-2xl border border-border p-4 shadow-lg overflow-hidden flex flex-col max-h-[30vh]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Queued Documents ({files.length})</span>
                {!isAnalyzing && (
                  <button onClick={() => setFiles([])} className="text-xs text-destructive hover:text-destructive/80 transition-colors">Clear All</button>
                )}
              </div>
              <div className="overflow-y-auto space-y-2 pr-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 bg-background border border-border p-2.5 rounded-lg">
                    <File className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm text-foreground truncate flex-1">{f.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || files.length === 0}
                className="mt-4 w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:transform-none disabled:shadow-none transition-all duration-200 flex items-center justify-center gap-2"
              >
                {isAnalyzing ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Analyzing Securely...</>
                ) : (
                  <><Sparkles className="h-5 w-5" /> Begin Analysis</>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-8 bg-card rounded-2xl border border-border shadow-xl shadow-black/30 overflow-hidden flex flex-col relative">
          <div className="bg-secondary/50 border-b border-border px-5 py-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Live Analysis Output
            </h2>
            {isPurged && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium">
                <ShieldAlert className="h-3.5 w-3.5" /> Data Purged
              </span>
            )}
          </div>
          
          <div className="flex-1 p-6 overflow-y-auto relative bg-[#0a0f1c] font-mono text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {!result && !isAnalyzing && !isPurged && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center opacity-40">
                <ShieldAlert className="h-12 w-12 mb-3" />
                <p>Awaiting documents for zero-retention analysis.</p>
              </div>
            )}

            {status && isAnalyzing && !result && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 text-primary mb-4"
              >
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>{status.message}</span>
              </motion.div>
            )}
            
            {result && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                className="text-foreground"
              >
                {result}
                {isAnalyzing && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />}
              </motion.div>
            )}

            {isPurged && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 space-y-3"
              >
                {result && (
                  <button
                    onClick={handleDownloadDraft}
                    disabled={isGeneratingDraft}
                    className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:transform-none disabled:shadow-none transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    {isGeneratingDraft ? (
                      <><Loader2 className="h-5 w-5 animate-spin" /> Sanitizing & Generating PDF...</>
                    ) : (
                      <><FileDown className="h-5 w-5" /> Download Safe Draft (PII Redacted)</>
                    )}
                  </button>
                )}
                <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center gap-4 text-emerald-400">
                  <div className="p-2 rounded-full bg-emerald-500/20">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-emerald-300">Analysis Complete</h4>
                    <p className="text-xs mt-0.5 opacity-80">All source documents have been permanently removed from memory.</p>
                  </div>
                  <button 
                    onClick={handleReset}
                    className="ml-auto px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg text-sm font-medium transition-colors border border-emerald-500/20"
                  >
                    Start New
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
