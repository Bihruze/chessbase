import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OnchainKitProvider } from '@coinbase/onchainkit'
import { WagmiProvider } from 'wagmi'
import { APP_NAME, APP_URL } from '../config/constants'
import { env } from '../config/env'
import { preferredChain, wagmiConfig } from '../lib/wagmi'

const queryClient = new QueryClient()

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <OnchainKitProvider
          chain={preferredChain}
          apiKey={env.onchainKitApiKey}
          projectId={env.walletConnectProjectId}
          config={{
            appearance: {
              name: APP_NAME,
              logo: `${APP_URL}/icon.png`,
              theme: 'default',
              mode: 'auto',
            },
            wallet: {
              display: 'modal',
            },
          }}
          miniKit={{ enabled: true, autoConnect: true }}
        >
          {children}
        </OnchainKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
