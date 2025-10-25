export type SupportedChain = 'base' | 'base-sepolia'

type EnvConfig = {
  onchainKitApiKey?: string
  walletConnectProjectId?: string
  defaultChain: SupportedChain
  baseRpcUrl?: string
  baseSepoliaRpcUrl?: string
  captureTarget?: string
  captureContractAddress?: string
  farcasterApiUrl?: string
  farcasterApiToken?: string
}

const toSupportedChain = (value: string | undefined): SupportedChain => {
  if (value === 'base-sepolia') {
    return 'base-sepolia'
  }
  return 'base'
}

export const env: EnvConfig = {
  onchainKitApiKey: import.meta.env.VITE_ONCHAINKIT_API_KEY,
  walletConnectProjectId: import.meta.env.VITE_WALLETCONNECT_ID,
  defaultChain: toSupportedChain(import.meta.env.VITE_DEFAULT_CHAIN),
  baseRpcUrl: import.meta.env.VITE_BASE_RPC_URL,
  baseSepoliaRpcUrl: import.meta.env.VITE_BASE_SEPOLIA_RPC_URL,
  captureTarget: import.meta.env.VITE_CAPTURE_TARGET,
  captureContractAddress: import.meta.env.VITE_CAPTURE_CONTRACT_ADDRESS,
  farcasterApiUrl: import.meta.env.VITE_FARCASTER_API_URL,
  farcasterApiToken: import.meta.env.VITE_FARCASTER_API_TOKEN,
}
