import { Sidebar } from "./Sidebar";
import { useActivityStream } from "@/hooks/use-activity-stream";

export function Layout({ children }: { children: React.ReactNode }) {
  // Initialize global SSE listeners
  useActivityStream();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto relative">
        {/* Subtle background glow effect */}
        <div className="absolute top-0 right-0 -mr-[20%] -mt-[10%] h-[50%] w-[50%] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
        
        <div className="h-full w-full p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
