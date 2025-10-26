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
import { APP_NAME, DEFAULT_CAPTURE_CONTRACT } from './config/constants'
import { shortenHex } from './utils/strings'
import { selectEngineMove } from './utils/chessAi'
import { env } from './config/env'
import { preferredChain } from './lib/wagmi'
import './App.css'
import './theme.css'
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

type AppView = 'lobby' | 'board' | 'moves' | 'captures' | 'leaderboard'

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
  const isSponsored = Boolean(env.onchainKitApiKey)
  const [mateBanner, setMateBanner] = useState<
    { text: string; variant: 'win' | 'loss' | 'draw' } | null
  >(null)
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [moveHints, setMoveHints] = useState<Record<string, CSSProperties>>({})
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null)
  const [hasSessionStarted, setHasSessionStarted] = useState(false)
  const [activeView, setActiveView] = useState<AppView>('lobby')
  const isBoardView = activeView === 'board'
  const captureTarget = (env.captureTarget ?? DEFAULT_CAPTURE_CONTRACT) as Hex
  const containerRef = useRef<HTMLDivElement | null>(null)
  const boardContainerRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLElement | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const topPlayerStripRef = useRef<HTMLDivElement | null>(null)
  const bottomPlayerStripRef = useRef<HTMLDivElement | null>(null)
  const boardControlsRef = useRef<HTMLDivElement | null>(null)
  const playerProfileName = context?.user?.displayName ?? context?.user?.username ?? 'Base player'

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
    beginQuickMatch,
    cancelMatchmaking,
    availableMatches,
    opponentLabel,
    availablePlayerLabels,
  } = useMatchmaking({ onOpponentMove: handleOpponentMove, playerLabel: playerProfileName })
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

  const resetBoardState = useCallback(() => {
    setMateBanner(null)
    drawNotifiedRef.current = false
    resetGame()
  }, [resetGame])

  const handleNewGame = useCallback(() => {
    cancelMatchmaking('restart')
    setHasSessionStarted(false)
    setActiveView('lobby')
    resetBoardState()
  }, [cancelMatchmaking, resetBoardState])

  const handleBeginQuickMatch = useCallback(() => {
    resetBoardState()
    setHasSessionStarted(true)
    beginQuickMatch()
    setActiveView('board')
  }, [beginQuickMatch, resetBoardState])

  const handleBeginBotMatch = useCallback(() => {
    resetBoardState()
    setHasSessionStarted(true)
    startBotMatch()
    setActiveView('board')
  }, [resetBoardState, startBotMatch])

  const canPlay = matchStatus !== 'searching' && matchStatus !== 'joining'
  const isPracticeSession = matchStatus === 'idle' || matchStatus === 'inviting'
  const isAwaitingMatch = matchStatus === 'searching' || matchStatus === 'joining'
  const handleCancelMatch = useCallback(() => {
    cancelMatchmaking('user-cancel')
    resetBoardState()
    setHasSessionStarted(false)
    setActiveView('lobby')
  }, [cancelMatchmaking, resetBoardState])

  const handleBackToLobby = useCallback(() => {
    cancelMatchmaking('back-to-lobby')
    resetBoardState()
    setHasSessionStarted(false)
    setActiveView('lobby')
  }, [cancelMatchmaking, resetBoardState])
  const waitingMessage = useMemo(() => {
    if (matchStatus === 'searching') {
      if (availablePlayerLabels.length > 0) {
        return `Players queued: ${availablePlayerLabels.join(', ')}`
      }
      return 'Searching for active Base players…'
    }
    if (matchStatus === 'joining') {
      return 'Connecting to the host — sit tight.'
    }
    return null
  }, [availablePlayerLabels, matchStatus])

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

  const handlePlayerDrop = useCallback(
    (args: PieceDropHandlerArgs) => {
      clearMoveHints()
      if (matchStatus === 'searching' || matchStatus === 'joining') {
        return false
      }

      const practiceMode = matchStatus === 'idle' || matchStatus === 'inviting'
      const pieceCode = args.piece?.pieceType ?? ''
      if (!pieceCode) {
        return false
      }
      const pieceColor = pieceCode.startsWith('w') ? 'white' : 'black'
      if (!practiceMode && pieceColor !== playerColor) {
        return false
      }

      const turnColor = turn === 'w' ? 'white' : 'black'
      if (!practiceMode && turnColor !== playerColor) {
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
    [clearMoveHints, emitMove, getCurrentFen, getLatestSan, matchStatus, onPieceDrop, opponentType, playerColor, turn],
  )

  const attemptBoardMove = useCallback(
    (fromSquare: string, toSquare: string) => {
      if (!fromSquare || !toSquare) {
        return false
      }
      const legalMove = getLegalMoves().find(
        (move) => move.from === fromSquare && move.to === toSquare,
      )
      if (!legalMove) {
        return false
      }
      const moveColor = legalMove.color === 'w' ? 'white' : 'black'
      if (!isPracticeSession && moveColor !== playerColor) {
        return false
      }
      const pieceType = `${legalMove.color}${legalMove.piece.toUpperCase()}`
      return handlePlayerDrop({
        piece: {
          isSparePiece: false,
          position: fromSquare,
          pieceType,
        },
        sourceSquare: fromSquare,
        targetSquare: toSquare,
      })
    },
    [getLegalMoves, handlePlayerDrop, isPracticeSession, playerColor],
  )

  const handleSquareClick = useCallback(
    ({ square, piece }: SquareHandlerArgs) => {
      if (!square) {
        return
      }

      if (selectedSquare) {
        if (selectedSquare === square) {
          clearMoveHints()
          return
        }

        const moved = attemptBoardMove(selectedSquare, square)
        if (moved) {
          return
        }
      }

      const pieceType = piece?.pieceType ?? ''
      const isPlayerPiece = pieceType.startsWith(playerColor === 'white' ? 'w' : 'b')
      if (isPlayerPiece) {
        showMoveHints(square, 'select')
        return
      }

      clearMoveHints()
    },
    [attemptBoardMove, clearMoveHints, playerColor, selectedSquare, showMoveHints],
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
    if (typeof document === 'undefined') {
      return
    }
    const htmlStyle = document.documentElement.style
    const bodyStyle = document.body.style
    const previousHtmlOverscroll = htmlStyle.overscrollBehaviorY
    const previousBodyOverscroll = bodyStyle.overscrollBehaviorY
    htmlStyle.overscrollBehaviorY = 'contain'
    bodyStyle.overscrollBehaviorY = 'contain'
    return () => {
      htmlStyle.overscrollBehaviorY = previousHtmlOverscroll
      bodyStyle.overscrollBehaviorY = previousBodyOverscroll
    }
  }, [])

  useEffect(() => {
    if (hasSessionStarted) {
      setActiveView((current) => (current === 'lobby' ? 'board' : current))
    } else {
      setActiveView('lobby')
    }
  }, [hasSessionStarted])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const node = boardContainerRef.current ?? containerRef.current
    if (!node) {
      return
    }

    const computeBoardSize = () => {
      const boardNode = boardContainerRef.current
      if (!boardNode) {
        return
      }

      const safeInsets = context?.client?.safeAreaInsets
      const width = boardNode.getBoundingClientRect().width
      if (width <= 0) {
        return
      }

      const viewportHeight = window.innerHeight
      const headerHeight = isBoardView ? 0 : (headerRef.current?.getBoundingClientRect().height ?? 0)
      const navHeight = isBoardView ? 0 : (navRef.current?.getBoundingClientRect().height ?? 0)
      const topStripHeight = isBoardView
        ? 0
        : (topPlayerStripRef.current?.getBoundingClientRect().height ?? 0)
      const bottomStripHeight = isBoardView
        ? 0
        : (bottomPlayerStripRef.current?.getBoundingClientRect().height ?? 0)
      const controlsHeight = boardControlsRef.current?.getBoundingClientRect().height ?? 0
      const bannerHeight = mateBanner ? 36 : 0
      const paddingReserve =
        (safeInsets?.top ?? 0) +
        (safeInsets?.bottom ?? 0) +
        bannerHeight +
        (isBoardView ? 28 : 56)

      const availableHeight = Math.max(
        220,
        viewportHeight - headerHeight - navHeight - topStripHeight - bottomStripHeight - controlsHeight - paddingReserve,
      )

      const size = Math.min(width, availableHeight)
      const squareSize = Math.max(1, Math.floor(size / 8))
      const boardPixels = Math.max(200, Math.floor(Math.min(size, squareSize * 8)))

      setBoardSize(boardPixels)
    }

    computeBoardSize()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => computeBoardSize())
      observer.observe(node)
      return () => observer.disconnect()
    }

    const handleResize = () => {
      window.requestAnimationFrame(() => computeBoardSize())
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [
    context?.client?.safeAreaInsets?.bottom,
    context?.client?.safeAreaInsets?.top,
    isBoardView,
    mateBanner,
    matchStatus,
    availablePlayerLabels.length,
    hasSessionStarted,
  ])

  useEffect(() => {
    const node = boardContainerRef.current
    if (!node) {
      return
    }

    const preventScroll = (event: TouchEvent) => {
      if (event.touches.length === 1) {
        event.preventDefault()
      }
    }

    node.addEventListener('touchmove', preventScroll, { passive: false })
    return () => {
      node.removeEventListener('touchmove', preventScroll)
    }
  }, [isBoardView])

  useEffect(() => {
    if (!hasSessionStarted && history.length > 0) {
      setHasSessionStarted(true)
    }
  }, [hasSessionStarted, history.length])

  useEffect(() => {
    if (!hasSessionStarted && (matchStatus === 'matched' || matchStatus === 'bot')) {
      setHasSessionStarted(true)
    }
  }, [hasSessionStarted, matchStatus])

  useEffect(() => {
    setBoardOrientation(playerColor)
  }, [playerColor])

  useEffect(() => {
    if (opponentType !== 'bot') {
      return
    }
    if (matchStatus !== 'bot') {
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

    if (!canPlay) {
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
  }, [canPlay, history, lastCapture, playerColor])

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
  const opponentDisplayName =
    opponentType === 'human'
      ? opponentLabel ?? 'Opponent'
      : 'Base Bot'
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
      allowDragging: canPlay,
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
      canPlay,
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
    if (!hasSessionStarted) {
      return
    }
    setBoardOrientation((current) => (current === 'white' ? 'black' : 'white'))
  }

  const lobbyPanel = (
    <section className="lobby-view" aria-label="Match setup">
      <div className="lobby-header">
        <div className="lobby-header__title">
          ✨ ChessBase ✨
        </div>
        <p className="lobby-header__subtitle">
          Play lightning-fast matches on Base, or sharpen your skills against the AI.
        </p>
      </div>

      <div className="wallet-panel">
        <div className="glass-card wallet-card">
          <WalletControls />
        </div>
      </div>

      <div className="stat-highlight glass-panel" aria-live="polite">
        <div>
          <span className="text-sm text-violet-200/80">Ready players</span>
          <div className="text-2xl font-semibold">{availableMatches}</div>
        </div>
        <div>
          <span className="text-sm text-violet-200/80">Queue status</span>
          <div className="text-lg">{matchStatus === 'searching' ? 'Matching…' : 'Standby'}</div>
        </div>
        <div>
          <span className="text-sm text-violet-200/80">Leaderboard entries</span>
          <div className="text-lg">{leaderboard.length}</div>
        </div>
      </div>

      <div className="lobby-actions">
        <button
          type="button"
          onClick={handleBeginQuickMatch}
          className="action-card"
          disabled={matchStatus === 'searching' || matchStatus === 'joining'}
        >
          <div className="action-card__header">
            <div>
              <div className="action-card__title">Quick match</div>
              <div className="action-card__meta">Battle a live Base player</div>
            </div>
            <span className="pill-chip">⚔️ PVP</span>
          </div>
          <p className="text-sm text-violet-200/80">
            {availableMatches > 0
              ? `Players in queue: ${availablePlayerLabels.slice(0, 3).join(', ')}`
              : 'No players waiting yet — be the first to join!'}
          </p>
          <div className="neon-button mt-auto text-center py-3 rounded-2xl text-base font-semibold">
            {matchStatus === 'searching'
              ? 'Searching for opponent…'
              : availableMatches > 0
              ? `Join match (${availableMatches})`
              : 'Start matchmaking'}
          </div>
        </button>

        <button
          type="button"
          onClick={handleBeginBotMatch}
          className="action-card"
        >
          <div className="action-card__header">
            <div>
              <div className="action-card__title">Base Bot</div>
              <div className="action-card__meta">Warm up against the AI</div>
            </div>
            <span className="pill-chip pill-chip-active text-sm">
              {botDifficulty.charAt(0).toUpperCase() + botDifficulty.slice(1)}
            </span>
          </div>
          <p className="text-sm text-violet-200/80">
            Choose your challenge level and keep your tactics sharp.
          </p>
          <div className="difficulty-row">
            <div className="bot-difficulty" role="group" aria-label="Bot difficulty">
              {(['easy', 'medium', 'hard'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`bot-difficulty__option pill-chip${botDifficulty === level ? ' pill-chip-active' : ''}`}
                  onClick={() => setBotDifficulty(level)}
                  aria-pressed={botDifficulty === level}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="neon-button mt-auto text-center py-3 rounded-2xl text-base font-semibold">
            Start bot match
          </div>
        </button>
      </div>

      <div className="glass-card">
        <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
          <span>👥</span> Active players
        </h3>
        {availablePlayerLabels.length > 0 ? (
          <ul className="panel-list">
            {availablePlayerLabels.map((label, index) => (
              <li key={`${label}-${index}`} className="panel-list__item">
                <span className="panel-list__bullet">•</span>
                {label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-violet-200/80">No live players in queue yet.</p>
        )}
      </div>

      <div className="glass-card">
        <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
          <span>🏆</span> Leaderboard snapshot
        </h3>
        <Leaderboard entries={leaderboard} variant="embedded" />
      </div>
    </section>
  )

  const renderMovesPanel = () => (
    <section className="timeline timeline--page" aria-label="Move log">
      <h2>Move log</h2>
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
  )

  const renderCapturesPanel = () => (
    <section className="ledger ledger--page" aria-label="Capture ledger">
      <div className="ledger__header">
        <h2>Capture ledger</h2>
        <span className="ledger__summary-pill">{captureLog.length}</span>
      </div>
      {captureLog.length > 0 ? (
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
      ) : (
        <p className="ledger__empty">No onchain captures yet — claim a piece to light up Base.</p>
      )}
    </section>
  )

  const renderLeaderboardPanel = () => (
    <section className="leaderboard-panel" aria-label="Leaderboard">
      <h2>Current standings</h2>
      <Leaderboard entries={leaderboard} variant="embedded" />
    </section>
  )

  const boardPanel = (
    <section className="board-layout" aria-label="Chess board">
      <div className="board-layout__main">
        <div className="glass-card board-shell">
          <div className="player-strip player-strip--overlay player-strip--top" ref={topPlayerStripRef}>
            <div className="player-strip__info">
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

          <div className="board-card__surface">
            <div
              className={`board-card__board${canPlay ? '' : ' board-card__board--locked'}`}
              ref={boardContainerRef}
            >
              <Chessboard options={chessboardOptions} />
              {isAwaitingMatch ? (
                <div className="board-card__starter" role="status">
                  <span className="board-card__starter-eyebrow">
                    {matchStatus === 'searching' ? 'Matchmaking' : 'Connecting'}
                  </span>
                  <h3>
                    {matchStatus === 'searching'
                      ? 'Looking for another Base player…'
                      : 'Joining the board…'}
                  </h3>
                  {waitingMessage ? <p>{waitingMessage}</p> : null}
                  {matchStatus === 'searching' && availablePlayerLabels.length > 0 ? (
                    <div className="board-card__queue">
                      <span className="board-card__queue-title">Players ready right now</span>
                      <ul>
                        {availablePlayerLabels.map((label, index) => (
                          <li key={`${label}-${index}`}>{label}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleCancelMatch}
                    className="board-card__starter-cancel"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="player-strip player-strip--overlay player-strip--bottom" ref={bottomPlayerStripRef}>
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

          <div className="board-card__controls glass-panel" role="group" aria-label="Board actions" ref={boardControlsRef}>
            <button type="button" className="neon-button" onClick={handleNewGame}>
              New game
            </button>
            {hasSessionStarted ? (
              <>
                <button type="button" className="glass-panel" onClick={undoMove} disabled={!history.length}>
                  Undo move
                </button>
                <button type="button" className="glass-panel" onClick={toggleOrientation}>
                  Flip board
                </button>
                <button type="button" className="glass-panel" onClick={handleBackToLobby}>
                  Back
                </button>
              </>
            ) : null}
          </div>

          {mateBanner ? (
            <div
              className={`status-banner board-card__banner board-card__banner--${mateBanner.variant} status-banner--${mateBanner.variant === 'win' ? 'win' : mateBanner.variant === 'loss' ? 'loss' : 'draw'}`}
              role="status"
            >
              {mateBanner.text}
            </div>
          ) : null}

          <p className="board-card__note" aria-live="polite">
            {lastCaptureCopy}
          </p>
        </div>
      </div>

      <aside className="board-layout__side">
        <div className="glass-panel panel-stack__item">{renderMovesPanel()}</div>
        <div className="glass-panel panel-stack__item">{renderCapturesPanel()}</div>
        <div className="glass-panel panel-stack__item">{renderLeaderboardPanel()}</div>
      </aside>
    </section>
  )

  const navItems: Array<{ id: AppView; label: string; badge?: string }> = [
    { id: 'board', label: 'Board' },
    {
      id: 'moves',
      label: 'Moves',
      badge: moveRows.length > 0 ? `${moveRows.length}` : undefined,
    },
    {
      id: 'captures',
      label: 'Captures',
      badge: captureLog.length > 0 ? `${captureLog.length}` : undefined,
    },
    { id: 'leaderboard', label: 'Leaderboard' },
  ]

  return (
    <div className="app-shell" style={containerStyle} ref={containerRef}>
      {hasSessionStarted ? (
        <>
          <header className="glass-card board-header" ref={headerRef}>
            <div className="board-header__title">♞ {APP_NAME}</div>
            <div className="board-header__wallet">
              <WalletControls />
            </div>
          </header>

          <nav className="glass-panel board-nav" aria-label="App sections" ref={navRef}>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`board-nav__button${activeView === item.id ? ' board-nav__button--active' : ''}`}
                onClick={() => setActiveView(item.id)}
                aria-current={activeView === item.id ? 'page' : undefined}
              >
                <span>{item.label}</span>
                {item.badge ? <span className="board-nav__badge">{item.badge}</span> : null}
              </button>
            ))}
          </nav>

          {activeView === 'board' ? boardPanel : null}
          {activeView === 'moves' ? (
            <div className="glass-panel standalone-panel" aria-label="Move history">
              {renderMovesPanel()}
            </div>
          ) : null}
          {activeView === 'captures' ? (
            <div className="glass-panel standalone-panel" aria-label="Capture ledger">
              {renderCapturesPanel()}
            </div>
          ) : null}
          {activeView === 'leaderboard' ? (
            <div className="glass-panel standalone-panel" aria-label="Leaderboard">
              {renderLeaderboardPanel()}
            </div>
          ) : null}
        </>
      ) : (
        lobbyPanel
      )}

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
