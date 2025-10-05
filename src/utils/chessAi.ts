import { Chess } from 'chess.js'
import type { Move } from 'chess.js'

const pieceValues: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
}

const pieceSquareTables: Record<Move['piece'], number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 27, 27, 10, 5, 5,
    0, 0, 0, 25, 25, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -25, -25, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 10, 10, 15, 15, 10, 10, -10,
    -10, 0, 15, 20, 20, 15, 0, -10,
    -10, 5, 15, 20, 20, 15, 5, -10,
    -10, 10, 15, 15, 15, 15, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 5, 10, 10, 5, 0, 0,
    -5, 0, 5, 10, 10, 5, 0, -5,
    -5, 0, 5, 10, 10, 5, 0, -5,
    -5, 0, 5, 10, 10, 5, 0, -5,
    -5, 0, 5, 10, 10, 5, 0, -5,
    -5, 0, 5, 10, 10, 5, 0, -5,
    5, 10, 10, 10, 10, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 5, 0, 0, 5, 0, -10,
    -10, 5, 5, 5, 5, 5, 5, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 5, -10,
    -10, 0, 5, 0, 0, 5, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 30, 0, 0, 0, 0, 30, 20,
    20, 40, 10, 0, 0, 10, 40, 20,
  ],
}

const reverseTable = (table: number[]): number[] => {
  const result = [...table]
  return result.reverse()
}

const pieceTablesBlack: Record<Move['piece'], number[]> = Object.fromEntries(
  Object.entries(pieceSquareTables).map(([piece, table]) => [piece, reverseTable(table)]),
) as Record<Move['piece'], number[]>

const evaluateBoard = (game: Chess, perspective: 'w' | 'b'): number => {
  if (game.isCheckmate()) {
    return game.turn() === perspective ? -Infinity : Infinity
  }
  if (game.isDraw()) {
    return 0
  }

  let score = 0
  const board = game.board()

  for (let rank = 0; rank < board.length; rank += 1) {
    for (let file = 0; file < board[rank].length; file += 1) {
      const square = board[rank][file]
      if (!square) continue

      const value = pieceValues[square.type]
      const table = square.color === 'w' ? pieceSquareTables : pieceTablesBlack
      const positional = table[square.type][rank * 8 + file]
      const contribution = value + positional
      if (square.color === perspective) {
        score += contribution
      } else {
        score -= contribution
      }
    }
  }

  const mobility = game.moves().length
  const perspectiveMobility = perspective === game.turn() ? mobility : 0
  score += perspectiveMobility * 5

  return score
}

const minimax = (
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  perspective: 'w' | 'b',
): number => {
  if (depth === 0 || game.isGameOver()) {
    return evaluateBoard(game, perspective)
  }

  const moves = game.moves({ verbose: true }) as Move[]
  if (maximizing) {
    let value = -Infinity
    let a = alpha
    for (const move of moves) {
      game.move(move)
      value = Math.max(value, minimax(game, depth - 1, a, beta, false, perspective))
      game.undo()
      a = Math.max(a, value)
      if (beta <= a) {
        break
      }
    }
    return value
  }

  let value = Infinity
  let b = beta
  for (const move of moves) {
    game.move(move)
    value = Math.min(value, minimax(game, depth - 1, alpha, b, true, perspective))
    game.undo()
    b = Math.min(b, value)
    if (b <= alpha) {
      break
    }
  }
  return value
}

export function selectEngineMove(
  fen: string,
  perspective: 'w' | 'b',
  depth: number,
): Move | null {
  const game = new Chess(fen)
  const moves = game.moves({ verbose: true }) as Move[]
  if (!moves.length) {
    return null
  }

  let bestScore = -Infinity
  let bestMove: Move | null = null

  for (const move of moves) {
    game.move(move)
    const score = minimax(game, depth - 1, -Infinity, Infinity, false, perspective)
    game.undo()

    if (score > bestScore) {
      bestScore = score
      bestMove = move
    }
  }

  return bestMove
}
