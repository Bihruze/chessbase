import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import type { PieceDropHandlerArgs, PieceHandlerArgs, SquareHandlerArgs } from 'react-chessboard'
import { useMiniKit } from '@coinbase/onchainkit/minikit'
import { useAccount, usePublicClient } from 'wagmi'
import { Transaction, TransactionButton, TransactionToast } from '@coinbase/onchainkit/transaction'
import { encodeFunctionData, parseGwei, type Hex } from 'viem'
import { useChessGame } from './hooks/useChessGame'
import type { CaptureEvent } from './hooks/useChessGame'
import { Leaderboard } from './components/Leaderboard'
import { useLeaderboard } from './hooks/useLeaderboard'
import { useMatchmaking } from './hooks/useMatchmaking'
import { APP_NAME, APP_TAGLINE, APP_URL, DEFAULT_CAPTURE_CONTRACT } from './config/constants'
import { shortenHex } from './utils/strings'
import { selectEngineMove } from './utils/chessAi'
import { env } from './config/env'
import { preferredChain } from './lib/wagmi'
import './App.css'
import { WalletControls } from './components/WalletControls'
import { chessBaseCapturesAbi } from './abi/chessBaseCaptures'

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

const inferCapturedColor = (piece?: string) => {
  if (!piece) {
    return 'black'
  }
  return piece === piece.toLowerCase() ? 'black' : 'white'
}

type PendingCapture = {
  id: string
  event: CaptureEvent
  moveNumber: number
  halfMoveIndex: number
}

type CaptureLogEntry = {
  id: string
  player: string
  moveNumber: number
  san: string
  square: string
  piece: string
  txHash: string
  timestamp: number
}

const EXPLORERS: Record<number, string> = {
  8453: 'https://basescan.org/tx/',
  84532: 'https://sepolia.basescan.org/tx/',
}

const getExplorerTxUrl = (hash: string) => {
  const baseUrl = EXPLORERS[preferredChain.id] ?? 'https://basescan.org/tx/'
  return `${baseUrl}${hash}`
}

const formatTxHash = (value: string) => (value.startsWith('0x') ? shortenHex(value, 6) : value)

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Hex

function App() {
  const miniKit = useMiniKit()
  const { context, setMiniAppReady } = miniKit
  const { address } = useAccount()
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
    repetitionCount,
  } = useChessGame()

  const [pendingCapture, setPendingCapture] = useState<PendingCapture | null>(null)
  const [captureLog, setCaptureLog] = useState<CaptureLogEntry[]>([])
  const [captureError, setCaptureError] = useState<string | null>(null)
  const captureKeyRef = useRef<string | null>(null)
  const drawNotifiedRef = useRef(false)
  const { leaderboard, mergeChainEntry } = useLeaderboard()
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white')
  const [boardSize, setBoardSize] = useState(320)
  const [isCompactLayout, setIsCompactLayout] = useState(false)
  const [infoExpanded, setInfoExpanded] = useState(true)
  const isSponsored = Boolean(env.onchainKitApiKey)
  const [shareHint, setShareHint] = useState<string | null>(null)
  const [mateBanner, setMateBanner] = useState<
    { text: string; variant: 'win' | 'loss' | 'draw' } | null
  >(null)
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [infoTab, setInfoTab] = useState<'moves' | 'leaderboard'>('moves')
  const [moveHints, setMoveHints] = useState<Record<string, CSSProperties>>({})
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null)
  const captureTarget = (env.captureTarget ?? DEFAULT_CAPTURE_CONTRACT) as Hex
  const containerRef = useRef<HTMLDivElement | null>(null)
  const boardContainerRef = useRef<HTMLDivElement | null>(null)
  const topLeaderboardRef = useRef<HTMLDivElement | null>(null)

  const handleOpponentMove = useCallback(
    (san: string, fen: string) => {
      const success = applyMoveBySan(san)
      if (!success) {
        console.warn('Failed to apply opponent move, requested FEN:', fen)
      }
    },
    [applyMoveBySan],
  )

  const {
    playerColor,
    opponentType,
    status: matchStatus,
    emitMove,
    startBotMatch,
  } = useMatchmaking({ onOpponentMove: handleOpponentMove })
  const botTurnColor = playerColor === 'white' ? 'b' : 'w'

  const handleCaptureComplete = useCallback(
    (entry: CaptureLogEntry) => {
      setCaptureLog((prev) => {
        const next = [entry, ...prev]
        const playerCaptures = next.filter(
          (item) => item.player.toLowerCase() === entry.player.toLowerCase(),
        )
        mergeChainEntry({
          player: entry.player,
          totalCaptures: playerCaptures.length,
          lastMoveNumber: entry.moveNumber,
          lastCaptureAt: entry.timestamp,
          lastSan: entry.san,
          lastSquare: entry.square,
        })
        return next
      })
      setPendingCapture(null)
      setCaptureError(null)
    },
    [mergeChainEntry],
  )

  const handleCaptureError = useCallback((message: string) => {
    setCaptureError(message)
  }, [])

  const handleCaptureCancel = useCallback(() => {
    setPendingCapture(null)
    setCaptureError(null)
  }, [])

  const scrollToLeaderboard = useCallback(() => {
    topLeaderboardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  const handleNewGame = useCallback(() => {
    setMateBanner(null)
    drawNotifiedRef.current = false
    resetGame()
  }, [resetGame])

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

  const clearMoveHints = useCallback(() => {
    setMoveHints({})
    setSelectedSquare(null)
    setHoveredSquare(null)
  }, [])

  const buildMoveHintStyles = useCallback(
    (fromSquare: string, includeOrigin: boolean) => {
      const legalMoves = getLegalMoves()
      const relevant = legalMoves.filter((move) => move.from === fromSquare)
      if (relevant.length === 0) {
        return {}
      }
      const hints: Record<string, CSSProperties> = {}
      if (includeOrigin) {
        hints[fromSquare] = {
          boxShadow: 'inset 0 0 0 4px rgba(149, 38, 211, 0.9)',
          background: 'radial-gradient(circle, rgba(214,92,255,0.18) 42%, transparent 48%)',
        }
      }
      relevant.forEach((move) => {
        const isCapture = Boolean(move.captured)
        hints[move.to] = isCapture
          ? {
              boxShadow: 'inset 0 0 0 3px rgba(217, 70, 239, 0.88)',
              background: 'radial-gradient(circle, rgba(217,70,239,0.52) 34%, transparent 40%)',
            }
          : {
              boxShadow: 'inset 0 0 0 3px rgba(168, 85, 247, 0.88)',
              background: 'radial-gradient(circle, rgba(168,85,247,0.32) 24%, transparent 30%)',
            }
      })
      return hints
    },
    [getLegalMoves],
  )

  const showMoveHints = useCallback(
    (fromSquare: string, source: 'select' | 'hover' = 'select') => {
      const hints = buildMoveHintStyles(fromSquare, source === 'select')
      if (Object.keys(hints).length === 0) {
        if (source === 'select') {
          clearMoveHints()
        } else if (!selectedSquare) {
          setHoveredSquare(null)
          setMoveHints({})
        }
        return
      }
      setMoveHints(hints)
      if (source === 'select') {
        setSelectedSquare(fromSquare)
        setHoveredSquare(null)
      } else if (!selectedSquare) {
        setHoveredSquare(fromSquare)
      }
    },
    [buildMoveHintStyles, clearMoveHints, selectedSquare],
  )

  const handlePieceDragBegin = useCallback(
    ({ square }: PieceHandlerArgs) => {
      if (square) {
        showMoveHints(square, 'select')
      }
    },
    [showMoveHints],
  )

  const handlePieceDragEnd = useCallback(() => {
    clearMoveHints()
  }, [clearMoveHints])

  const handleSquareClick = useCallback(
    ({ square }: SquareHandlerArgs) => {
      if (selectedSquare === square) {
        clearMoveHints()
        return
      }
      showMoveHints(square, 'select')
    },
    [clearMoveHints, selectedSquare, showMoveHints],
  )

  const handleSquareMouseOver = useCallback(
    ({ square, piece }: SquareHandlerArgs) => {
      if (!square || !piece || selectedSquare) {
        return
      }
      const pieceCode = piece.pieceType ?? ''
      const pieceColor = pieceCode.startsWith('w') ? 'white' : 'black'
      if (pieceColor !== playerColor) {
        return
      }
      showMoveHints(square, 'hover')
    },
    [playerColor, selectedSquare, showMoveHints],
  )

  const handleSquareMouseOut = useCallback(
    ({ square }: SquareHandlerArgs) => {
      if (!hoveredSquare || hoveredSquare !== square || selectedSquare) {
        return
      }
      setHoveredSquare(null)
      setMoveHints({})
    },
    [hoveredSquare, selectedSquare],
  )

  useEffect(() => {
    setMiniAppReady().catch(() => undefined)
  }, [setMiniAppReady])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const node = boardContainerRef.current ?? containerRef.current
    if (!node) {
      return
    }

    const computeBoardSize = () => {
      const rect = node.getBoundingClientRect()
      const width = rect.width
      const height = rect.height || width
      if (width <= 0 || height <= 0) {
        return
      }
      const raw = Math.min(width, height, 424)
      const squareSize = Math.max(1, Math.floor(raw / 8))
      const snapped = squareSize * 8
      setBoardSize(snapped)
      setIsCompactLayout(width < 360)
    }

    computeBoardSize()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => computeBoardSize())
      observer.observe(node)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', computeBoardSize)
    return () => window.removeEventListener('resize', computeBoardSize)
  }, [])

  useEffect(() => {
    setInfoExpanded((prev) => {
      const next = !isCompactLayout
      return prev === next ? prev : next
    })
  }, [isCompactLayout])

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

    const depthMap: Record<typeof botDifficulty, number> = {
      easy: 1,
      medium: 2,
      hard: 3,
    }

    const delayMap: Record<typeof botDifficulty, number> = {
      easy: 900,
      medium: 700,
      hard: 520,
    }

    const timer = window.setTimeout(() => {
      const latestFen = getCurrentFen()
      const engineMove = selectEngineMove(latestFen, botTurnColor, depthMap[botDifficulty])
      if (!engineMove) {
        return
      }
      applyMoveBySan(engineMove.san)
    }, delayMap[botDifficulty])

    return () => window.clearTimeout(timer)
  }, [applyMoveBySan, botDifficulty, botTurnColor, getCurrentFen, matchStatus, opponentType, turn])

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

  const waitingColorLabel = turn === 'w' ? 'Black' : 'White'
  const opponentColorLabel = playerColor === 'white' ? 'Black' : 'White'
  const playerColorLabel = playerColor === 'white' ? 'White' : 'Black'

  useEffect(() => {
    if (!status.isCheckmate) {
      return
    }
    const playerDeliveredMate = waitingColorLabel === playerColorLabel
    setMateBanner(
      playerDeliveredMate
        ? { text: '🏆  Chessed! You won the game.', variant: 'win' }
        : { text: '😢  You lost the game.', variant: 'loss' },
    )
  }, [playerColorLabel, status.isCheckmate, waitingColorLabel])

  useEffect(() => {
    const isRepetitionDraw = status.isThreefoldRepetition || repetitionCount >= 9
    if (!isRepetitionDraw) {
      drawNotifiedRef.current = false
      return
    }
    if (status.isCheckmate || drawNotifiedRef.current) {
      return
    }
    drawNotifiedRef.current = true
    setMateBanner({ text: "🤝 Draw! It's a tie.", variant: 'draw' })
  }, [repetitionCount, status.isCheckmate, status.isThreefoldRepetition])

  useEffect(() => {
    if (!mateBanner) {
      return
    }
    const timer = setTimeout(() => setMateBanner(null), 3200)
    return () => clearTimeout(timer)
  }, [mateBanner])

  const userDisplayName =
    context?.user?.displayName ?? context?.user?.username ?? 'You'
  const opponentDisplayName = opponentType === 'human' ? 'Opponent' : 'Base Bot'
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
      clearMoveHints()
      if (matchStatus === 'searching') {
        startBotMatch()
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
    [clearMoveHints, emitMove, getCurrentFen, getLatestSan, matchStatus, onPieceDrop, opponentType, playerColor, startBotMatch, turn],
  )

  const highlightStyles = useMemo<Record<string, CSSProperties> | undefined>(() => {
    if (!lastMoveSquares) {
      return undefined
    }
    const { from, to } = lastMoveSquares
    return {
      [from]: {
        boxShadow: 'inset 0 0 0 4px rgba(168, 85, 247, 0.35)',
      },
      [to]: {
        boxShadow: 'inset 0 0 0 4px rgba(168, 85, 247, 0.55)',
      },
    }
  }, [lastMoveSquares])

  const squareStyles = useMemo(() => ({
    ...(highlightStyles ?? {}),
    ...moveHints,
  }), [highlightStyles, moveHints])

  const chessboardOptions = useMemo(
    () => ({
      id: 'base-chessboard',
      position,
      boardOrientation,
      boardStyle: {
        width: boardSize,
        height: boardSize,
        maxWidth: '100%',
        maxHeight: '100%',
        borderRadius: '20px',
        boxShadow: '0 12px 28px rgba(12, 24, 63, 0.45)',
      } satisfies CSSProperties,
      squareStyles,
      animationDurationInMs: 180,
      showNotation: true,
      allowDragOffBoard: false,
      allowDragging: matchStatus !== 'searching',
      onPieceDrop: handlePlayerDrop,
      onPieceDragBegin: handlePieceDragBegin,
      onPieceDragEnd: handlePieceDragEnd,
      onSquareClick: handleSquareClick,
      onMouseOverSquare: handleSquareMouseOver,
      onMouseOutSquare: handleSquareMouseOut,
    }),
    [
      boardOrientation,
      boardSize,
      handlePieceDragBegin,
      handlePieceDragEnd,
      handleSquareMouseOut,
      handleSquareMouseOver,
      handlePlayerDrop,
      handleSquareClick,
      matchStatus,
      position,
      squareStyles,
    ],
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
      <div className="app__container" ref={containerRef}>
        <header className="app__header">
          <div className="app__header-row">
            <div className="app__title">
              <span className="app__logo" aria-hidden="true">♞</span>
              <div>
                <h1>{APP_NAME}</h1>
                <p className="app__tagline">{APP_TAGLINE}</p>
              </div>
            </div>
            <WalletControls />
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

          <div className="board-card__board" ref={boardContainerRef}>
            <Chessboard options={chessboardOptions} />
            {matchStatus === 'searching' && (
              <div className="match-overlay" role="status">
                <div className="match-overlay__content">Looking for another Base player…</div>
              </div>
            )}
          </div>
          {mateBanner ? (
            <div
              className={`board-card__banner board-card__banner--${mateBanner.variant}`}
              role="status"
            >
              {mateBanner.text}
            </div>
          ) : null}

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
            <button type="button" onClick={handleNewGame}>
              New game
            </button>
            <button type="button" onClick={undoMove} disabled={!history.length}>
              Undo move
            </button>
            <button type="button" onClick={toggleOrientation}>
              Flip board
            </button>
            <button type="button" onClick={scrollToLeaderboard}>
              View leaderboard
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

        <details
          className={`info-card${infoExpanded ? ' info-card--open' : ''}`}
          aria-label="Game insights"
          open={infoExpanded}
          onToggle={(event) => setInfoExpanded(event.currentTarget.open)}
        >
          <summary className="info-card__summary">
            <span>Game insights</span>
            <span className="info-card__summary-pill">{infoTab === 'moves' ? 'Move log' : 'Leaderboard'}</span>
          </summary>
          <div className="info-card__content">
            <div className="info-card__tabs" role="tablist" aria-label="Game information tabs">
              <button
                type="button"
                role="tab"
                id="info-tab-moves"
                aria-selected={infoTab === 'moves'}
                aria-controls="info-panel-moves"
                className={`info-card__tab${infoTab === 'moves' ? ' info-card__tab--active' : ''}`}
                onClick={() => setInfoTab('moves')}
              >
                Move log
              </button>
              <button
                type="button"
                role="tab"
                id="info-tab-leaderboard"
                aria-selected={infoTab === 'leaderboard'}
                aria-controls="info-panel-leaderboard"
                className={`info-card__tab${infoTab === 'leaderboard' ? ' info-card__tab--active' : ''}`}
                onClick={() => setInfoTab('leaderboard')}
              >
                Leaderboard
              </button>
            </div>

            {infoTab === 'moves' ? (
              <div
                id="info-panel-moves"
                role="tabpanel"
                aria-labelledby="info-tab-moves"
                className="timeline timeline--embedded"
              >
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
              </div>
            ) : (
              <div
                id="info-panel-leaderboard"
                role="tabpanel"
                aria-labelledby="info-tab-leaderboard"
                className="info-card__panel"
              >
                <Leaderboard entries={leaderboard} variant="embedded" />
              </div>
            )}
          </div>
        </details>

        {captureLog.length > 0 && (
          <details className="ledger" aria-label="Onchain capture ledger">
            <summary className="ledger__summary">
              <span>Capture ledger</span>
              <span className="ledger__summary-pill">{captureLog.length}</span>
            </summary>
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
                    {formatTxHash(entry.txHash)}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}

        <section
          ref={topLeaderboardRef}
          className="leaderboard-block"
          aria-label="Top leaderboard"
        >
          <h2 className="leaderboard-block__title">Current standings</h2>
          <Leaderboard entries={leaderboard} variant="embedded" />
        </section>
      </div>
      {pendingCapture && address && (
        <CaptureTransactionPanel
          capture={pendingCapture}
          playerAddress={address ?? ZERO_ADDRESS}
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
  playerAddress: string
  isSponsored: boolean
  targetAddress: Hex
  onSuccess: (entry: CaptureLogEntry) => void
  onCancel: () => void
  onError: (message: string) => void
  errorMessage: string | null
}

function CaptureTransactionPanel({
  capture,
  playerAddress,
  isSponsored,
  targetAddress,
  onSuccess,
  onCancel,
  onError,
  errorMessage,
}: CaptureTransactionPanelProps) {
  const publicClient = usePublicClient({ chainId: preferredChain.id })

  const calls = useMemo(() => {
    return async () => {
      const payload = encodeFunctionData({
        abi: chessBaseCapturesAbi,
        functionName: 'logCapture',
        args: [capture.moveNumber, capture.event.move.san, capture.event.move.to],
      })

      let maxFeePerGas: bigint | undefined
      let maxPriorityFeePerGas: bigint | undefined

      if (publicClient) {
        try {
          const fees = await publicClient.estimateFeesPerGas()
          maxFeePerGas = fees?.maxFeePerGas ?? fees?.gasPrice ?? parseGwei('2')
          maxPriorityFeePerGas = fees?.maxPriorityFeePerGas ?? parseGwei('1')
        } catch {
          maxFeePerGas = parseGwei('2')
          maxPriorityFeePerGas = parseGwei('1')
        }
      }

      return [
        {
          to: targetAddress,
          value: 0n,
          data: payload,
          ...(maxFeePerGas ? { maxFeePerGas } : {}),
          ...(maxPriorityFeePerGas ? { maxPriorityFeePerGas } : {}),
        } as unknown as { to: Hex; data?: Hex; value?: bigint },
      ]
    }
  }, [capture, publicClient, targetAddress])

  if (targetAddress === ZERO_ADDRESS) {
    const handleLocalLog = () => {
      onSuccess({
        id: capture.id,
        player: playerAddress,
        moveNumber: capture.moveNumber,
        san: capture.event.move.san,
        square: capture.event.move.to,
        piece: capture.event.move.captured ?? '',
        txHash: 'local',
        timestamp: Date.now(),
      })
    }

    return (
      <div className="capture-panel" role="dialog" aria-live="polite">
        <div className="capture-panel__body">
          <span className="capture-panel__eyebrow">Capture ready</span>
          <h4>
            Log {capture.event.move.san}{' '}
            {formatCaptureIcon(
              capture.event.move.captured ?? 'p',
              inferCapturedColor(capture.event.move.captured ?? undefined),
            )}{' '}
            locally
          </h4>
          <p className="capture-panel__meta">
            Square {capture.event.move.to} • move {capture.moveNumber}
          </p>
          <p className="capture-panel__hint" role="status">
            Provide a deployed contract address in VITE_CAPTURE_TARGET to log onchain.
          </p>
          <button type="button" className="board-card__share" onClick={handleLocalLog}>
            Save locally
          </button>
          <button type="button" className="capture-panel__dismiss" onClick={onCancel}>
            Skip this capture
          </button>
        </div>
      </div>
    )
  }

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
            player: playerAddress,
            moveNumber: capture.moveNumber,
            san: capture.event.move.san,
            square: capture.event.move.to,
            piece: capture.event.move.captured ?? '',
            txHash: receipt.transactionHash,
            timestamp: Date.now(),
          })
        }}
        onError={(error) => {
          const raw = error?.message ?? 'Capture transaction failed.'
          const lower = raw.toLowerCase()
          let friendly = raw
          if (lower.includes('insufficient') || lower.includes('fund')) {
            friendly = 'Insufficient ETH on Base. Add funds or configure a paymaster.'
          } else if (lower.includes('self call')) {
            friendly = 'Capture target adresiniz kendi cüzdanınıza işaret ediyor. Lütfen farklı bir adres kullanın.'
          } else if (lower.includes('user rejected')) {
            friendly = 'Transaction was rejected.'
          }
          onError(friendly)
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
          {targetAddress === ZERO_ADDRESS ? (
            <p className="capture-panel__hint" role="status">
              Set VITE_CAPTURE_TARGET to log captures onchain.
            </p>
          ) : null}
          <TransactionButton
            text="Send capture transaction"
            disabled={targetAddress === ZERO_ADDRESS}
          />
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
