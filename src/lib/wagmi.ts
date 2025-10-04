import { APP_NAME, APP_TAGLINE, APP_URL } from '../config/constants'
import { env } from '../config/env'
import {
  coinbaseWallet,
  injected,
  walletConnect,
} from 'wagmi/connectors'
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

const connectors: CreateConnectorFn[] = [
  coinbaseWallet({
    appName: APP_NAME,
    preference: 'all',
    appLogoUrl: `${APP_URL}/icon.png`,
  }),
  injected({ shimDisconnect: true }),
]

if (env.walletConnectProjectId) {
  connectors.push(
    walletConnect({
      projectId: env.walletConnectProjectId,
      metadata: {
        name: APP_NAME,
        description: APP_TAGLINE,
        url: APP_URL,
        icons: [`${APP_URL}/icon.png`],
      },
      showQrModal: true,
    }),
  )
}

export const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors,
  transports,
  ssr: false,
  storage: createStorage({ storage: cookieStorage }),
})
