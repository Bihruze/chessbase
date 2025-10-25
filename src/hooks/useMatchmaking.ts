import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type MatchStatus = 'idle' | 'inviting' | 'joining' | 'searching' | 'matched' | 'bot'

type MatchmakingMessage =
  | {
      type: 'match-join'
      matchId: string
      guestId: string
    }
  | {
      type: 'match-confirm'
      matchId: string
      hostId: string
      guestId: string
    }
  | {
      type: 'match-cancel'
      matchId: string
      reason?: string
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

type QueueEntry = {
  id: string
  createdAt: number
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
  beginQuickMatch: () => void
  cancelMatchmaking: (reason?: string) => void
  createInvite: () => string
  joinInvite: (matchId: string) => void
  availableMatches: number
}

type UseMatchmakingOptions = {
  onOpponentMove: (san: string, fen: string) => void
}

const QUEUE_KEY = 'chessBase::matchQueue'
const MATCH_CHANNEL = 'chessBase::matchChannel'
const QUEUE_TTL_MS = 60_000

const generateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`

const pruneQueue = (entries: QueueEntry[]) => {
  const now = Date.now()
  return entries.filter((entry) => now - entry.createdAt < QUEUE_TTL_MS)
}

const readQueue = (): QueueEntry[] => {
  if (typeof window === 'undefined') {
    return []
  }
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as QueueEntry[]
    return pruneQueue(parsed)
  } catch (error) {
    console.warn('match queue parse error', error)
    return []
  }
}

const writeQueue = (entries: QueueEntry[]) => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(entries))
  } catch (error) {
    console.warn('match queue write error', error)
  }
}

const clearQueueEntry = (id: string) => {
  writeQueue(
    readQueue().filter((entry) => entry.id !== id),
  )
}

const createInitialState = (): MatchmakingState => ({
  status: 'idle',
  matchId: null,
  playerColor: 'white',
  opponentType: 'bot',
  opponentId: null,
  isHost: false,
})

export function useMatchmaking({ onOpponentMove }: UseMatchmakingOptions): MatchmakingResult {
  const [state, setState] = useState<MatchmakingState>(() => createInitialState())
  const [availableMatches, setAvailableMatches] = useState(0)
  const selfIdRef = useRef<string>('')
  const channelRef = useRef<BroadcastChannel | null>(null)
  const cleanupRef = useRef<() => void>(() => {})
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const syncAvailableMatches = useCallback(() => {
    if (typeof window === 'undefined') {
      setAvailableMatches(0)
      return
    }
    const entries = readQueue()
    const selfId = selfIdRef.current
    setAvailableMatches(entries.filter((entry) => entry.id !== selfId).length)
  }, [])

  useEffect(() => {
    syncAvailableMatches()
    if (typeof window === 'undefined') {
      return
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === QUEUE_KEY) {
        syncAvailableMatches()
      }
    }
    const intervalId = window.setInterval(syncAvailableMatches, 5000)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('storage', handleStorage)
    }
  }, [syncAvailableMatches])

  const cancelMatchmaking = useCallback(
    (reason?: string) => {
      const current = stateRef.current
      if (!current.matchId) {
        setState(createInitialState())
        return
      }
      if (current.status === 'searching' && current.isHost) {
        clearQueueEntry(current.matchId)
        syncAvailableMatches()
      }
      if (current.status === 'inviting' || current.status === 'joining' || current.status === 'searching' || current.status === 'matched') {
        channelRef.current?.postMessage({ type: 'match-cancel', matchId: current.matchId, reason })
      }
      setState(createInitialState())
    },
    [syncAvailableMatches],
  )

  const startBotMatch = useCallback(() => {
    const nextMatchId = generateId()
    if (stateRef.current.status !== 'idle' && stateRef.current.status !== 'bot') {
      cancelMatchmaking('switch-to-bot')
    }
    setState({
      status: 'bot',
      matchId: nextMatchId,
      playerColor: 'white',
      opponentType: 'bot',
      opponentId: 'base-bot',
      isHost: true,
    })
  }, [cancelMatchmaking])

  const setMatched = useCallback(
    (params: { matchId: string; playerColor: 'white' | 'black'; opponentId: string; isHost: boolean }) => {
      if (params.isHost) {
        clearQueueEntry(selfIdRef.current)
        syncAvailableMatches()
      }
      setState({
        status: 'matched',
        matchId: params.matchId,
        playerColor: params.playerColor,
        opponentType: 'human',
        opponentId: params.opponentId,
        isHost: params.isHost,
      })
    },
    [syncAvailableMatches],
  )

  useEffect(() => {
    selfIdRef.current = generateId()
    if (typeof BroadcastChannel === 'undefined') {
      return
    }
    const channel = new BroadcastChannel(MATCH_CHANNEL)
    channelRef.current = channel

    const handleMessage = (event: MessageEvent<MatchmakingMessage>) => {
      const message = event.data
      const current = stateRef.current
      const selfId = selfIdRef.current
      if (!message) {
        return
      }

      if (message.type === 'match-join') {
        if (!current.matchId || current.matchId !== message.matchId) {
          return
        }
        if (!current.isHost || current.status === 'matched') {
          return
        }
        setMatched({
          matchId: message.matchId,
          playerColor: 'white',
          opponentId: message.guestId,
          isHost: true,
        })
        channel.postMessage({
          type: 'match-confirm',
          matchId: message.matchId,
          hostId: selfId,
          guestId: message.guestId,
        })
        return
      }

      if (message.type === 'match-confirm') {
        if (message.guestId !== selfId) {
          return
        }
        setState({
          status: 'matched',
          matchId: message.matchId,
          playerColor: 'black',
          opponentType: 'human',
          opponentId: message.hostId,
          isHost: false,
        })
        return
      }

      if (message.type === 'match-cancel') {
        if (!current.matchId || current.matchId !== message.matchId) {
          return
        }
        setState(createInitialState())
        syncAvailableMatches()
        return
      }

      if (message.type === 'move') {
        if (current.matchId !== message.matchId) {
          return
        }
        if (message.payload.senderId === selfId) {
          return
        }
        onOpponentMove(message.payload.san, message.payload.fen)
      }
    }

    channel.addEventListener('message', handleMessage)

    const cleanup = () => {
      const current = stateRef.current
      if (current.matchId && current.status !== 'idle' && current.status !== 'bot') {
        channel.postMessage({ type: 'match-cancel', matchId: current.matchId, reason: 'disconnect' })
      }
      if (current.status === 'searching' && current.matchId && current.isHost) {
        clearQueueEntry(current.matchId)
        syncAvailableMatches()
      }
      channel.removeEventListener('message', handleMessage)
      channel.close()
    }

    cleanupRef.current = cleanup

    return cleanup
  }, [onOpponentMove, setMatched, syncAvailableMatches])

  useEffect(() => () => cleanupRef.current(), [])

  const beginQuickMatch = useCallback(() => {
    const selfId = selfIdRef.current
    const queue = readQueue()
    const others = queue.filter((entry) => entry.id !== selfId)
    if (others.length > 0) {
      const hostEntry = others[0]
      clearQueueEntry(hostEntry.id)
      setState({
        status: 'joining',
        matchId: hostEntry.id,
        playerColor: 'black',
        opponentType: 'human',
        opponentId: hostEntry.id,
        isHost: false,
      })
      channelRef.current?.postMessage({
        type: 'match-join',
        matchId: hostEntry.id,
        guestId: selfId,
      })
    } else {
      const createdAt = Date.now()
      const trimmed = queue.filter((entry) => entry.id !== selfId)
      writeQueue([...trimmed, { id: selfId, createdAt }])
      setState({
        status: 'searching',
        matchId: selfId,
        playerColor: 'white',
        opponentType: 'human',
        opponentId: null,
        isHost: true,
      })
    }
    syncAvailableMatches()
  }, [syncAvailableMatches])

  const createInvite = useCallback(() => {
    if (stateRef.current.status !== 'idle') {
      cancelMatchmaking('new-invite')
    }
    const matchId = generateId()
    setState({
      status: 'inviting',
      matchId,
      playerColor: 'white',
      opponentType: 'human',
      opponentId: null,
      isHost: true,
    })
    return matchId
  }, [cancelMatchmaking])

  const joinInvite = useCallback(
    (matchId: string) => {
      if (!matchId) {
        return
      }
      if (stateRef.current.status !== 'idle') {
        cancelMatchmaking('join-invite')
      }
      setState({
        status: 'joining',
        matchId,
        playerColor: 'black',
        opponentType: 'human',
        opponentId: null,
        isHost: false,
      })
      channelRef.current?.postMessage({
        type: 'match-join',
        matchId,
        guestId: selfIdRef.current,
      })
    },
    [cancelMatchmaking],
  )

  const emitMove = useCallback((san: string, fen: string) => {
    const current = stateRef.current
    if (!current.matchId || current.status !== 'matched' || current.opponentType !== 'human') {
      return
    }
    const payload = {
      san,
      fen,
      timestamp: Date.now(),
      senderId: selfIdRef.current,
    }
    channelRef.current?.postMessage({ type: 'move', matchId: current.matchId, payload })
  }, [])

  const value = useMemo<MatchmakingResult>(
    () => ({
      status: state.status,
      matchId: state.matchId,
      playerColor: state.playerColor,
      opponentType: state.opponentType,
      opponentId: state.opponentId,
      isHost: state.isHost,
      emitMove,
      startBotMatch,
      beginQuickMatch,
      cancelMatchmaking,
      createInvite,
      joinInvite,
      availableMatches,
    }),
    [
      availableMatches,
      cancelMatchmaking,
      emitMove,
      startBotMatch,
      beginQuickMatch,
      createInvite,
      joinInvite,
      state.isHost,
      state.matchId,
      state.opponentId,
      state.opponentType,
      state.playerColor,
      state.status,
    ],
  )

  return value
}
