import { useEffect, useMemo, useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { chessBaseCapturesAbi } from '../abi/chessBaseCaptures'
import { env } from '../config/env'
import { DEFAULT_CAPTURE_CONTRACT } from '../config/constants'

export type LeaderboardEntry = {
  player: string
  totalCaptures: number
  lastMoveNumber: number
  lastCaptureAt: number
  lastSan: string
  lastSquare: string
}

type ContractLeaderboardEntry = {
  player: string
  stats: {
    totalCaptures: bigint
    lastMoveNumber: bigint
    lastCaptureAt: bigint
    lastSan: string
    lastSquare: string
  }
}

const LOCAL_KEY = 'chessBase::localLeaderboard'

const readLocal = (): LeaderboardEntry[] => {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    return JSON.parse(raw) as LeaderboardEntry[]
  } catch (error) {
    console.warn('local leaderboard parse error', error)
    return []
  }
}

const writeLocal = (entries: LeaderboardEntry[]) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(entries))
  } catch (error) {
    console.warn('local leaderboard write error', error)
  }
}

export function useLeaderboard(limit = 10) {
  const contractAddress =
    env.captureContractAddress ?? env.captureTarget ?? DEFAULT_CAPTURE_CONTRACT
  const { address } = useAccount()
  const [localEntries, setLocalEntries] = useState<LeaderboardEntry[]>(() => readLocal())

  useEffect(() => {
    setLocalEntries(readLocal())
  }, [])

  const { data: chainEntries } = useReadContract({
    abi: chessBaseCapturesAbi,
    address: contractAddress as `0x${string}` | undefined,
    functionName: 'getLeaderboard',
    args: [BigInt(limit)],
    query: {
      enabled: Boolean(contractAddress),
      refetchInterval: 30_000,
    },
  })

  const leaderboard = useMemo(() => {
    if (chainEntries && Array.isArray(chainEntries)) {
      return (chainEntries as ContractLeaderboardEntry[])
        .filter((entry): entry is ContractLeaderboardEntry => {
          return Boolean(entry && typeof entry.player === 'string' && entry.stats)
        })
        .map((entry) => ({
          player: entry.player,
          totalCaptures: Number(entry.stats.totalCaptures),
          lastMoveNumber: Number(entry.stats.lastMoveNumber),
          lastCaptureAt: Number(entry.stats.lastCaptureAt),
          lastSan: entry.stats.lastSan,
          lastSquare: entry.stats.lastSquare,
        }))
    }

    return localEntries
      .slice()
      .sort((a, b) => b.totalCaptures - a.totalCaptures)
      .slice(0, limit)
  }, [chainEntries, limit, localEntries])

  const appendLocalCapture = (entry: LeaderboardEntry) => {
    setLocalEntries((prev) => {
      const next = prev.filter((item) => item.player.toLowerCase() !== entry.player.toLowerCase())
      next.push(entry)
      writeLocal(next)
      return next
    })
  }

  const mergeChainEntry = (entry: LeaderboardEntry) => {
    const leaderboardEntries = chainEntries && Array.isArray(chainEntries)
    if (!leaderboardEntries && address && entry.player.toLowerCase() === address.toLowerCase()) {
      appendLocalCapture(entry)
    }
  }

  return {
    leaderboard,
    appendLocalCapture,
    mergeChainEntry,
  }
}
