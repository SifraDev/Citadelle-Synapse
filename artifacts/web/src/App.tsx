import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/layout/Layout";
import Vault from "@/pages/Vault";
import Scheduler from "@/pages/Scheduler";
import Activity from "@/pages/Activity";
import Payments from "@/pages/Payments";
import Pay from "@/pages/Pay";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/pay/:chargeId">
        {(params) => <Pay params={params} />}
      </Route>
      <Route path="*">
        <Layout>
          <Switch>
            <Route path="/" component={Vault} />
            <Route path="/tasks" component={Scheduler} />
            <Route path="/activity" component={Activity} />
            <Route path="/payments" component={Payments} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
