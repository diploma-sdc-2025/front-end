import { Chess, type Square } from 'chess.js'
import type { BoardPieceDto, KingSquareDto, ShopPiece } from '../api/game.ts'

const PIECE_TO_SHOP: Record<string, ShopPiece | undefined> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
}

export type BattleReplayPosition = {
  whiteKing: KingSquareDto
  blackKing: KingSquareDto
  whiteBoard: BoardPieceDto[]
  blackBoard: BoardPieceDto[]
}

function squareToCoords(square: string): { x: number; y: number } {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0)
  const rank = parseInt(square.slice(1), 10)
  if (!Number.isFinite(rank)) return { x: 0, y: 0 }
  return { x: file, y: 8 - rank }
}

function chessToBattlePosition(chess: Chess): BattleReplayPosition {
  const whiteBoard: BoardPieceDto[] = []
  const blackBoard: BoardPieceDto[] = []
  let whiteKing: KingSquareDto = { x: 4, y: 7 }
  let blackKing: KingSquareDto = { x: 4, y: 0 }

  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell) continue
      const { x, y } = squareToCoords(cell.square)
      if (cell.type === 'k') {
        if (cell.color === 'w') whiteKing = { x, y }
        else blackKing = { x, y }
        continue
      }
      const piece = PIECE_TO_SHOP[cell.type]
      if (!piece) continue
      const dto: BoardPieceDto = { x, y, piece }
      if (cell.color === 'w') whiteBoard.push(dto)
      else blackBoard.push(dto)
    }
  }

  return { whiteKing, blackKing, whiteBoard, blackBoard }
}

/**
 * Applies the first `movesApplied` UCI moves from `fen` (same FEN as game-service / Stockfish).
 * Returns null if the FEN or a move is invalid.
 */
export function battlePositionAfterUciMoves(
  fen: string,
  uciMoves: string[],
  movesApplied: number,
): BattleReplayPosition | null {
  const n = Math.max(0, Math.min(movesApplied, uciMoves.length))
  try {
    const chess = new Chess(fen)
    for (let i = 0; i < n; i++) {
      const uci = uciMoves[i]!
      const from = uci.slice(0, 2) as Square
      const to = uci.slice(2, 4) as Square
      const promotion = uci.length >= 5 ? uci.slice(4, 5) : undefined
      chess.move({
        from,
        to,
        promotion: promotion as 'q' | 'r' | 'b' | 'n' | undefined,
      })
    }
    return chessToBattlePosition(chess)
  } catch {
    return null
  }
}
