import { useGetActivityLogs } from "@workspace/api-client-react";
import type { ActivityEntryType } from "@workspace/api-client-react";
import { format } from "date-fns";
import { 
  Upload, 
  Sparkles, 
  MessageCircle, 
  CreditCard, 
  CalendarClock, 
  Settings,
  TerminalSquare
} from "lucide-react";

const typeConfig: Record<string, { icon: any, color: string, bg: string }> = {
  upload: { icon: Upload, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
  analysis: { icon: Sparkles, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
  telegram: { icon: MessageCircle, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
  payment: { icon: CreditCard, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  task: { icon: CalendarClock, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  system: { icon: Settings, color: "text-slate-400", bg: "bg-slate-500/10 border-slate-500/20" },
};

export default function Activity() {
  // Data is automatically updated by the SSE listener in Layout.tsx via queryClient.setQueryData
  const { data: logs, isLoading } = useGetActivityLogs({ limit: 50 });

  return (
    <div className="h-full flex flex-col gap-6 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <header>
        <h1 className="text-3xl font-display text-foreground flex items-center gap-3">
          <TerminalSquare className="w-8 h-8 text-primary" />
          System Activity
        </h1>
        <p className="text-muted-foreground mt-1">Live, in-memory event stream of all agent operations.</p>
      </header>

      <div className="bg-card rounded-2xl border border-border shadow-xl shadow-black/20 overflow-hidden flex-1 flex flex-col">
        <div className="bg-secondary/30 border-b border-border px-6 py-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Event Timeline</span>
          <span className="flex items-center gap-2 text-xs font-medium text-emerald-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            Live Connection
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <div className="text-center text-muted-foreground mt-10">Loading events...</div>
          ) : !logs || logs.length === 0 ? (
            <div className="text-center text-muted-foreground mt-10">No activity recorded yet in this session.</div>
          ) : (
            <div className="relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
              {logs.map((log) => {
                const config = typeConfig[log.type] || typeConfig.system;
                const Icon = config.icon;
                
                return (
                  <div key={log.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active mb-8">
                    {/* Icon */}
                    <div className={`flex items-center justify-center w-10 h-10 rounded-full border shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 ${config.bg}`}>
                      <Icon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    
                    {/* Card */}
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-border bg-background shadow-md">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-bold uppercase tracking-wider ${config.color}`}>{log.type}</span>
                        <time className="text-xs text-muted-foreground font-mono">
                          {format(new Date(log.timestamp), "HH:mm:ss")}
                        </time>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed mt-2">{log.message}</p>
                      
                      {log.metadata && Object.keys(log.metadata).length > 0 && (
                        <div className="mt-3 p-2 rounded bg-secondary/50 border border-border font-mono text-[10px] text-muted-foreground overflow-x-auto">
                          {JSON.stringify(log.metadata, null, 2)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
