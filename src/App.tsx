import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import type { PieceDropHandlerArgs, PieceHandlerArgs, SquareHandlerArgs } from 'react-chessboard'
import { useMiniKit, useOpenUrl } from '@coinbase/onchainkit/minikit'
import { useAccount, usePublicClient } from 'wagmi'
import { Transaction, TransactionButton, TransactionToast } from '@coinbase/onchainkit/transaction'
import { encodeFunctionData, parseGwei, type Hex } from 'viem'
import { useChessGame } from './hooks/useChessGame'
import type { CaptureEvent } from './hooks/useChessGame'
import { Leaderboard } from './components/Leaderboard'
import { useLeaderboard } from './hooks/useLeaderboard'
import { useMatchmaking } from './hooks/useMatchmaking'
import { APP_NAME, APP_URL, DEFAULT_CAPTURE_CONTRACT } from './config/constants'
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
  const [shareHint, setShareHint] = useState<string | null>(null)
  const [mateBanner, setMateBanner] = useState<
    { text: string; variant: 'win' | 'loss' | 'draw' } | null
  >(null)
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [moveHints, setMoveHints] = useState<Record<string, CSSProperties>>({})
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null)
  const [hasSessionStarted, setHasSessionStarted] = useState(false)
  const [activeView, setActiveView] = useState<AppView>('lobby')
  const [pendingInviteId, setPendingInviteId] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const captureTarget = (env.captureTarget ?? DEFAULT_CAPTURE_CONTRACT) as Hex
  const containerRef = useRef<HTMLDivElement | null>(null)
  const boardContainerRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLElement | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const topPlayerStripRef = useRef<HTMLDivElement | null>(null)
  const bottomPlayerStripRef = useRef<HTMLDivElement | null>(null)
  const boardControlsRef = useRef<HTMLDivElement | null>(null)
  const autoJoinInviteRef = useRef(false)
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
    createInvite,
    joinInvite,
    availableMatches,
    matchId,
    opponentLabel,
    availablePlayerLabels,
  } = useMatchmaking({ onOpponentMove: handleOpponentMove, playerLabel: playerProfileName })
  const botTurnColor = playerColor === 'white' ? 'b' : 'w'
  const baseShareUrl = useMemo(() => {
    const envUrl = APP_URL && APP_URL !== 'https://example.com' ? APP_URL.trim() : null
    if (envUrl && envUrl.length > 0) {
      return envUrl.replace(/\/$/, '')
    }
    if (typeof window === 'undefined' || !window.location) {
      return 'https://example.com'
    }
    const { origin, pathname } = window.location
    return `${origin}${pathname}`
  }, [])
  const buildInviteLink = useCallback(
    (id: string) => `${baseShareUrl}?invite=${id}`,
    [baseShareUrl],
  )
  const openUrl = useOpenUrl({
    fallback: (url: string) => {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    },
  })

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
    setPendingInviteId(null)
    setInviteLink(null)
    setHasSessionStarted(false)
    setShareHint(null)
    setActiveView('lobby')
    resetBoardState()
  }, [cancelMatchmaking, resetBoardState])

  const handleBeginInvite = useCallback(() => {
    resetBoardState()
    const inviteId = createInvite()
    const link = buildInviteLink(inviteId)
    setPendingInviteId(inviteId)
    setInviteLink(link)
    setShareHint(null)
    setHasSessionStarted(true)
    setActiveView('board')
  }, [buildInviteLink, createInvite, resetBoardState])

  const handleBeginQuickMatch = useCallback(() => {
    resetBoardState()
    setPendingInviteId(null)
    setInviteLink(null)
    setShareHint(null)
    setHasSessionStarted(true)
    beginQuickMatch()
    setActiveView('board')
  }, [beginQuickMatch, resetBoardState])

  const handleBeginBotMatch = useCallback(() => {
    resetBoardState()
    setPendingInviteId(null)
    setInviteLink(null)
    setShareHint(null)
    setHasSessionStarted(true)
    startBotMatch()
    setActiveView('board')
  }, [resetBoardState, startBotMatch])

  const canPlay = matchStatus === 'matched' || matchStatus === 'bot'
  const isAwaitingMatch =
    matchStatus === 'inviting' || matchStatus === 'searching' || matchStatus === 'joining'
  const handleCancelMatch = useCallback(() => {
    cancelMatchmaking('user-cancel')
    setPendingInviteId(null)
    setInviteLink(null)
    setShareHint(null)
    resetBoardState()
    setHasSessionStarted(false)
    setActiveView('lobby')
  }, [cancelMatchmaking, resetBoardState])
  const waitingMessage = useMemo(() => {
    if (matchStatus === 'inviting') {
      return 'Share your invite link so a friend can join as black.'
    }
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

  const resolveShareUrl = useCallback(() => {
    if (matchStatus === 'inviting' && matchId) {
      return { url: buildInviteLink(matchId), isInvite: true }
    }
    if (pendingInviteId && inviteLink) {
      return { url: inviteLink, isInvite: true }
    }
    return { url: baseShareUrl, isInvite: false }
  }, [baseShareUrl, buildInviteLink, inviteLink, matchId, matchStatus, pendingInviteId])

  const copyText = useCallback(async (value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value)
        return true
      } catch (error) {
        console.warn('clipboard write failed', error)
      }
    }

    if (typeof document === 'undefined') {
      return false
    }

    try {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const success = document.execCommand?.('copy') ?? false
      document.body.removeChild(textarea)
      return success
    } catch (error) {
      console.warn('fallback copy failed', error)
      return false
    }
  }, [])

  const handleShare = useCallback(async () => {
    const { url: shareUrl, isInvite } = resolveShareUrl()
    if (!hasSessionStarted && !isInvite) {
      setShareHint('Pick a mode to generate a match link.')
      return
    }

    const shareText = isInvite
      ? `♟️ Challenge me on ${APP_NAME}! Join my board:`
      : `♟️ Playing ${APP_NAME} on Base — take your shot!`

    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: APP_NAME,
          text: shareText,
          url: shareUrl,
        })
        setShareHint(isInvite ? 'Invite shared via device sheet' : 'Shared via device sheet')
        return
      }

      if (await copyText(shareUrl)) {
        setShareHint(isInvite ? 'Invite link copied to clipboard' : 'Game link copied to clipboard')
        return
      }

      setShareHint(isInvite ? `Invite link: ${shareUrl}` : `Share this link manually: ${shareUrl}`)
    } catch (error) {
      console.error('share failed', error)
      setShareHint('Sharing failed — try again later')
    }
  }, [copyText, hasSessionStarted, resolveShareUrl])

  const handleCopyInvite = useCallback(async () => {
    const { url: shareUrl, isInvite } = resolveShareUrl()
    const copied = await copyText(shareUrl)
    if (copied) {
      setShareHint(isInvite ? 'Invite link copied to clipboard' : 'Game link copied to clipboard')
      return
    }
    setShareHint(isInvite ? `Invite link: ${shareUrl}` : `Copy manually: ${shareUrl}`)
  }, [copyText, resolveShareUrl])

  const handleFarcasterShare = useCallback(() => {
    const { url: shareUrl, isInvite } = resolveShareUrl()
    const shareLine = isInvite
      ? `♟️ Challenge me on ${APP_NAME}!`
      : `♟️ Playing ${APP_NAME} on Base — take your shot!`
    const composeUrl = new URL('https://warpcast.com/~/compose')
    composeUrl.searchParams.set('text', `${shareLine}\n${shareUrl}`)
    openUrl(composeUrl.toString())
    setShareHint('Opening Farcaster compose…')
  }, [openUrl, resolveShareUrl])

  useEffect(() => {
    if (matchStatus !== 'inviting') {
      if (pendingInviteId || inviteLink) {
        setPendingInviteId(null)
        setInviteLink(null)
      }
      return
    }
    if (matchId && matchId !== pendingInviteId) {
      const link = buildInviteLink(matchId)
      setPendingInviteId(matchId)
      setInviteLink(link)
    }
  }, [buildInviteLink, inviteLink, matchId, matchStatus, pendingInviteId])

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
    if (autoJoinInviteRef.current) {
      return
    }
    const params = new URLSearchParams(window.location.search)
    const inviteParam = params.get('invite')
    if (!inviteParam) {
      return
    }
    autoJoinInviteRef.current = true
    resetBoardState()
    joinInvite(inviteParam)
    setHasSessionStarted(true)
    setActiveView('board')
    const url = new URL(window.location.href)
    params.delete('invite')
    url.search = params.toString()
    window.history.replaceState({}, document.title, url.toString())
  }, [joinInvite, resetBoardState, setActiveView])

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
      const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0
      const navHeight = navRef.current?.getBoundingClientRect().height ?? 0
      const topStripHeight = topPlayerStripRef.current?.getBoundingClientRect().height ?? 0
      const bottomStripHeight =
        bottomPlayerStripRef.current?.getBoundingClientRect().height ?? 0
      const controlsHeight = boardControlsRef.current?.getBoundingClientRect().height ?? 0
      const hintHeight = shareHint ? 28 : 0
      const bannerHeight = mateBanner ? 36 : 0
      const paddingReserve =
        (safeInsets?.top ?? 0) + (safeInsets?.bottom ?? 0) + hintHeight + bannerHeight + 56

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
  }, [context?.client?.safeAreaInsets?.bottom, context?.client?.safeAreaInsets?.top, mateBanner, shareHint, matchStatus, availablePlayerLabels.length, hasSessionStarted])

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

  const handlePlayerDrop = useCallback(
    (args: PieceDropHandlerArgs) => {
      clearMoveHints()
      if (matchStatus !== 'matched' && matchStatus !== 'bot') {
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
    [clearMoveHints, emitMove, getCurrentFen, getLatestSan, matchStatus, onPieceDrop, opponentType, playerColor, turn],
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

  const shareButtonDisabled = matchStatus === 'searching' || matchStatus === 'joining'

  const lobbyPanel = (
    <section className="board-card lobby-card" aria-label="Match setup">
      <div className="lobby-card__content">
        <span className="lobby-card__eyebrow">Choose a mode</span>
        <h2>Invite friends or battle Base players.</h2>
        <p>Select how you want to start your next chess session.</p>
        <div className="board-card__starter-actions">
          <button
            type="button"
            onClick={handleBeginInvite}
            className="board-card__starter-button"
          >
            Invite a friend
          </button>
          <button
            type="button"
            onClick={handleBeginQuickMatch}
            className="board-card__starter-button"
            disabled={matchStatus === 'searching' || matchStatus === 'joining'}
          >
            {availableMatches > 0
              ? `Join active player (${availableMatches})`
              : 'Join active player'}
          </button>
          <button
            type="button"
            onClick={handleBeginBotMatch}
            className="board-card__starter-button"
          >
            Play Base Bot
          </button>
        </div>
        <p className="lobby-card__note">
          {availableMatches > 0
            ? `Ready players waiting: ${availableMatches}. Jump in and claim white or black.`
            : 'Share an invite or queue up to find a live opponent.'}
        </p>
        <div className="lobby-card__list" aria-live="polite">
          {availablePlayerLabels.length > 0 ? (
            <>
              <span className="lobby-card__list-title">Active players</span>
              <ul>
                {availablePlayerLabels.map((label, index) => (
                  <li key={`${label}-${index}`}>{label}</li>
                ))}
              </ul>
            </>
          ) : (
            <span className="lobby-card__list-empty">No live players in queue yet.</span>
          )}
        </div>
      </div>
    </section>
  )

  const boardPanel = (
    <section className="board-card board-card--full" aria-label="Chess board">
      <div className="player-strip" ref={topPlayerStripRef}>
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

      <div
        className={`board-card__board${canPlay ? '' : ' board-card__board--locked'}`}
        ref={boardContainerRef}
      >
        <Chessboard options={chessboardOptions} />
        {isAwaitingMatch ? (
          <div className="board-card__starter" role="status">
            <span className="board-card__starter-eyebrow">
              {matchStatus === 'inviting' ? 'Waiting for your friend' : 'Matchmaking'}
            </span>
            <h3>
              {matchStatus === 'inviting'
                ? 'Send the invite link to begin.'
                : matchStatus === 'searching'
                  ? 'Looking for another Base player…'
                  : 'Joining the board…'}
            </h3>
            {waitingMessage ? <p>{waitingMessage}</p> : null}
            {matchStatus === 'inviting' && inviteLink ? (
              <div className="board-card__invite">
                <code>{inviteLink}</code>
                <div className="board-card__invite-actions">
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="board-card__starter-button"
                  >
                    Copy invite link
                  </button>
                  <button
                    type="button"
                    onClick={handleFarcasterShare}
                    className="board-card__starter-button board-card__starter-button--ghost"
                  >
                    Share on Farcaster
                  </button>
                </div>
              </div>
            ) : null}
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
            <button type="button" onClick={handleCancelMatch} className="board-card__starter-cancel">
              Cancel
            </button>
          </div>
        ) : null}
      </div>

      <div className="board-card__controls" role="group" aria-label="Board actions" ref={boardControlsRef}>
        <button type="button" onClick={handleNewGame}>
          New game
        </button>
        {hasSessionStarted ? (
          <>
            <button
              type="button"
              className="board-card__share"
              onClick={handleShare}
              disabled={shareButtonDisabled}
            >
              Share game
            </button>
            <button
              type="button"
              className="board-card__share board-card__share--secondary"
              onClick={handleFarcasterShare}
              disabled={shareButtonDisabled}
            >
              Share on Farcaster
            </button>
            <button type="button" onClick={undoMove} disabled={!history.length}>
              Undo move
            </button>
            <button type="button" onClick={toggleOrientation}>
              Flip board
            </button>
          </>
        ) : null}
      </div>
      {mateBanner ? (
        <div
          className={`board-card__banner board-card__banner--${mateBanner.variant}`}
          role="status"
        >
          {mateBanner.text}
        </div>
      ) : null}

      <div className="player-strip" ref={bottomPlayerStripRef}>
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

      <p className="board-card__note" aria-live="polite">
        {lastCaptureCopy}
      </p>
      {shareHint ? (
        <p className="board-card__hint" aria-live="polite">
          {shareHint}
        </p>
      ) : null}
    </section>
  )

  const movesPanel = (
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

  const capturesPanel = (
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

  const leaderboardPanel = (
    <section className="leaderboard-panel" aria-label="Leaderboard">
      <h2>Current standings</h2>
      <Leaderboard entries={leaderboard} variant="embedded" />
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
    <div className="app" style={containerStyle}>
      <div className="app__container" ref={containerRef}>
        <header className="app__header" ref={headerRef}>
          <div className="app__title">
            <span className="app__logo" aria-hidden="true">♞</span>
            <h1>{APP_NAME}</h1>
          </div>
          <div className="app__header-wallet">
            <WalletControls />
          </div>
        </header>

        {hasSessionStarted ? (
          <nav className="app__nav" aria-label="App sections" ref={navRef}>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app__nav-button${activeView === item.id ? ' app__nav-button--active' : ''}`}
                onClick={() => setActiveView(item.id)}
                aria-current={activeView === item.id ? 'page' : undefined}
              >
                <span className="app__nav-label">{item.label}</span>
                {item.badge ? <span className="app__nav-badge">{item.badge}</span> : null}
              </button>
            ))}
          </nav>
        ) : null}

        {activeView === 'lobby' ? lobbyPanel : null}
        {activeView === 'board' ? boardPanel : null}
        {activeView === 'moves' ? movesPanel : null}
        {activeView === 'captures' ? capturesPanel : null}
        {activeView === 'leaderboard' ? leaderboardPanel : null}
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
