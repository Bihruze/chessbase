import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type MatchStatus = 'searching' | 'matched' | 'bot'

type MatchmakingMessage =
  | {
      type: 'match-join'
      matchId: string
      opponentId: string
    }
  | {
      type: 'match-confirm'
      matchId: string
      opponentId: string
    }
  | {
      type: 'move'
      matchId: string
      payload: {
        san: string
        fen: string
        timestamp: number
        senderId: string
      }
    }

export type MatchmakingState = {
  status: MatchStatus
  matchId: string | null
  playerColor: 'white' | 'black'
  opponentType: 'human' | 'bot'
  opponentId: string | null
  isHost: boolean
}

export type MatchmakingResult = MatchmakingState & {
  emitMove: (san: string, fen: string) => void
  startBotMatch: () => void
}

type UseMatchmakingOptions = {
  onOpponentMove: (san: string, fen: string) => void
  queueTimeoutMs?: number
}

const QUEUE_KEY = 'chessBase::matchQueue'
const MATCH_CHANNEL = 'chessBase::matchChannel'

const readQueue = () => {
  if (typeof window === 'undefined') return [] as Array<{ id: string; createdAt: number }>
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    if (!raw) return [] as Array<{ id: string; createdAt: number }>
    const parsed = JSON.parse(raw) as Array<{ id: string; createdAt: number }>
    const now = Date.now()
    return parsed.filter((entry) => now - entry.createdAt < 60_000)
  } catch (error) {
    console.warn('match queue parse error', error)
    return []
  }
}

const writeQueue = (entries: Array<{ id: string; createdAt: number }>) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(entries))
  } catch (error) {
    console.warn('match queue write error', error)
  }
}

export function useMatchmaking({ onOpponentMove, queueTimeoutMs = 7000 }: UseMatchmakingOptions): MatchmakingResult {
  const [state, setState] = useState<MatchmakingState>({
    status: 'searching',
    matchId: null,
    playerColor: 'white',
    opponentType: 'bot',
    opponentId: null,
    isHost: true,
  })
  const selfIdRef = useRef<string>('')
  const channelRef = useRef<BroadcastChannel | null>(null)
  const cleanupRef = useRef<() => void>(() => {})
  const timeoutRef = useRef<number | null>(null)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const setMatched = useCallback(
    (params: {
      matchId: string
      playerColor: 'white' | 'black'
      opponentId: string
      isHost: boolean
    }) => {
      setState({
        status: 'matched',
        matchId: params.matchId,
        playerColor: params.playerColor,
        opponentType: 'human',
        opponentId: params.opponentId,
        isHost: params.isHost,
      })
    },
    [],
  )

  const removeFromQueue = useCallback((id: string) => {
    writeQueue(
      readQueue().filter((entry) => entry.id !== id),
    )
  }, [])

  const startBotMatch = useCallback(() => {
    const matchId = selfIdRef.current || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
    removeFromQueue(selfIdRef.current)
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
    }
    setState({
      status: 'bot',
      matchId,
      playerColor: 'white',
      opponentType: 'bot',
      opponentId: 'base-bot',
      isHost: true,
    })
  }, [removeFromQueue])

  useEffect(() => {
    selfIdRef.current = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
    const channel = new BroadcastChannel(MATCH_CHANNEL)
    channelRef.current = channel

    const handleMessage = (event: MessageEvent<MatchmakingMessage>) => {
      const message = event.data
      const selfId = selfIdRef.current
      const currentState = stateRef.current
      if (!message) return

      if (message.type === 'match-join') {
        if (currentState.matchId || message.matchId !== selfId) {
          return
        }
        // someone joined our queue entry
        setMatched({ matchId: message.matchId, playerColor: 'white', opponentId: message.opponentId, isHost: true })
        removeFromQueue(selfId)
        channel.postMessage({ type: 'match-confirm', matchId: message.matchId, opponentId: selfId })
        window.clearTimeout(timeoutRef.current ?? undefined)
      }

      if (message.type === 'match-confirm') {
        if (currentState.matchId || message.opponentId !== selfId) {
          return
        }
        setMatched({ matchId: message.matchId, playerColor: 'black', opponentId: message.matchId, isHost: false })
        window.clearTimeout(timeoutRef.current ?? undefined)
      }

      if (message.type === 'move') {
        if (currentState.matchId !== message.matchId) {
          return
        }
        if (message.payload.senderId === selfId) {
          return
        }
        onOpponentMove(message.payload.san, message.payload.fen)
      }
    }

    channel.addEventListener('message', handleMessage)

    cleanupRef.current = () => {
      channel.removeEventListener('message', handleMessage)
      channel.close()
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
      removeFromQueue(selfIdRef.current)
    }

    const queue = typeof window === 'undefined' ? [] : readQueue()
    const available = queue.find((entry) => entry.id !== selfIdRef.current)

    if (available) {
      // join existing match as black
      removeFromQueue(available.id)
      setMatched({ matchId: available.id, playerColor: 'black', opponentId: available.id, isHost: false })
      channel.postMessage({ type: 'match-join', matchId: available.id, opponentId: selfIdRef.current })
      return () => cleanupRef.current()
    }

    // create new queue entry as host/white
    const createdAt = Date.now()
    if (typeof window !== 'undefined') {
      writeQueue([...queue.filter((entry) => entry.id !== selfIdRef.current), { id: selfIdRef.current, createdAt }])
    }

    timeoutRef.current = window.setTimeout(() => {
      startBotMatch()
    }, queueTimeoutMs)

    return () => cleanupRef.current()
  }, [onOpponentMove, queueTimeoutMs, removeFromQueue, setMatched, startBotMatch, state.matchId])

  const emitMove = useCallback(
    (san: string, fen: string) => {
      if (!channelRef.current || !stateRef.current.matchId || stateRef.current.status === 'bot') {
        return
      }
      const message: MatchmakingMessage = {
        type: 'move',
        matchId: stateRef.current.matchId,
        payload: { san, fen, timestamp: Date.now(), senderId: selfIdRef.current },
      }
      channelRef.current.postMessage(message)
    },
    [],
  )

  useEffect(() => () => cleanupRef.current(), [])

  const value = useMemo<MatchmakingResult>(() => ({
    status: state.status,
    matchId: state.matchId,
    playerColor: state.playerColor,
    opponentType: state.opponentType,
    opponentId: state.opponentId,
    isHost: state.isHost,
    emitMove,
    startBotMatch,
  }), [emitMove, startBotMatch, state.isHost, state.matchId, state.opponentId, state.opponentType, state.playerColor, state.status])

  return value
}
