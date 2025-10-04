import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import type { PieceDropHandlerArgs } from 'react-chessboard'
import { useMiniKit } from '@coinbase/onchainkit/minikit'
import { useAccount } from 'wagmi'
import { ConnectWallet } from '@coinbase/onchainkit/wallet'
import { Transaction, TransactionButton, TransactionToast } from '@coinbase/onchainkit/transaction'
import { stringToHex, type Hex } from 'viem'
import { useChessGame } from './hooks/useChessGame'
import type { CaptureEvent } from './hooks/useChessGame'
import { useMatchmaking } from './hooks/useMatchmaking'
import { APP_NAME, APP_TAGLINE, APP_URL } from './config/constants'
import { env } from './config/env'
import { preferredChain } from './lib/wagmi'
import './App.css'

const PIECE_SYMBOLS: Record<'white' | 'black', Record<string, string>> = {
  white: {
    p: '♙',
    n: '♘',
    b: '♗',
    r: '♖',
    q: '♕',
    k: '♔',
  },
  black: {
    p: '♟',
    n: '♞',
    b: '♝',
    r: '♜',
    q: '♛',
    k: '♚',
  },
}

const formatCaptureIcon = (piece: string, capturedColor: 'white' | 'black') => {
  const key = piece.toLowerCase()
  return PIECE_SYMBOLS[capturedColor][key] ?? '•'
}

const pieceValues: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
}

const inferCapturedColor = (piece?: string) => {
  if (!piece) {
    return 'black'
  }
  return piece === piece.toLowerCase() ? 'black' : 'white'
}

const buildEntryPointCopy = (locationType?: string) => {
  switch (locationType) {
    case 'cast_embed':
      return 'You launched this duel from a cast embed.'
    case 'cast_share':
      return 'Shared straight from a cast — nice and social.'
    case 'notification':
      return 'Re-engaged from a Base notification.'
    case 'channel':
      return 'Jumped in from a Base channel.'
    default:
      return 'Launch instantly, no downloads, no friction.'
  }
}

type PendingCapture = {
  id: string
  event: CaptureEvent
  moveNumber: number
  halfMoveIndex: number
}

type CaptureLogEntry = {
  id: string
  moveNumber: number
  san: string
  square: string
  piece: string
  txHash: string
  timestamp: number
}

const shortenHex = (value: string, segment = 4) =>
  value.length > segment * 2 + 2
    ? `${value.slice(0, segment + 2)}…${value.slice(-segment)}`
    : value

const EXPLORERS: Record<number, string> = {
  8453: 'https://basescan.org/tx/',
  84532: 'https://sepolia.basescan.org/tx/',
}

const getExplorerTxUrl = (hash: string) => {
  const baseUrl = EXPLORERS[preferredChain.id] ?? 'https://basescan.org/tx/'
  return `${baseUrl}${hash}`
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Hex

function App() {
  const miniKit = useMiniKit()
  const { context, setMiniAppReady } = miniKit
  const { address, isConnected } = useAccount()
  const {
    position,
    turn,
    status,
    history,
    lastMoveSquares,
    captures,
    onPieceDrop,
    lastCapture,
    resetGame,
    undoMove,
    applyMoveBySan,
    getLatestSan,
    getCurrentFen,
    getLegalMoves,
  } = useChessGame()

  const [pendingCapture, setPendingCapture] = useState<PendingCapture | null>(null)
  const [captureLog, setCaptureLog] = useState<CaptureLogEntry[]>([])
  const [captureError, setCaptureError] = useState<string | null>(null)
  const captureKeyRef = useRef<string | null>(null)
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white')
  const [boardSize, setBoardSize] = useState(360)
  const isSponsored = Boolean(env.onchainKitApiKey)
  const [shareHint, setShareHint] = useState<string | null>(null)
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const captureTarget = (env.captureTarget ?? ZERO_ADDRESS) as Hex

  const handleOpponentMove = useCallback(
    (san: string, fen: string) => {
      const success = applyMoveBySan(san)
      if (!success) {
        console.warn('Failed to apply opponent move, requested FEN:', fen)
      }
    },
    [applyMoveBySan],
  )

  const match = useMatchmaking({ onOpponentMove: handleOpponentMove })
  const playerColor = match.playerColor
  const opponentType = match.opponentType
  const botTurnColor = playerColor === 'white' ? 'b' : 'w'
  const matchStatus = match.status
  const emitMove = match.emitMove

  const handleCaptureComplete = useCallback((entry: CaptureLogEntry) => {
    setCaptureLog((prev) => [entry, ...prev])
    setPendingCapture(null)
    setCaptureError(null)
  }, [])

  const handleCaptureError = useCallback((message: string) => {
    setCaptureError(message)
  }, [])

  const handleCaptureCancel = useCallback(() => {
    setPendingCapture(null)
    setCaptureError(null)
  }, [])

  const handleShare = useCallback(async () => {
    const shareUrl =
      typeof window !== 'undefined' && window.location
        ? window.location.href
        : APP_URL
    const shareText = `♟️ Playing ${APP_NAME} on Base — take your shot!`

    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: APP_NAME,
          text: shareText,
          url: shareUrl,
        })
        setShareHint('Shared via device sheet')
        return
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl)
        setShareHint('Link copied to clipboard')
        return
      }

      setShareHint(`Share this link manually: ${shareUrl}`)
    } catch (error) {
      console.error('share failed', error)
      setShareHint('Sharing failed — try again later')
    }
  }, [])

  useEffect(() => {
    setMiniAppReady().catch(() => undefined)
  }, [setMiniAppReady])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const computeBoardSize = () => {
      const width = Math.min(window.innerWidth - 32, 560)
      setBoardSize(Math.max(280, width))
    }

    computeBoardSize()
    window.addEventListener('resize', computeBoardSize)
    return () => window.removeEventListener('resize', computeBoardSize)
  }, [])

  useEffect(() => {
    setBoardOrientation(playerColor)
  }, [playerColor])

  useEffect(() => {
    setBoardOrientation(playerColor)
  }, [playerColor])

  useEffect(() => {
    if (!shareHint) {
      return
    }
    const timer = setTimeout(() => setShareHint(null), 3200)
    return () => clearTimeout(timer)
  }, [shareHint])

  useEffect(() => {
    if (opponentType !== 'bot') {
      return
    }
    if (matchStatus === 'searching') {
      return
    }
    if (turn !== botTurnColor) {
      return
    }

    const moves = getLegalMoves()
    if (!moves.length) {
      return
    }

    const randomChoice = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

    const selectMove = () => {
      if (botDifficulty === 'easy') {
        return randomChoice(moves)
      }
      if (botDifficulty === 'medium') {
        const captureMoves = moves.filter((move) => move.captured)
        return randomChoice(captureMoves.length ? captureMoves : moves)
      }
      const scored = moves.map((move) => {
        const capturedValue = pieceValues[(move.captured ?? '').toLowerCase()] ?? 0
        const checkBonus = move.san.includes('#') ? 6 : move.san.endsWith('+') ? 2 : 0
        return { move, score: capturedValue + checkBonus }
      })
      const bestScore = Math.max(...scored.map((entry) => entry.score))
      const bestMoves = scored.filter((entry) => entry.score === bestScore)
      return randomChoice(bestMoves).move
    }

    const delay = botDifficulty === 'hard' ? 600 : botDifficulty === 'medium' ? 800 : 950
    const timer = window.setTimeout(() => {
      const choice = selectMove()
      if (choice) {
        applyMoveBySan(choice.san)
      }
    }, delay)

    return () => window.clearTimeout(timer)
  }, [applyMoveBySan, botDifficulty, botTurnColor, getLegalMoves, matchStatus, opponentType, turn])

  useEffect(() => {
    if (!lastCapture || lastCapture.capturedBy !== playerColor) {
      return
    }

    if (matchStatus === 'searching') {
      return
    }

    const captureKey = `${history.length}-${lastCapture.move.san}-${lastCapture.capturedBy}`
    if (captureKeyRef.current === captureKey) {
      return
    }

    captureKeyRef.current = captureKey
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`
    const moveNumber = Math.ceil(history.length / 2)
    setPendingCapture({ id, event: lastCapture, moveNumber, halfMoveIndex: history.length })
    setCaptureError(null)
  }, [history, lastCapture, matchStatus, playerColor])

  useEffect(() => {
    if (!pendingCapture) {
      return
    }
    const currentHalfMoves = history.length
    if (currentHalfMoves < pendingCapture.halfMoveIndex) {
      setPendingCapture(null)
      captureKeyRef.current = null
    }
  }, [history.length, pendingCapture])

  useEffect(() => {
    if (history.length === 0) {
      captureKeyRef.current = null
    }
  }, [history.length])

  const safeArea = context?.client?.safeAreaInsets
  const containerStyle = useMemo(() => {
    return {
      paddingTop: `calc(${safeArea?.top ?? 0}px + 16px)`,
      paddingBottom: `calc(${safeArea?.bottom ?? 0}px + 24px)`,
      paddingLeft: `calc(${safeArea?.left ?? 0}px + 16px)`,
      paddingRight: `calc(${safeArea?.right ?? 0}px + 16px)`,
    }
  }, [safeArea])

  const activeColorLabel = turn === 'w' ? 'White' : 'Black'
  const waitingColorLabel = turn === 'w' ? 'Black' : 'White'
  const isGameOver = status.isCheckmate || status.isDraw || status.isStalemate

  const statusCopy = useMemo(() => {
    if (status.isCheckmate) {
      return `${waitingColorLabel} wins by checkmate`
    }
    if (status.isStalemate) {
      return 'Draw • Stalemate'
    }
    if (status.isDraw) {
      return 'Draw • ½ - ½'
    }
    if (status.isCheck) {
      return `${activeColorLabel} is in check`
    }
    return `${activeColorLabel} to move`
  }, [activeColorLabel, waitingColorLabel, status])

  const userDisplayName =
    context?.user?.displayName ?? context?.user?.username ?? 'You'
  const opponentDisplayName = opponentType === 'human' ? 'Opponent' : 'Base Bot'
  const matchStatusCopy = useMemo(() => {
    if (matchStatus === 'searching') {
      return 'Searching for another Base player…'
    }
    if (opponentType === 'bot') {
      return 'Duelling with the Base bot'
    }
    return 'Matched with a Base player'
  }, [matchStatus, opponentType])
  const opponentColorLabel = playerColor === 'white' ? 'Black' : 'White'
  const playerColorLabel = playerColor === 'white' ? 'White' : 'Black'

  const moveRows = useMemo(() => {
    const rows: Array<{ move: number; white?: string; black?: string }> = []
    for (let i = 0; i < history.length; i += 2) {
      rows.push({
        move: i / 2 + 1,
        white: history[i]?.san,
        black: history[i + 1]?.san,
      })
    }
    return rows
  }, [history])

  const captureSummary = useMemo(() => {
    const playerPieces = playerColor === 'white' ? captures.byWhite : captures.byBlack
    const opponentPieces = playerColor === 'white' ? captures.byBlack : captures.byWhite
    const renderIcons = (pieces: string[], prefix: string) =>
      pieces.map((piece, index) => (
        <span className="capture-icon" key={`${prefix}-${piece}-${index}`}>
          {formatCaptureIcon(piece, inferCapturedColor(piece))}
        </span>
      ))
    return {
      playerIcons: renderIcons(playerPieces, 'player'),
      opponentIcons: renderIcons(opponentPieces, 'opponent'),
    }
  }, [captures, playerColor])

  const handlePlayerDrop = useCallback(
    (args: PieceDropHandlerArgs) => {
      if (matchStatus === 'searching') {
        return false
      }

      const pieceCode = args.piece?.pieceType ?? ''
      if (!pieceCode) {
        return false
      }
      const pieceColor = pieceCode.startsWith('w') ? 'white' : 'black'
      if (pieceColor !== playerColor) {
        return false
      }

      const turnColor = turn === 'w' ? 'white' : 'black'
      if (turnColor !== playerColor) {
        return false
      }

      const moveApplied = onPieceDrop(args)
      if (!moveApplied) {
        return false
      }

      const san = getLatestSan()
      const fen = getCurrentFen()

      if (san && opponentType === 'human' && matchStatus === 'matched') {
        emitMove(san, fen)
      }

      return true
    },
    [emitMove, getCurrentFen, getLatestSan, matchStatus, onPieceDrop, opponentType, playerColor, turn],
  )

  const highlightStyles = useMemo<Record<string, CSSProperties> | undefined>(() => {
    if (!lastMoveSquares) {
      return undefined
    }
    const { from, to } = lastMoveSquares
    return {
      [from]: {
        boxShadow: 'inset 0 0 0 4px rgba(87, 82, 255, 0.38)',
      },
      [to]: {
        boxShadow: 'inset 0 0 0 4px rgba(87, 82, 255, 0.55)',
      },
    }
  }, [lastMoveSquares])

  const entryPointCopy = buildEntryPointCopy(context?.location?.type)
  const chessboardOptions = useMemo(
    () => ({
      id: 'base-chessboard',
      position,
      boardOrientation,
      boardStyle: {
        width: boardSize,
        height: boardSize,
        maxWidth: '100%',
        borderRadius: '20px',
        boxShadow: '0 12px 28px rgba(12, 24, 63, 0.45)',
      } satisfies CSSProperties,
      squareStyles: highlightStyles ?? {},
      animationDurationInMs: 180,
      showNotation: true,
      allowDragOffBoard: false,
      allowDragging: matchStatus !== 'searching',
      onPieceDrop: handlePlayerDrop,
    }),
    [boardOrientation, boardSize, handlePlayerDrop, highlightStyles, matchStatus, position],
  )
  const lastCaptureCopy = useMemo(() => {
    if (pendingCapture) {
      const iconColor = inferCapturedColor(pendingCapture.event.move.captured ?? undefined)
      const icon = formatCaptureIcon(pendingCapture.event.move.captured ?? 'p', iconColor)
      return `${userDisplayName} captured ${icon} on ${pendingCapture.event.move.to}. Sign to mint the tx id.`
    }

    if (captureLog.length > 0) {
      const latest = captureLog[0]
      const icon = formatCaptureIcon(latest.piece || 'p', inferCapturedColor(latest.piece))
      return `Onchain capture ${icon} at ${latest.square} • ${shortenHex(latest.txHash, 5)}`
    }

    if (lastCapture) {
      const capturer = lastCapture.capturedBy === playerColor ? userDisplayName : opponentDisplayName
      const targetColor = lastCapture.capturedBy === 'white' ? 'black' : 'white'
      const icon = formatCaptureIcon(lastCapture.move.captured ?? 'p', targetColor)
      return `${capturer} captured ${icon} on ${lastCapture.move.to}`
    }

    return 'No captures yet — pick your opening wisely.'
  }, [captureLog, lastCapture, opponentDisplayName, pendingCapture, playerColor, userDisplayName])

  const toggleOrientation = () => {
    setBoardOrientation((current) => (current === 'white' ? 'black' : 'white'))
  }

  return (
    <div className="app" style={containerStyle}>
      <div className="app__container">
        <header className="app__header">
          <div className="app__header-row">
            <div className="app__title">
              <span className="app__logo" aria-hidden="true">♞</span>
              <div>
                <h1>{APP_NAME}</h1>
                <p className="app__tagline">{APP_TAGLINE}</p>
              </div>
            </div>
            {address && isConnected ? (
              <div className="wallet-chip">
                <span title={address}>Connected {shortenHex(address, 5)}</span>
              </div>
            ) : (
              <ConnectWallet disconnectedLabel="Connect wallet" />
            )}
          </div>
          <div className="app__status">
            <span className={isGameOver ? 'status status--done' : 'status'}>
              {statusCopy}
            </span>
            <span className="status status--light">{matchStatusCopy}</span>
            <span className="status status--light">{entryPointCopy}</span>
          </div>
        </header>

        <section className="board-card" aria-label="Chess board">
          <div className="player-strip">
            <div>
              <span className="player-strip__label">{opponentColorLabel}</span>
              <h2 className="player-strip__name">{opponentDisplayName}</h2>
            </div>
            <div className="player-strip__captures" aria-label="Pieces captured by opponent">
              {captureSummary.opponentIcons.length ? (
                captureSummary.opponentIcons
              ) : (
                <span className="player-strip__empty">No captures yet</span>
              )}
            </div>
          </div>

          {opponentType === 'bot' && (
            <div className="bot-difficulty" role="group" aria-label="Bot difficulty">
              {(['easy', 'medium', 'hard'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`bot-difficulty__option${botDifficulty === level ? ' bot-difficulty__option--active' : ''}`}
                  onClick={() => setBotDifficulty(level)}
                  aria-pressed={botDifficulty === level}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
          )}

          <div className="board-card__board">
            <Chessboard options={chessboardOptions} />
            {matchStatus === 'searching' && (
              <div className="match-overlay" role="status">
                <div className="match-overlay__content">Looking for another Base player…</div>
              </div>
            )}
          </div>

          <div className="player-strip">
            <div>
              <span className="player-strip__label">{playerColorLabel}</span>
              <h2 className="player-strip__name">{userDisplayName}</h2>
            </div>
            <div className="player-strip__captures" aria-label="Pieces captured by you">
              {captureSummary.playerIcons.length ? (
                captureSummary.playerIcons
              ) : (
                <span className="player-strip__empty">Take your first piece</span>
              )}
            </div>
          </div>

          <div className="board-card__controls">
            <button
              type="button"
              className="board-card__share"
              onClick={handleShare}
              disabled={matchStatus === 'searching'}
            >
              Share game
            </button>
            <button type="button" onClick={resetGame}>
              New game
            </button>
            <button type="button" onClick={undoMove} disabled={!history.length}>
              Undo move
            </button>
            <button type="button" onClick={toggleOrientation}>
              Flip board
            </button>
          </div>
          <p className="board-card__note" aria-live="polite">
            {lastCaptureCopy}
          </p>
          {shareHint ? (
            <p className="board-card__hint" aria-live="polite">
              {shareHint}
            </p>
          ) : null}
        </section>

        <section className="timeline" aria-label="Moves timeline">
          <h3>Move log</h3>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>White</th>
                <th>Black</th>
              </tr>
            </thead>
            <tbody>
              {moveRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="timeline__empty">
                    Your captures trigger onchain fireworks. Start with the first move.
                  </td>
                </tr>
              ) : (
                moveRows.map((row) => (
                  <tr key={row.move}>
                    <td>{row.move}</td>
                    <td>{row.white ?? '—'}</td>
                    <td>{row.black ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {captureLog.length > 0 && (
          <section className="ledger" aria-label="Onchain capture ledger">
            <h3>Capture ledger</h3>
            <ul>
              {captureLog.map((entry) => (
                <li key={entry.id}>
                  <div className="ledger__details">
                    <span className="ledger__move">Move {entry.moveNumber}</span>
                    <span className="ledger__san">
                      {entry.san}{' '}
                      {formatCaptureIcon(entry.piece || 'p', inferCapturedColor(entry.piece))}
                      <span className="ledger__square">@{entry.square}</span>
                    </span>
                  </div>
                  <a
                    className="ledger__link"
                    href={getExplorerTxUrl(entry.txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortenHex(entry.txHash, 6)}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {pendingCapture && address && (
        <CaptureTransactionPanel
          capture={pendingCapture}
          isSponsored={isSponsored}
          targetAddress={captureTarget}
          onSuccess={handleCaptureComplete}
          onCancel={handleCaptureCancel}
          onError={handleCaptureError}
          errorMessage={captureError}
        />
      )}
    </div>
  )
}

type CaptureTransactionPanelProps = {
  capture: PendingCapture
  isSponsored: boolean
  targetAddress: Hex
  onSuccess: (entry: CaptureLogEntry) => void
  onCancel: () => void
  onError: (message: string) => void
  errorMessage: string | null
}

function CaptureTransactionPanel({
  capture,
  isSponsored,
  targetAddress,
  onSuccess,
  onCancel,
  onError,
  errorMessage,
}: CaptureTransactionPanelProps) {
  const calls = useMemo(() => {
    const payload = stringToHex(
      `capture:${capture.event.move.san}:${capture.event.move.to}:${capture.moveNumber}`,
    )
    return [
      {
        to: targetAddress,
        value: 0n,
        data: payload,
      },
    ]
  }, [capture, targetAddress])

  return (
    <div className="capture-panel" role="dialog" aria-live="polite">
      <Transaction
        key={capture.id}
        calls={calls}
        chainId={preferredChain.id}
        isSponsored={isSponsored}
        onSuccess={({ transactionReceipts }) => {
          const receipt = transactionReceipts?.[0]
          if (!receipt) {
            return
          }
          onSuccess({
            id: capture.id,
            moveNumber: capture.moveNumber,
            san: capture.event.move.san,
            square: capture.event.move.to,
            piece: capture.event.move.captured ?? '',
            txHash: receipt.transactionHash,
            timestamp: Date.now(),
          })
        }}
        onError={(error) => {
          const message = error?.message ?? 'Capture transaction failed.'
          onError(message)
        }}
      >
        <div className="capture-panel__body">
          <span className="capture-panel__eyebrow">Capture ready</span>
          <h4>
            Log {capture.event.move.san}{' '}
            {formatCaptureIcon(
              capture.event.move.captured ?? 'p',
              inferCapturedColor(capture.event.move.captured ?? undefined),
            )}{' '}
            onchain
          </h4>
          <p className="capture-panel__meta">
            Square {capture.event.move.to} • move {capture.moveNumber}
          </p>
          <TransactionButton text="Send capture transaction" />
          <TransactionToast />
          {errorMessage ? (
            <p className="capture-panel__error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <button type="button" className="capture-panel__dismiss" onClick={onCancel}>
            Skip this capture
          </button>
        </div>
      </Transaction>
    </div>
  )
}

export default App
