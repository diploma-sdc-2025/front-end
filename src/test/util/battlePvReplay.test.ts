import { describe, expect, it } from 'vitest'
import { battlePositionAfterUciMoves } from '../../util/battlePvReplay'

describe('battle Pv replay', () => {
  it('returns initial board when no moves are applied', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'
    const result = battlePositionAfterUciMoves(fen, ['e2e4'], 0)
    expect(result).not.toBeNull()
    expect(result?.whiteBoard).toContainEqual({ x: 4, y: 6, piece: 'pawn' })
  })

  it('applies UCI moves up to requested move count', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'
    const result = battlePositionAfterUciMoves(fen, ['e2e4'], 1)
    expect(result).not.toBeNull()
    expect(result?.whiteBoard).toContainEqual({ x: 4, y: 4, piece: 'pawn' })
  })

  it('returns null for invalid FEN or invalid move', () => {
    expect(battlePositionAfterUciMoves('not-a-fen', [], 0)).toBeNull()
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'
    expect(battlePositionAfterUciMoves(fen, ['a1a9'], 1)).toBeNull()
  })
})
