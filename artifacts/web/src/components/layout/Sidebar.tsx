import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  Scale, 
  FileText, 
  Calendar, 
  Activity, 
  CreditCard,
  ShieldCheck,
  Bot
} from "lucide-react";
import { useGetTelegramStatus } from "@workspace/api-client-react";

const navigation = [
  { name: "Document Vault", href: "/", icon: FileText },
  { name: "Task Scheduler", href: "/tasks", icon: Calendar },
  { name: "Activity Log", href: "/activity", icon: Activity },
  { name: "Payments", href: "/payments", icon: CreditCard },
];

export function Sidebar() {
  const [location] = useLocation();
  const { data: telegramStatus } = useGetTelegramStatus();

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-sidebar px-4 py-6 shadow-2xl z-10 relative">
      <div className="flex items-center gap-3 px-2 mb-10">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.2)]">
          <Scale className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-lg font-bold text-foreground leading-tight tracking-wide">Citadelle Synapse</h1>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Powered by Venice AI</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5">
        {navigation.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href} className="block">
              <span
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 transition-colors",
                    isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                {item.name}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-4">
        {/* Zero Retention Badge */}
        <div className="rounded-xl border border-primary/10 bg-primary/5 p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-wider">Zero Retention</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Documents are analyzed securely in memory and purged instantly. No data is stored.
          </p>
        </div>

        {/* Telegram Status */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">Telegram Bot</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "relative flex h-2 w-2",
              telegramStatus?.connected ? "text-emerald-500" : "text-destructive"
            )}>
              {telegramStatus?.connected && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                telegramStatus?.connected ? "bg-emerald-500" : "bg-destructive"
              )}></span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
