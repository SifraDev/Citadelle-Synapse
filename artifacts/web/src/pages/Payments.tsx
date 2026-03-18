import { useGetPayments } from "@workspace/api-client-react";
import { format } from "date-fns";
import { truncateAddress } from "@/lib/utils";
import { 
  Wallet, 
  ExternalLink, 
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  XCircle
} from "lucide-react";

export default function Payments() {
  const { data: payments, isLoading } = useGetPayments({ limit: 50 });

  return (
    <div className="h-full flex flex-col gap-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <header>
        <h1 className="text-3xl font-display text-foreground flex items-center gap-3">
          <Wallet className="w-8 h-8 text-primary" />
          Crypto Payments
        </h1>
        <p className="text-muted-foreground mt-1">Ethereum ecosystem transaction logs synced via Telegram Bot.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-2">
        <div className="bg-card rounded-xl border border-border p-5 shadow-lg">
          <p className="text-sm text-muted-foreground font-medium mb-1">Total Volume (Session)</p>
          <p className="text-3xl font-display text-foreground">
            {payments?.reduce((acc, p) => p.status === 'confirmed' ? acc + parseFloat(p.amount) : acc, 0).toFixed(4) || "0.0000"} 
            <span className="text-lg text-primary ml-2">ETH</span>
          </p>
        </div>
        <div className="bg-card rounded-xl border border-border p-5 shadow-lg">
          <p className="text-sm text-muted-foreground font-medium mb-1">Confirmed Tx</p>
          <p className="text-3xl font-display text-foreground">
            {payments?.filter(p => p.status === 'confirmed').length || 0}
          </p>
        </div>
        <div className="bg-card rounded-xl border border-border p-5 shadow-lg">
          <p className="text-sm text-muted-foreground font-medium mb-1">Pending Tx</p>
          <p className="text-3xl font-display text-foreground">
            {payments?.filter(p => p.status === 'pending').length || 0}
          </p>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-xl shadow-black/20 overflow-hidden flex-1 flex flex-col">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">Syncing ledger...</div>
        ) : !payments || payments.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4 border border-border">
              <ArrowRightLeft className="w-8 h-8 opacity-50" />
            </div>
            <p className="text-lg font-medium text-foreground">No transactions found</p>
            <p className="text-sm max-w-sm mt-2">Payments received by the Telegram bot will appear here automatically.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-secondary/50 text-muted-foreground uppercase tracking-wider text-[11px] font-semibold">
                <tr>
                  <th className="px-6 py-4 rounded-tl-2xl">Time</th>
                  <th className="px-6 py-4">Transaction</th>
                  <th className="px-6 py-4">From → To</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4 text-right rounded-tr-2xl">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-secondary/20 transition-colors group">
                    <td className="px-6 py-4 text-muted-foreground font-mono">
                      {format(new Date(payment.timestamp), "MMM d, HH:mm")}
                    </td>
                    <td className="px-6 py-4">
                      {payment.txHash ? (
                        <a 
                          href={`https://etherscan.io/tx/${payment.txHash}`} 
                          target="_blank" 
                          rel="noreferrer"
                          className="flex items-center gap-1.5 text-primary hover:underline font-mono"
                        >
                          {truncateAddress(payment.txHash)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground italic">N/A</span>
                      )}
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{payment.network || 'Ethereum'}</div>
                    </td>
                    <td className="px-6 py-4 font-mono text-muted-foreground flex items-center gap-2">
                      <span className="bg-secondary px-2 py-0.5 rounded text-foreground">{truncateAddress(payment.from || '')}</span>
                      <ArrowRightLeft className="w-3 h-3 opacity-50" />
                      <span className="bg-secondary px-2 py-0.5 rounded text-foreground">{truncateAddress(payment.to || '')}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-foreground flex items-center gap-1.5">
                        {payment.amount}
                        <span className="text-xs bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded uppercase">
                          {payment.token}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border
                        ${payment.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 
                          payment.status === 'pending' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 
                          'bg-destructive/10 text-destructive border-destructive/20'}
                      `}>
                        {payment.status === 'confirmed' && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {payment.status === 'pending' && <Clock className="w-3.5 h-3.5" />}
                        {payment.status === 'failed' && <XCircle className="w-3.5 h-3.5" />}
                        {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
