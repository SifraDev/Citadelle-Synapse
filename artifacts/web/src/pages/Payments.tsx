import { useState, useCallback } from "react";
import { useGetPayments, useGetWalletInfo, useListCharges, useCreateCharge, useConfirmPayment } from "@workspace/api-client-react";
import { format } from "date-fns";
import { truncateAddress } from "@/lib/utils";
import {
  Wallet,
  ExternalLink,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  XCircle,
  Plus,
  Copy,
  Loader2,
  Link2,
  DollarSign,
  RefreshCw,
} from "lucide-react";

const BASE_CHAIN_ID = 8453;
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
      isMetaMask?: boolean;
    };
  }
}

function encodeTransferData(to: string, amount: string): string {
  const methodId = "0xa9059cbb";
  const paddedTo = to.slice(2).toLowerCase().padStart(64, "0");
  const rawAmount = BigInt(Math.round(parseFloat(amount) * 10 ** USDC_DECIMALS));
  const paddedAmount = rawAmount.toString(16).padStart(64, "0");
  return methodId + paddedTo + paddedAmount;
}

export default function Payments() {
  const { data: payments, isLoading: loadingPayments, refetch: refetchPayments } = useGetPayments({ limit: 50 }, { query: { refetchInterval: 10000 } });
  const { data: walletInfo, isLoading: loadingWallet, refetch: refetchWallet } = useGetWalletInfo({ query: { refetchInterval: 30000 } });
  const { data: charges, refetch: refetchCharges } = useListCharges({ query: { refetchInterval: 10000 } });
  const { mutateAsync: createCharge, isPending: creatingCharge } = useCreateCharge();
  const { mutateAsync: confirmPayment } = useConfirmPayment();

  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeLabel, setChargeLabel] = useState("");
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [payingChargeId, setPayingChargeId] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      alert("MetaMask not detected. Please install MetaMask to make payments.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (accounts.length > 0) {
        setConnectedAddress(accounts[0]);
        const chainId = await window.ethereum.request({ method: "eth_chainId" }) as string;
        if (parseInt(chainId, 16) !== BASE_CHAIN_ID) {
          try {
            await window.ethereum.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: "0x" + BASE_CHAIN_ID.toString(16) }],
            });
          } catch (switchErr: unknown) {
            if ((switchErr as { code?: number })?.code === 4902) {
              await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [{
                  chainId: "0x" + BASE_CHAIN_ID.toString(16),
                  chainName: "Base",
                  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                  rpcUrls: ["https://mainnet.base.org"],
                  blockExplorerUrls: ["https://basescan.org"],
                }],
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("Wallet connect failed:", err);
    } finally {
      setConnecting(false);
    }
  }, []);

  const payCharge = useCallback(async (chargeId: string, amount: string) => {
    if (!window.ethereum || !connectedAddress) {
      alert("Connect your wallet first.");
      return;
    }
    setPayingChargeId(chargeId);
    setTxStatus("Preparing transaction...");
    try {
      const chainId = await window.ethereum.request({ method: "eth_chainId" }) as string;
      if (parseInt(chainId, 16) !== BASE_CHAIN_ID) {
        setTxStatus("Switching to Base network...");
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x" + BASE_CHAIN_ID.toString(16) }],
        });
      }

      setTxStatus("Sending USDC transfer...");
      const data = encodeTransferData(walletInfo?.address || "", amount);
      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{
          from: connectedAddress,
          to: USDC_CONTRACT,
          data,
          value: "0x0",
        }],
      }) as string;

      setTxStatus("Confirming payment...");
      await confirmPayment({ data: { txHash, chargeId } });
      setTxStatus("Payment confirmed!");
      refetchPayments();
      refetchCharges();
      refetchWallet();
      setTimeout(() => {
        setTxStatus(null);
        setPayingChargeId(null);
      }, 3000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Transaction failed";
      setTxStatus(`Error: ${errorMsg}`);
      setTimeout(() => {
        setTxStatus(null);
        setPayingChargeId(null);
      }, 5000);
    }
  }, [connectedAddress, walletInfo, confirmPayment, refetchPayments, refetchCharges, refetchWallet]);

  const handleCreateCharge = async () => {
    const amount = parseFloat(chargeAmount);
    if (isNaN(amount) || amount <= 0) return;
    await createCharge({ data: { amount, label: chargeLabel || undefined } });
    setChargeAmount("");
    setChargeLabel("");
    refetchCharges();
  };

  const copyAddress = () => {
    if (walletInfo?.address) {
      navigator.clipboard.writeText(walletInfo.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const pendingCharges = charges?.filter(c => c.status === "pending") || [];
  const confirmedTotal = payments?.reduce((acc, p) => p.status === "confirmed" ? acc + parseFloat(p.amount) : acc, 0) || 0;
  const confirmedCount = payments?.filter(p => p.status === "confirmed").length || 0;
  const pendingCount = pendingCharges.length;

  return (
    <div className="h-full flex flex-col gap-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display text-foreground flex items-center gap-3">
            <Wallet className="w-8 h-8 text-primary" />
            USDC Payments
          </h1>
          <p className="text-muted-foreground mt-1">Real USDC payments on Base network via MetaMask.</p>
        </div>
        <div className="flex items-center gap-3">
          {connectedAddress ? (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 px-3 py-1.5 rounded-lg text-sm font-mono">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              {truncateAddress(connectedAddress)}
            </div>
          ) : (
            <button
              onClick={connectWallet}
              disabled={connecting}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
            >
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Connect MetaMask
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-5 shadow-lg">
          <p className="text-sm text-muted-foreground font-medium mb-1">Agent Wallet</p>
          {loadingWallet ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : (
            <div>
              <button onClick={copyAddress} className="flex items-center gap-1.5 text-sm font-mono text-primary hover:underline">
                {truncateAddress(walletInfo?.address || "")}
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <p className="text-xs text-muted-foreground mt-1">Base Network</p>
            </div>
          )}
        </div>
        <div className="bg-card rounded-xl border border-border p-5 shadow-lg">
          <p className="text-sm text-muted-foreground font-medium mb-1">USDC Balance</p>
          <p className="text-2xl font-display text-foreground">
            {loadingWallet ? "..." : parseFloat(walletInfo?.usdcBalance || "0").toFixed(2)}
            <span className="text-sm text-primary ml-2">USDC</span>
          </p>
        </div>
        <div className="bg-card rounded-xl border border-border p-5 shadow-lg">
          <p className="text-sm text-muted-foreground font-medium mb-1">Total Received</p>
          <p className="text-2xl font-display text-foreground">
            {confirmedTotal.toFixed(2)}
            <span className="text-sm text-primary ml-2">USDC</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">{confirmedCount} confirmed tx</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-5 shadow-lg">
          <p className="text-sm text-muted-foreground font-medium mb-1">Pending Charges</p>
          <p className="text-2xl font-display text-amber-500">{pendingCount}</p>
          <p className="text-xs text-muted-foreground mt-1">awaiting payment</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-card rounded-xl border border-border p-5 shadow-lg">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" />
            Create Charge
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Amount (USDC)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
                placeholder="100.00"
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Client Label (optional)</label>
              <input
                type="text"
                value={chargeLabel}
                onChange={(e) => setChargeLabel(e.target.value)}
                placeholder="Acme Corp"
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <button
              onClick={handleCreateCharge}
              disabled={creatingCharge || !chargeAmount || parseFloat(chargeAmount) <= 0}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
            >
              {creatingCharge ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
              Create Charge
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-5 shadow-lg">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" />
            Pending Charges
          </h2>
          {pendingCharges.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">No pending charges. Create one to get started.</p>
          ) : (
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {pendingCharges.map((charge) => (
                <div key={charge.id} className="bg-secondary/50 rounded-lg p-4 border border-border flex items-center justify-between">
                  <div>
                    <p className="text-foreground font-semibold">{charge.amount} USDC</p>
                    {charge.label && <p className="text-sm text-muted-foreground">{charge.label}</p>}
                    <p className="text-xs text-muted-foreground font-mono mt-1">ID: {charge.id.slice(0, 8)}...</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {connectedAddress ? (
                      <button
                        onClick={() => payCharge(charge.id, charge.amount)}
                        disabled={payingChargeId === charge.id}
                        className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-emerald-700 transition disabled:opacity-50"
                      >
                        {payingChargeId === charge.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Wallet className="w-3.5 h-3.5" />
                        )}
                        Pay
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Connect wallet to pay</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {txStatus && (
            <div className={`mt-3 p-3 rounded-lg text-sm ${txStatus.startsWith("Error") ? "bg-destructive/10 text-destructive border border-destructive/20" : txStatus.includes("confirmed") ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-amber-500/10 text-amber-500 border border-amber-500/20"}`}>
              {txStatus}
            </div>
          )}
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-xl shadow-black/20 overflow-hidden flex-1 flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 bg-secondary/30 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Transaction Ledger</h2>
          <button onClick={() => { refetchPayments(); refetchWallet(); }} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
        {loadingPayments ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Syncing ledger...
          </div>
        ) : !payments || payments.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4 border border-border">
              <ArrowRightLeft className="w-8 h-8 opacity-50" />
            </div>
            <p className="text-lg font-medium text-foreground">No transactions yet</p>
            <p className="text-sm max-w-sm mt-2">Create a charge and pay with MetaMask, or send USDC directly to the agent wallet on Base.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-secondary/50 text-muted-foreground uppercase tracking-wider text-[11px] font-semibold">
                <tr>
                  <th className="px-6 py-4">Time</th>
                  <th className="px-6 py-4">Transaction</th>
                  <th className="px-6 py-4">From</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-6 py-4 text-muted-foreground font-mono text-xs">
                      {format(new Date(payment.timestamp), "MMM d, HH:mm:ss")}
                    </td>
                    <td className="px-6 py-4">
                      {payment.txHash ? (
                        <a
                          href={`https://basescan.org/tx/${payment.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 text-primary hover:underline font-mono text-xs"
                        >
                          {truncateAddress(payment.txHash)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground italic text-xs">N/A</span>
                      )}
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{payment.network || "Base"}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="bg-secondary px-2 py-0.5 rounded text-foreground font-mono text-xs">
                        {truncateAddress(payment.from || "")}
                      </span>
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
                        ${payment.status === "confirmed" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                          payment.status === "pending" ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                          "bg-destructive/10 text-destructive border-destructive/20"}
                      `}>
                        {payment.status === "confirmed" && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {payment.status === "pending" && <Clock className="w-3.5 h-3.5" />}
                        {payment.status === "failed" && <XCircle className="w-3.5 h-3.5" />}
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
