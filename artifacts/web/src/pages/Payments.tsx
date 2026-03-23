import { useState, useCallback } from "react";
import {
  useGetPayments,
  useGetWalletInfo,
  useListCharges,
  useCreateCharge,
  useConfirmPayment,
  useGetDelegation,
  useSubmitDelegation,
  useGetAgentIdentity,
  useGetBudgetStatus,
} from "@workspace/api-client-react";
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
  Diamond,
  Shield,
  Fuel,
  KeyRound,
  Zap,
  Fingerprint,
  Gem,
  Gauge,
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
  const { data: delegation, refetch: refetchDelegation } = useGetDelegation({ query: { refetchInterval: 15000 } });
  const { data: identity } = useGetAgentIdentity({ query: { refetchInterval: 30000 } });
  const { data: budget } = useGetBudgetStatus({ query: { refetchInterval: 30000 } });
  const { mutateAsync: createCharge, isPending: creatingCharge } = useCreateCharge();
  const { mutateAsync: confirmPayment } = useConfirmPayment();
  const { mutateAsync: submitDelegation } = useSubmitDelegation();

  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeLabel, setChargeLabel] = useState("");
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [payingChargeId, setPayingChargeId] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [delegationLoading, setDelegationLoading] = useState(false);
  const [dailyLimit, setDailyLimit] = useState("50");
  const [expiryHours, setExpiryHours] = useState("24");

  const locusData = walletInfo?.locus;
  const locusConnected = locusData?.connected === true;
  const uniswapConfigured = walletInfo?.uniswapConfigured === true;
  const vvvBalance = walletInfo?.vvvBalance || "0";

  const connectWallet = useCallback(async () => {
    setWalletError(null);
    if (!window.ethereum) {
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
            } else {
              setWalletError("Could not switch to Base network. Please switch manually in MetaMask.");
            }
          }
        }
      }
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

  const payCharge = useCallback(async (chargeId: string, amount: string, targetWallet?: string) => {
    if (!window.ethereum || !connectedAddress) {
      connectWallet();
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
      const payTo = targetWallet || walletInfo?.address || "";
      const data = encodeTransferData(payTo, amount);
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
  }, [connectedAddress, walletInfo, confirmPayment, refetchPayments, refetchCharges, refetchWallet, connectWallet]);

  const handleCreateCharge = async () => {
    const amount = parseFloat(chargeAmount);
    if (isNaN(amount) || amount <= 0) return;
    await createCharge({ data: { amount, label: chargeLabel || undefined } });
    setChargeAmount("");
    setChargeLabel("");
    refetchCharges();
  };

  const handleGrantDelegation = async () => {
    if (!window.ethereum || !connectedAddress) {
      connectWallet();
      return;
    }
    if (!walletInfo?.address) {
      setWalletError("Wallet info not loaded yet. Please wait and try again.");
      return;
    }

    setDelegationLoading(true);
    try {
      const eip712Info = delegation?.eip712;
      if (!eip712Info) {
        alert("Could not load delegation type info from server.");
        return;
      }

      const limitUsdc = parseFloat(dailyLimit);
      const hoursVal = parseFloat(expiryHours);
      if (isNaN(limitUsdc) || limitUsdc <= 0 || isNaN(hoursVal) || hoursVal <= 0) {
        alert("Please enter valid daily limit and expiry hours.");
        return;
      }

      const expiresAt = Math.floor(Date.now() / 1000) + Math.floor(hoursVal * 3600);
      const limitRaw = "0x" + BigInt(Math.round(limitUsdc * 1e6)).toString(16);
      const expiresAtHex = "0x" + BigInt(expiresAt).toString(16);

      const msgParams = JSON.stringify({
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
          ],
          Delegation: eip712Info.types.Delegation,
        },
        primaryType: "Delegation",
        domain: eip712Info.domain,
        message: {
          delegate: walletInfo.address,
          allowedContract: eip712Info.allowedContract,
          dailyLimitUsdc: limitRaw,
          expiresAt: expiresAtHex,
        },
      });

      const signature = await window.ethereum.request({
        method: "eth_signTypedData_v4",
        params: [connectedAddress, msgParams],
      }) as string;

      await submitDelegation({
        data: {
          delegator: connectedAddress,
          delegate: walletInfo.address,
          allowedContract: eip712Info.allowedContract,
          dailyLimitUsdc: limitUsdc,
          expiresAt,
          signature,
        },
      });

      refetchDelegation();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Delegation signing failed";
      console.error("Delegation error:", msg);
      alert(`Delegation failed: ${msg}`);
    } finally {
      setDelegationLoading(false);
    }
  };

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const pendingCharges = charges?.filter(c => c.status === "pending") || [];
  const confirmedTotal = payments?.reduce((acc, p) => p.status === "confirmed" ? acc + parseFloat(p.amount) : acc, 0) || 0;
  const confirmedCount = payments?.filter(p => p.status === "confirmed").length || 0;
  const pendingCount = pendingCharges.length;
  const ethBalance = walletInfo?.ethBalance || "0";

  return (
    <div className="h-full flex flex-col gap-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display text-foreground flex items-center gap-3">
            <Wallet className="w-8 h-8 text-primary" />
            USDC Payments
          </h1>
          <p className="text-muted-foreground mt-1">Real USDC payments on Base network via MetaMask & Locus.</p>
        </div>
        <div className="flex items-center gap-3">
          {identity?.registered && (
            <div className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/20 text-orange-400 px-2.5 py-1 rounded-lg text-xs font-medium">
              <Fingerprint className="w-3 h-3" />
              ERC-8004
            </div>
          )}
          {uniswapConfigured && (
            <div className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-1 rounded-lg text-xs font-medium">
              <Zap className="w-3 h-3" />
              Uniswap
            </div>
          )}
          {locusConnected && (
            <div className="flex items-center gap-1.5 bg-violet-500/10 border border-violet-500/20 text-violet-400 px-2.5 py-1 rounded-lg text-xs font-medium">
              <Diamond className="w-3 h-3" />
              Locus
            </div>
          )}
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
              {connecting ? "Connecting..." : "Connect MetaMask"}
            </button>
          )}
        </div>
      </header>

      {walletError && (
        <div className={`rounded-xl p-4 text-sm ${walletError === "iframe" || walletError === "no-metamask" ? "bg-amber-500/10 border border-amber-500/20 text-amber-400" : "bg-destructive/10 border border-destructive/20 text-destructive"}`}>
          {walletError === "iframe" && (
            <>
              <p className="font-medium mb-1">MetaMask cannot connect inside an iframe</p>
              <p className="text-xs opacity-80 mb-2">Open this page in a new browser tab where MetaMask is installed.</p>
              <a
                href={window.location.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-medium"
              >
                Open in new tab <ExternalLink className="w-3 h-3" />
              </a>
            </>
          )}
          {walletError === "no-metamask" && (
            <>
              <p className="font-medium mb-1">MetaMask not detected</p>
              <p className="text-xs opacity-80 mb-2">Install the MetaMask browser extension to connect your wallet.</p>
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-medium"
              >
                Install MetaMask <ExternalLink className="w-3 h-3" />
              </a>
            </>
          )}
          {walletError !== "iframe" && walletError !== "no-metamask" && walletError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {uniswapConfigured && (
          <div className="bg-card rounded-xl border border-blue-500/20 p-5 shadow-lg">
            <p className="text-sm text-blue-400 font-medium mb-1 flex items-center gap-1.5">
              <Fuel className="w-3.5 h-3.5" />
              Gas Treasury
            </p>
            {loadingWallet ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <div>
                <p className="text-2xl font-display text-foreground">
                  {parseFloat(ethBalance).toFixed(6)}
                  <span className="text-sm text-blue-400 ml-2">ETH</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">Agent gas balance</p>
              </div>
            )}
          </div>
        )}
        {(uniswapConfigured || parseFloat(vvvBalance) > 0) && (
          <div className="bg-card rounded-xl border border-purple-500/20 p-5 shadow-lg">
            <p className="text-sm text-purple-400 font-medium mb-1 flex items-center gap-1.5">
              <Gem className="w-3.5 h-3.5" />
              VVV Compute Equity
            </p>
            {loadingWallet ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <div>
                <p className="text-2xl font-display text-foreground">
                  {parseFloat(vvvBalance).toFixed(4)}
                  <span className="text-sm text-purple-400 ml-2">VVV</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">Venice governance token</p>
              </div>
            )}
          </div>
        )}
        {locusConnected && (
          <div className="bg-card rounded-xl border border-violet-500/20 p-5 shadow-lg">
            <p className="text-sm text-violet-400 font-medium mb-1 flex items-center gap-1.5">
              <Diamond className="w-3.5 h-3.5" />
              Locus Treasury
            </p>
            {loadingWallet ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <div>
                <p className="text-2xl font-display text-foreground">
                  {parseFloat(locusData?.balance || "0").toFixed(2)}
                  <span className="text-sm text-violet-400 ml-2">USDC</span>
                </p>
                <button
                  onClick={() => copyAddress(locusData?.walletAddress || "")}
                  className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground mt-1"
                >
                  {truncateAddress(locusData?.walletAddress || "")}
                  {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="bg-card rounded-xl border border-border p-5 shadow-lg">
          <p className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            {locusConnected ? "Direct Wallet" : "Agent Wallet"}
          </p>
          {loadingWallet ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : (
            <div>
              <button onClick={() => copyAddress(walletInfo?.address || "")} className="flex items-center gap-1.5 text-sm font-mono text-primary hover:underline">
                {truncateAddress(walletInfo?.address || "")}
                {!locusConnected && (copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />)}
              </button>
              <p className="text-xs text-muted-foreground mt-1">Base Network</p>
            </div>
          )}
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

      {uniswapConfigured && (
        <div className="bg-card rounded-xl border border-blue-500/20 p-5 shadow-lg">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-blue-400" />
            Swap Delegation (ERC-7715)
          </h2>
          {delegation?.active ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-emerald-500 font-medium text-sm">Active Delegation</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Delegator</p>
                  <p className="font-mono text-foreground text-xs">{truncateAddress(delegation.delegator || "")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Daily Limit</p>
                  <p className="text-foreground font-semibold">{delegation.dailyLimitUsdc} USDC</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Used Today</p>
                  <p className="text-foreground font-semibold">{(delegation.dailyUsedUsdc || 0).toFixed(2)} USDC</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Expires</p>
                  <p className="text-foreground text-xs">{delegation.expiresAt ? format(new Date(delegation.expiresAt), "MMM d, HH:mm") : "N/A"}</p>
                </div>
              </div>
              <div className="w-full bg-secondary rounded-full h-2 mt-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, ((delegation.dailyUsedUsdc || 0) / (delegation.dailyLimitUsdc || 1)) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {(delegation.dailyRemainingUsdc || 0).toFixed(2)} USDC remaining today
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {delegation?.expired ? (
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <span className="text-amber-500 font-medium text-sm">Delegation Expired</span>
                </div>
              ) : null}
              <p className="text-sm text-muted-foreground">
                {delegation?.reason || "No delegation signed. Grant permission for the agent to autonomously swap USDC to ETH."}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Daily Limit (USDC)</label>
                  <input
                    type="number"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(e.target.value)}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Expiry (hours)</label>
                  <input
                    type="number"
                    value={expiryHours}
                    onChange={(e) => setExpiryHours(e.target.value)}
                    className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>
              <button
                onClick={handleGrantDelegation}
                disabled={delegationLoading || !connectedAddress}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {delegationLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                {connectedAddress ? "Sign Delegation via MetaMask" : "Connect Wallet First"}
              </button>
            </div>
          )}
        </div>
      )}

      {identity && (
        <div className="bg-card rounded-xl border border-orange-500/20 p-5 shadow-lg">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-orange-400" />
            ERC-8004 Agent Identity
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Status</p>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${identity.registered ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
                <span className={`font-medium text-sm ${identity.registered ? "text-emerald-500" : "text-muted-foreground"}`}>
                  {identity.registered ? "Registered" : "Unregistered"}
                </span>
              </div>
            </div>
            {identity.agentId !== undefined && (
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Agent ID</p>
                <p className="text-foreground font-semibold text-lg">#{identity.agentId}</p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Identity Registry</p>
              <a
                href={`https://basescan.org/address/${identity.registryAddress}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-orange-400 hover:underline font-mono text-xs"
              >
                {truncateAddress(identity.registryAddress)}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Reputation Registry</p>
              <a
                href={`https://basescan.org/address/${identity.reputationRegistryAddress}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-orange-400 hover:underline font-mono text-xs"
              >
                {truncateAddress(identity.reputationRegistryAddress)}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            {identity.reputationScore !== undefined && (
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Reputation Score</p>
                <p className="text-foreground font-semibold text-lg">{identity.reputationScore}</p>
              </div>
            )}
            {identity.feedbackCount !== undefined && (
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Feedbacks</p>
                <p className="text-foreground font-semibold text-lg">{identity.feedbackCount}</p>
              </div>
            )}
          </div>
          {identity.registrationTxHash && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Registration Tx:{" "}
                <a
                  href={`https://basescan.org/tx/${identity.registrationTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-orange-400 hover:underline font-mono"
                >
                  {truncateAddress(identity.registrationTxHash)}
                </a>
              </p>
            </div>
          )}
        </div>
      )}

      {budget && (
        <div className="bg-card rounded-xl border border-cyan-500/20 p-5 shadow-lg">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-cyan-400" />
            DIEM Compute Credits
          </h2>
          {budget.diem && (
            <div className="mb-4 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-cyan-400">Daily DIEM Budget</span>
                <span className="text-sm font-mono text-foreground">
                  {(budget.diem as { consumed: number; budget: number; percentUsed: number }).consumed.toFixed(4)} / {(budget.diem as { consumed: number; budget: number; percentUsed: number }).budget.toFixed(2)} DIEM
                </span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all ${
                    (budget.diem as { percentUsed: number }).percentUsed >= 90
                      ? "bg-red-500"
                      : (budget.diem as { percentUsed: number }).percentUsed >= 70
                        ? "bg-amber-500"
                        : "bg-cyan-500"
                  }`}
                  style={{ width: `${Math.min(100, (budget.diem as { percentUsed: number }).percentUsed)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                1 DIEM = $1/day of Venice AI compute &middot; {(budget.diem as { percentUsed: number }).percentUsed}% consumed
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(budget.categories || {}).map(([name, cat]) => {
              const c = cat as { used: number; limit: number; percentUsed: number; diemCost: number };
              const pct = c.percentUsed || 0;
              const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-cyan-500";
              return (
                <div key={name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground capitalize">{name}</span>
                    <span className="text-xs text-foreground font-mono">{c.used}/{c.limit}</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-1.5">
                    <div className={`${barColor} h-1.5 rounded-full transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {c.diemCost > 0 ? `${c.diemCost.toFixed(4)} DIEM` : `${pct}% used`}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Overall: {budget.overall?.used || 0}/{budget.overall?.limit || 0} calls ({budget.overall?.percentUsed || 0}%)</span>
            <span>Resets: {budget.nextResetAt ? format(new Date(budget.nextResetAt), "MMM d, HH:mm") : "daily"}</span>
          </div>
        </div>
      )}

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
            {locusConnected && (
              <p className="text-xs text-violet-400 flex items-center gap-1 justify-center">
                <Diamond className="w-3 h-3" />
                Charges route to Locus treasury
              </p>
            )}
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
              {pendingCharges.map((charge) => {
                const isLocusCharge = !!charge.locusWalletAddress;
                return (
                  <div key={charge.id} className={`bg-secondary/50 rounded-lg p-4 border flex items-center justify-between ${isLocusCharge ? "border-violet-500/20" : "border-border"}`}>
                    <div>
                      <p className="text-foreground font-semibold flex items-center gap-2">
                        {charge.amount} USDC
                        {isLocusCharge && <Diamond className="w-3 h-3 text-violet-400" />}
                      </p>
                      {charge.label && <p className="text-sm text-muted-foreground">{charge.label}</p>}
                      <p className="text-xs text-muted-foreground font-mono mt-1">ID: {charge.id.slice(0, 8)}...</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {connectedAddress ? (
                        <button
                          onClick={() => payCharge(charge.id, charge.amount, charge.locusWalletAddress)}
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
                );
              })}
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
                  <th className="px-6 py-4">To</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map((payment) => {
                  const isLocus = payment.network?.includes("Locus");
                  const isSwap = payment.network?.includes("Swap") || payment.paymentMethod === "swap";
                  return (
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
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{payment.network || "Base"}</span>
                          {isLocus && <Diamond className="w-2.5 h-2.5 text-violet-400" />}
                          {isSwap && <Zap className="w-2.5 h-2.5 text-blue-400" />}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="bg-secondary px-2 py-0.5 rounded text-foreground font-mono text-xs">
                          {truncateAddress(payment.from || "")}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded font-mono text-xs ${isSwap ? "bg-blue-500/10 text-blue-400" : "bg-secondary text-foreground"}`}>
                          {isSwap ? "Uniswap" : truncateAddress(payment.to || "")}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                          {payment.amount}
                          <span className={`text-xs border px-1.5 py-0.5 rounded uppercase ${isSwap ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-primary/10 text-primary border-primary/20"}`}>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
