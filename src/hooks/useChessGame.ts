import { Chess } from 'chess.js'
import type { Move, Square } from 'chess.js'
import type { PieceDropHandlerArgs } from 'react-chessboard'
import { useCallback, useMemo, useRef, useState } from 'react'

export type CaptureEvent = {
  move: Move
  capturedBy: 'white' | 'black'
}

export type CapturedPieces = {
  byWhite: string[]
  byBlack: string[]
}

const initialCaptures: CapturedPieces = {
  byWhite: [],
  byBlack: [],
}

type DropHandler = (args: PieceDropHandlerArgs) => boolean

export function useChessGame() {
  const chessRef = useRef(new Chess())
  const [position, setPosition] = useState(chessRef.current.fen())
  const [history, setHistory] = useState<Move[]>([])
  const [lastMoveSquares, setLastMoveSquares] = useState<{
    from: Square
    to: Square
  } | null>(null)
  const [captures, setCaptures] = useState<CapturedPieces>(initialCaptures)
  const [lastCapture, setLastCapture] = useState<CaptureEvent | null>(null)

  const buildHistory = useCallback(() => {
    const verboseHistory = chessRef.current.history({ verbose: true }) as Move[]
    setHistory(verboseHistory)
  }, [])

  const commitMove = useCallback(
    (move: Move | null, squares?: { from: Square; to: Square }) => {
      if (!move) {
        return false
      }

      setPosition(chessRef.current.fen())
      buildHistory()

      const fromSquare = squares?.from ?? (move.from as Square)
      const toSquare = squares?.to ?? (move.to as Square)
      setLastMoveSquares({ from: fromSquare, to: toSquare })

      if (move.captured) {
        const capturedBy = move.color === 'w' ? 'white' : 'black'
        setCaptures((prev) => {
          const key = capturedBy === 'white' ? 'byWhite' : 'byBlack'
          return {
            ...prev,
            [key]: [...prev[key], move.captured as string],
          }
        })
        setLastCapture({ move, capturedBy })
      } else {
        setLastCapture(null)
      }

      return true
    },
    [buildHistory],
  )

  const handleDrop: DropHandler = useCallback(
    ({ sourceSquare, targetSquare }) => {
      if (!targetSquare) {
        return false
      }

      const from = sourceSquare as Square
      const to = targetSquare as Square

      if (chessRef.current.isGameOver()) {
        return false
      }

      const move = chessRef.current.move({
        from,
        to,
        promotion: 'q',
      }) as Move | null

      return commitMove(move, { from, to })
    },
    [commitMove],
  )

  const resetGame = useCallback(() => {
    chessRef.current = new Chess()
    setPosition(chessRef.current.fen())
    setCaptures(initialCaptures)
    setLastMoveSquares(null)
    setLastCapture(null)
    buildHistory()
  }, [buildHistory])

  const undoMove = useCallback(() => {
    const undone = chessRef.current.undo() as Move | null
    if (!undone) {
      return
    }
    setPosition(chessRef.current.fen())
    buildHistory()

    if (undone.captured) {
      const capturedBy = undone.color === 'w' ? 'white' : 'black'
      const key = capturedBy === 'white' ? 'byWhite' : 'byBlack'
      setCaptures((prev) => ({
        ...prev,
        [key]: prev[key].slice(0, Math.max(prev[key].length - 1, 0)),
      }))
    }

    const latestMove = chessRef.current.history({ verbose: true }).at(-1)
    setLastMoveSquares(
      latestMove
        ? { from: latestMove.from as Square, to: latestMove.to as Square }
        : null,
    )
    setLastCapture(null)
  }, [buildHistory])

  const status = useMemo(() => {
    const moveCount = history.length
    const game = chessRef.current
    return {
      moveCount,
      isCheck: game.isCheck(),
      isCheckmate: game.isCheckmate(),
      isDraw: game.isDraw(),
      isStalemate: game.isStalemate(),
      isThreefoldRepetition: game.isThreefoldRepetition(),
      isInsufficientMaterial: game.isInsufficientMaterial(),
    }
  }, [history])

  const turn = useMemo(() => {
    const segments = position.split(' ')
    const active = segments[1]
    return active === 'b' ? 'b' : 'w'
  }, [position])

  const applyMoveBySan = useCallback(
    (san: string) => {
      if (chessRef.current.isGameOver()) {
        return false
      }
      const move = chessRef.current.move(san) as Move | null
      return commitMove(move)
    },
    [commitMove],
  )

  const getLatestSan = useCallback(() => {
    const moves = chessRef.current.history({ verbose: true }) as Move[]
    return moves.at(-1)?.san ?? null
  }, [])

  const getCurrentFen = useCallback(() => chessRef.current.fen(), [])

  const getLegalMoves = useCallback(() => {
    return chessRef.current.moves({ verbose: true }) as Move[]
  }, [])

  return {
    position,
    turn,
    status,
    history,
    lastMoveSquares,
    captures,
    lastCapture,
    onPieceDrop: handleDrop,
    resetGame,
    undoMove,
    applyMoveBySan,
    getLatestSan,
    getCurrentFen,
    getLegalMoves,
  }
}
