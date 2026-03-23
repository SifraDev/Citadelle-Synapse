import { useState, useCallback, useRef } from "react";
import { BrowserProvider } from "ethers";
import { useGetCharge, useConfirmPayment } from "@workspace/api-client-react";
import { truncateAddress } from "@/lib/utils";
import { connectWalletRobust, sendUsdcTransfer, getEthereumProvider } from "@/lib/wallet";
import {
  Wallet,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Link2,
  Shield,
  AlertCircle,
  Diamond,
} from "lucide-react";

export default function Pay({ params }: { params: { chargeId: string } }) {
  const chargeId = params.chargeId;
  const { data: charge, isLoading, error } = useGetCharge(chargeId, { query: { retry: false, refetchInterval: 5000 } });
  const { mutateAsync: confirmPayment } = useConfirmPayment();

  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const providerRef = useRef<BrowserProvider | null>(null);

  const connectWallet = useCallback(async () => {
    setWalletError(null);
    if (!getEthereumProvider()) {
      const inIframe = window.self !== window.top;
      if (inIframe) {
        setWalletError("iframe");
      } else {
        setWalletError("no-metamask");
      }
      return;
    }
    setConnecting(true);
    try {
      const { address, provider } = await connectWalletRobust();
      setConnectedAddress(address);
      providerRef.current = provider;
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 4001) {
        setWalletError("Connection rejected. Please approve the MetaMask request to continue.");
      } else {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setWalletError(`Connection failed: ${msg}`);
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  const handlePay = useCallback(async () => {
    if (!connectedAddress || !charge) return;
    if (!providerRef.current) {
      try {
        const { provider } = await connectWalletRobust();
        providerRef.current = provider;
      } catch {
        setTxStatus("Error: Please connect your wallet first.");
        return;
      }
    }
    setTxStatus("Preparing transaction...");
    try {
      setTxStatus("Sending USDC transfer...");
      const hash = await sendUsdcTransfer(
        providerRef.current,
        connectedAddress,
        charge.walletAddress,
        charge.amount
      );

      setTxHash(hash);
      setTxStatus("Verifying payment on-chain...");
      try {
        await confirmPayment({ data: { txHash: hash, chargeId } });
        setTxStatus("Payment verified and confirmed!");
      } catch {
        setTxStatus("Transaction sent! Awaiting on-chain confirmation (may take a few seconds)...");
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Transaction failed";
      setTxStatus(`Error: ${errorMsg}`);
    }
  }, [connectedAddress, charge, confirmPayment, chargeId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !charge) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="bg-card rounded-2xl border border-border p-8 max-w-md text-center shadow-xl">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-foreground mb-2">Charge Not Found</h1>
          <p className="text-muted-foreground">This payment link may have expired or is invalid.</p>
        </div>
      </div>
    );
  }

  const isPaid = charge.status === "paid";
  const isLocusCharge = charge.paymentMethod === "locus";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border p-8 max-w-lg w-full shadow-xl shadow-black/20">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-display text-foreground">Citadelle Synapse</h1>
          <p className="text-muted-foreground text-sm mt-1">Secure Payment Request</p>
          {isLocusCharge && (
            <div className="flex items-center gap-1.5 justify-center mt-2 text-violet-400 text-xs font-medium">
              <Diamond className="w-3 h-3" />
              Powered by Locus
            </div>
          )}
        </div>

        <div className="bg-secondary/50 rounded-xl p-6 mb-6 border border-border">
          <div className="text-center mb-4">
            <p className="text-sm text-muted-foreground">Amount Due</p>
            <p className="text-4xl font-display text-foreground mt-1">
              {charge.amount} <span className="text-lg text-primary">USDC</span>
            </p>
            {charge.label && (
              <p className="text-sm text-muted-foreground mt-2">{charge.label}</p>
            )}
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Network</span>
              <span className="text-foreground font-medium">{charge.network}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Recipient</span>
              <span className="text-foreground font-mono text-xs">{truncateAddress(charge.walletAddress)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Token</span>
              <span className="text-foreground">USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className={`font-medium ${isPaid ? "text-emerald-500" : "text-amber-500"}`}>
                {isPaid ? "Paid" : "Pending"}
              </span>
            </div>
          </div>
        </div>

        {isPaid ? (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-emerald-500 font-semibold">Payment Confirmed</p>
            {charge.txHash && (
              <a
                href={`https://basescan.org/tx/${charge.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary hover:underline flex items-center justify-center gap-1 mt-2"
              >
                View on Basescan <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {connectedAddress ? (
              <>
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 px-3 py-2 rounded-lg text-sm font-mono justify-center">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  {truncateAddress(connectedAddress)}
                </div>
                <button
                  onClick={handlePay}
                  disabled={!!txStatus && !txStatus.startsWith("Error")}
                  className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-3 rounded-xl text-base font-semibold hover:bg-primary/90 transition disabled:opacity-50"
                >
                  {txStatus && !txStatus.startsWith("Error") ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Wallet className="w-5 h-5" />
                  )}
                  Pay {charge.amount} USDC
                </button>
              </>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={connectWallet}
                  disabled={connecting}
                  className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-3 rounded-xl text-base font-semibold hover:bg-primary/90 transition disabled:opacity-50"
                >
                  {connecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Link2 className="w-5 h-5" />}
                  {connecting ? "Connecting..." : "Connect MetaMask to Pay"}
                </button>
                {walletError === "iframe" && (
                  <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg p-3 text-sm">
                    <p className="font-medium mb-1">MetaMask cannot connect inside an iframe</p>
                    <p className="text-xs text-amber-400/80 mb-2">Open this page in a new browser tab where MetaMask is installed.</p>
                    <a
                      href={window.location.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-medium"
                    >
                      Open in new tab <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
                {walletError === "no-metamask" && (
                  <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg p-3 text-sm">
                    <p className="font-medium mb-1">MetaMask not detected</p>
                    <p className="text-xs text-amber-400/80 mb-2">Install the MetaMask browser extension to connect your wallet.</p>
                    <a
                      href="https://metamask.io/download/"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-medium"
                    >
                      Install MetaMask <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
                {walletError && walletError !== "iframe" && walletError !== "no-metamask" && (
                  <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg p-3 text-sm">
                    {walletError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {txStatus && (
          <div className={`mt-4 p-3 rounded-lg text-sm text-center ${
            txStatus.startsWith("Error") ? "bg-destructive/10 text-destructive border border-destructive/20" :
            txStatus.includes("confirmed") || txStatus.includes("verified") ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" :
            "bg-amber-500/10 text-amber-500 border border-amber-500/20"
          }`}>
            {txStatus}
          </div>
        )}

        {txHash && (
          <div className="mt-3 text-center">
            <a
              href={`https://basescan.org/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary hover:underline flex items-center justify-center gap-1"
            >
              View transaction on Basescan <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">
            Zero-retention platform. No payment data is stored permanently.
          </p>
        </div>
      </div>
    </div>
  );
}
