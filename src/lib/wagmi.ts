import { env } from '../config/env'
import { farcasterMiniApp as farcasterMiniAppConnector } from '@farcaster/miniapp-wagmi-connector'
import {
  cookieStorage,
  createConfig,
  createStorage,
  http,
  type CreateConnectorFn,
} from 'wagmi'
import { base, baseSepolia } from 'viem/chains'

const DEFAULT_BASE_RPC = 'https://mainnet.base.org'
const DEFAULT_BASE_SEPOLIA_RPC = 'https://sepolia.base.org'

export const supportedChains = [base, baseSepolia] as const

export const preferredChain =
  env.defaultChain === 'base-sepolia' ? baseSepolia : base

const transports = {
  [base.id]: http(env.baseRpcUrl ?? DEFAULT_BASE_RPC),
  [baseSepolia.id]: http(env.baseSepoliaRpcUrl ?? DEFAULT_BASE_SEPOLIA_RPC),
} as const

const connectors: CreateConnectorFn[] = [farcasterMiniAppConnector()]

export const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors,
  transports,
  ssr: false,
  storage: createStorage({ storage: cookieStorage }),
})
