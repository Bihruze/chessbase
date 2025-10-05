import { useEffect, useMemo, useRef, useState } from 'react'
import type { Connector } from 'wagmi'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { shortenHex } from '../utils/strings'

const ALWAYS_AVAILABLE = new Set(['walletConnect', 'coinbaseWallet', 'coinbaseWalletSDK', 'injected'])

const CONNECTOR_LABELS: Record<string, string> = {
  'coinbaseWalletSDK': 'Coinbase Wallet',
  coinbaseWallet: 'Coinbase Wallet',
  walletConnect: 'WalletConnect',
}

const resolveConnectorLabel = (connector: Connector) => {
  const direct = CONNECTOR_LABELS[connector.id]
  if (direct) {
    return direct
  }
  const lowerName = connector.name.toLowerCase()
  if (connector.id === 'injected' && lowerName.includes('meta')) {
    return 'MetaMask'
  }
  if (connector.id === 'injected') {
    return 'Browser Wallet'
  }
  return connector.name
}

export function WalletControls() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { connect, connectors, error, isPending, variables } = useConnect()

  const [menuOpen, setMenuOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isConnected) {
      setMenuOpen(false)
    }
  }, [isConnected])

  useEffect(() => {
    if (!menuOpen) {
      return
    }
    const handleOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current) {
        return
      }
      if (!containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [menuOpen])

  const uniqueConnectors = useMemo(() => {
    const seen = new Set<string>()
    return connectors.filter((connector) => {
      if (seen.has(connector.id)) {
        return false
      }
      seen.add(connector.id)
      return connector.ready || ALWAYS_AVAILABLE.has(connector.id)
    })
  }, [connectors])

  const handleConnect = async (connector: Connector) => {
    try {
      setLocalError(null)
      await connect({ connector })
    } catch (connectError) {
      console.warn('wallet connect failed', connectError)
      setLocalError((connectError as Error)?.message ?? 'Connection failed')
    }
  }

  if (address && isConnected) {
    return (
      <div className="wallet-chip">
        <span title={address}>Connected {shortenHex(address, 5)}</span>
        <button
          type="button"
          className="wallet-chip__disconnect"
          onClick={() => disconnect()}
        >
          Disconnect
        </button>
      </div>
    )
  }

  const activeConnector = variables?.connector as Connector | undefined

  const pendingLabel = activeConnector
    ? `Connecting ${resolveConnectorLabel(activeConnector)}...`
    : 'Connecting...'

  return (
    <div className="wallet-connect" ref={containerRef}>
      <button
        type="button"
        className="connect-wallet-button"
        onClick={() => setMenuOpen((prev) => !prev)}
        disabled={isPending}
      >
        {isPending ? pendingLabel : 'Connect wallet'}
      </button>
      {menuOpen ? (
        <div className="wallet-connect__menu">
          {uniqueConnectors.map((connector) => {
            const label = resolveConnectorLabel(connector)
            const always = ALWAYS_AVAILABLE.has(connector.id)
            const isConnectorPending = activeConnector?.id === connector.id
            const disabled = (!connector.ready && !always) || (isPending && !isConnectorPending)
            return (
              <button
                key={connector.id}
                type="button"
                className="wallet-connect__option"
                onClick={() => handleConnect(connector)}
                disabled={disabled}
              >
                <span>{label}</span>
                {!connector.ready && !always ? (
                  <span className="wallet-connect__option-note">Requires extension</span>
                ) : null}
                {isConnectorPending ? (
                  <span className="wallet-connect__option-note">Connecting...</span>
                ) : null}
              </button>
            )
          })}
          {error || localError ? (
            <p className="wallet-connect__error" role="alert">
              {localError ?? error?.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
