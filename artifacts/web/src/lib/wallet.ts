import { BrowserProvider, Contract } from "ethers";

export const BASE_CHAIN_ID = 8453;
export const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;

const BASE_CHAIN_PARAMS = {
  chainId: "0x2105",
  chainName: "Base",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

const ERC20_TRANSFER_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
];

export function getEthereumProvider(): unknown | null {
  return (window as Record<string, unknown>).ethereum ?? null;
}

export async function connectWalletRobust(): Promise<{
  address: string;
  provider: BrowserProvider;
}> {
  const ethereum = getEthereumProvider();
  if (!ethereum) {
    throw new Error("MetaMask is not installed.");
  }

  const provider = new BrowserProvider(ethereum as never);
  const accounts = await provider.send("eth_requestAccounts", []);

  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts returned. Please unlock MetaMask and try again.");
  }

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== BASE_CHAIN_ID) {
    try {
      await provider.send("wallet_switchEthereumChain", [
        { chainId: "0x2105" },
      ]);
    } catch (switchError: unknown) {
      if ((switchError as { code?: number })?.code === 4902) {
        await provider.send("wallet_addEthereumChain", [BASE_CHAIN_PARAMS]);
      } else {
        throw new Error(
          "Please switch to the Base network in your wallet."
        );
      }
    }
  }

  return { address: accounts[0], provider };
}

export async function sendUsdcTransfer(
  provider: BrowserProvider,
  from: string,
  to: string,
  amountUsdc: string
): Promise<string> {
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== BASE_CHAIN_ID) {
    try {
      await provider.send("wallet_switchEthereumChain", [
        { chainId: "0x2105" },
      ]);
    } catch {
      throw new Error("Please switch to the Base network before sending.");
    }
  }

  const signer = await provider.getSigner(from);
  const usdc = new Contract(USDC_CONTRACT, ERC20_TRANSFER_ABI, signer);
  const rawAmount = BigInt(Math.round(parseFloat(amountUsdc) * 10 ** USDC_DECIMALS));
  const tx = await usdc.transfer(to, rawAmount);
  return tx.hash;
}

export async function signTypedDataV4(
  provider: BrowserProvider,
  address: string,
  msgParams: string
): Promise<string> {
  return (await provider.send("eth_signTypedData_v4", [
    address,
    msgParams,
  ])) as string;
}
