import type { ReactNode } from 'react'
import type { BoardPieceDto, KingSquareDto, ShopPiece } from '../api/game.ts'
import boardStyle from './LobbyChessBoard.module.css'

const WHITE_SPRITES: Record<ShopPiece, string> = {
  pawn: '/pieces/pawn-white.png',
  knight: '/pieces/knight-white.png',
  bishop: '/pieces/bishop-white.png',
  rook: '/pieces/rook-white.png',
  queen: '/pieces/queen-white.png',
}

type Props = {
  className?: string
  whiteKing: KingSquareDto
  blackKing: KingSquareDto
  whitePieces: BoardPieceDto[]
  blackPieces: BoardPieceDto[]
  /** When true, the board is rotated so Black sits at the bottom (your pieces on ranks 5–8). */
  viewAsBlack: boolean
}

/**
 * Read-only combined position: White (lower user id) vs Black (higher user id) in shared coordinates.
 */
export function BattlePreviewBoard({
  className,
  whiteKing,
  blackKing,
  whitePieces,
  blackPieces,
  viewAsBlack,
}: Props) {
  const rankLabelsNormal = ['8', '7', '6', '5', '4', '3', '2', '1'] as const
  const rankLabelsBlack = ['1', '2', '3', '4', '5', '6', '7', '8'] as const
  const fileLabelsNormal = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
  const fileLabelsBlack = ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'] as const

  const ranks = viewAsBlack ? rankLabelsBlack : rankLabelsNormal
  const files = viewAsBlack ? fileLabelsBlack : fileLabelsNormal

  const toLogical = (visualCol: number, visualRow: number) =>
    viewAsBlack
      ? { col: 7 - visualCol, row: 7 - visualRow }
      : { col: visualCol, row: visualRow }

  const squares: ReactNode[] = []
  for (let visualRow = 0; visualRow < 8; visualRow++) {
    for (let visualCol = 0; visualCol < 8; visualCol++) {
      const { col: lc, row: lr } = toLogical(visualCol, visualRow)
      const light = (visualRow + visualCol) % 2 === 0

      let pieceImg: string | null = null
      let blackTint = false

      if (lc === whiteKing.x && lr === whiteKing.y) {
        pieceImg = '/pieces/king-white.png'
      } else if (lc === blackKing.x && lr === blackKing.y) {
        pieceImg = '/pieces/king-white.png'
        blackTint = true
      } else {
        const wp = whitePieces.find((p) => p.x === lc && p.y === lr)
        const bp = blackPieces.find((p) => p.x === lc && p.y === lr)
        if (wp) {
          pieceImg = WHITE_SPRITES[wp.piece]
        } else if (bp) {
          pieceImg = WHITE_SPRITES[bp.piece]
          blackTint = true
        }
      }

      squares.push(
        <div
          key={`${visualRow}-${visualCol}`}
          className={`${boardStyle.square} ${light ? boardStyle.light : boardStyle.dark}`}
        >
          {pieceImg ? (
            <img
              src={pieceImg}
              alt=""
              aria-hidden
              className={`${boardStyle.pieceSprite} ${blackTint ? boardStyle.pieceBlackSilhouette : ''}`}
            />
          ) : null}
        </div>,
      )
    }
  }

  return (
    <div className={`${boardStyle.board} ${className ?? ''}`} role="img" aria-label="Battle position">
      <div className={boardStyle.playfield}>{squares}</div>
      <div className={boardStyle.rankLabels} aria-hidden>
        {ranks.map((rank) => (
          <div key={rank} className={boardStyle.rankLabelsCell}>
            <span className={boardStyle.axisLabel}>{rank}</span>
          </div>
        ))}
      </div>
      <div className={boardStyle.fileLabels} aria-hidden>
        {files.map((file) => (
          <div key={file} className={boardStyle.fileLabelsCell}>
            <span className={boardStyle.axisLabel}>{file}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
