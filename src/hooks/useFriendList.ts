import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'chessBase::friends'
const MAX_FRIENDS = 24

const normaliseHandle = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
  return handle.toLowerCase()
}

type FriendListHook = {
  friends: string[]
  addFriend: (handle: string) => { success: boolean; message?: string }
  removeFriend: (handle: string) => void
}

export function useFriendList(): FriendListHook {
  const [friends, setFriends] = useState<string[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        return
      }
      const parsed = JSON.parse(raw) as string[]
      if (Array.isArray(parsed)) {
        const unique = Array.from(new Set(parsed.map(normaliseHandle))).filter(Boolean)
        setFriends(unique.slice(0, MAX_FRIENDS))
      }
    } catch (error) {
      console.warn('friend list parse failed', error)
    }
  }, [])

  const persist = useCallback((next: string[]) => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (error) {
      console.warn('friend list persist failed', error)
    }
  }, [])

  const addFriend = useCallback<FriendListHook['addFriend']>((handle) => {
    const normalised = normaliseHandle(handle)
    if (!normalised) {
      return { success: false, message: 'Enter a valid Farcaster handle.' }
    }
    let didAdd = false
    setFriends((current) => {
      if (current.includes(normalised)) {
        return current
      }
      didAdd = true
      const next = [normalised, ...current].slice(0, MAX_FRIENDS)
      persist(next)
      return next
    })
    if (!didAdd) {
      return { success: false, message: 'Friend is already on your list.' }
    }
    return { success: true }
  }, [persist])

  const removeFriend = useCallback<FriendListHook['removeFriend']>((handle) => {
    const normalised = normaliseHandle(handle)
    if (!normalised) {
      return
    }
    setFriends((current) => {
      const next = current.filter((entry) => entry !== normalised)
      persist(next)
      return next
    })
  }, [persist])

  return {
    friends,
    addFriend,
    removeFriend,
  }
}
