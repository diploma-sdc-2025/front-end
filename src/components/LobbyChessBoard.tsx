import type { ReactNode } from 'react'
import type { ShopPiece } from '../api/game.ts'
import boardStyle from './LobbyChessBoard.module.css'

export type LobbyPlayerColor = 'white' | 'black'

export type BoardPlacedPiece = { col: number; row: number; piece: ShopPiece }

/** Bench/shop pieces use the light set in-game; add `-black` assets later if needed. */
const PLACED_SPRITES: Record<ShopPiece, string> = {
  pawn: '/pieces/pawn-white.png',
  knight: '/pieces/knight-white.png',
  bishop: '/pieces/bishop-white.png',
  rook: '/pieces/rook-white.png',
  queen: '/pieces/queen-white.png',
}

const PIECE_DRAG_MIME = 'application/x-diploma-piece'

type PieceDragPayload =
  | { source: 'bench'; benchSlot: number }
  | { source: 'board'; fromCol: number; fromRow: number }

type Props = {
  /** White king starts on e1; black king on e8 */
  playerColor?: LobbyPlayerColor
  className?: string
  /** Player-owned pieces already placed on squares (not including the fixed king). */
  placedPieces?: BoardPlacedPiece[]
  /** Receives board (col, row) and bench slot index when a bench piece is dropped on a square. */
  onDropBenchOnSquare?: (col: number, row: number, benchSlot: number) => void
  /** Receives source and destination when an on-board piece is dragged to another square. */
  onMoveBoardPiece?: (fromCol: number, fromRow: number, toCol: number, toRow: number) => void
  /** Disables drop targets (e.g. while a request is in flight). */
  placementDisabled?: boolean
}

function parsePieceDrag(dataTransfer: DataTransfer): PieceDragPayload | null {
  try {
    const raw =
      dataTransfer.getData(PIECE_DRAG_MIME) ||
      dataTransfer.getData('application/x-diploma-bench') ||
      dataTransfer.getData('application/json')
    if (!raw) return null
    const v = JSON.parse(raw) as {
      source?: unknown
      benchSlot?: unknown
      fromCol?: unknown
      fromRow?: unknown
    }
    if (v.source === 'bench' && typeof v.benchSlot === 'number') {
      const s = Math.trunc(v.benchSlot)
      if (s >= 0 && s <= 7) return { source: 'bench', benchSlot: s }
      return null
    }
    if (v.source === 'board' && typeof v.fromCol === 'number' && typeof v.fromRow === 'number') {
      const c = Math.trunc(v.fromCol)
      const r = Math.trunc(v.fromRow)
      if (c >= 0 && c <= 7 && r >= 0 && r <= 7) return { source: 'board', fromCol: c, fromRow: r }
      return null
    }
    // Legacy bench payload { benchSlot }
    if (typeof v.benchSlot === 'number') {
      const s = Math.trunc(v.benchSlot)
      if (s >= 0 && s <= 7) return { source: 'bench', benchSlot: s }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 8×8 board from White's perspective (rank 8 at top). The player's king on its home square
 * plus optional `placedPieces` from inventory.
 */
export function LobbyChessBoard({
  playerColor = 'white',
  className,
  placedPieces = [],
  onDropBenchOnSquare,
  onMoveBoardPiece,
  placementDisabled = false,
}: Props) {
  const kingRow = playerColor === 'white' ? 7 : 0
  const kingCol = 4
  const kingSprite = playerColor === 'white' ? '/pieces/king-white.png' : '/pieces/king-black.png'
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1']
  const droppable =
    Boolean(onDropBenchOnSquare || onMoveBoardPiece) && !placementDisabled
  const boardPieceDraggable = Boolean(onMoveBoardPiece) && !placementDisabled

  const squares: ReactNode[] = []
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const light = (row + col) % 2 === 0
      const isKing = row === kingRow && col === kingCol
      const placed = placedPieces.find((p) => p.col === col && p.row === row)

      squares.push(
        <div
          key={`${row}-${col}`}
          className={`${boardStyle.square} ${light ? boardStyle.light : boardStyle.dark} ${droppable ? boardStyle.droppable : ''}`}
          onDragOver={
            droppable
              ? (e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }
              : undefined
          }
          onDrop={
            droppable
              ? (e) => {
                  e.preventDefault()
                  const payload = parsePieceDrag(e.dataTransfer)
                  if (!payload) return
                  if (payload.source === 'bench') {
                    onDropBenchOnSquare?.(col, row, payload.benchSlot)
                    return
                  }
                  if (payload.fromCol === col && payload.fromRow === row) return
                  onMoveBoardPiece?.(payload.fromCol, payload.fromRow, col, row)
                }
              : undefined
          }
        >
          {isKing && (
            <img src={kingSprite} alt="" aria-hidden className={boardStyle.pieceSprite} />
          )}
          {!isKing && placed && (
            <img
              src={PLACED_SPRITES[placed.piece]}
              alt=""
              aria-hidden
              className={`${boardStyle.pieceSprite} ${boardPieceDraggable ? boardStyle.pieceDraggable : ''}`}
              draggable={boardPieceDraggable}
              onDragStart={
                boardPieceDraggable
                  ? (e) => setBoardPieceDragData(e.dataTransfer, col, row)
                  : undefined
              }
            />
          )}
        </div>,
      )
    }
  }

  return (
    <div className={`${boardStyle.board} ${className ?? ''}`} role="img" aria-label="Chess board with your king">
      <div className={boardStyle.grid}>{squares}</div>
      <div className={boardStyle.rankLabels} aria-hidden>
        {ranks.map((rank, idx) => (
          <span
            key={rank}
            className={`${boardStyle.axisLabel} ${idx % 2 === 0 ? boardStyle.axisOnLight : boardStyle.axisOnDark}`}
          >
            {rank}
          </span>
        ))}
      </div>
      <div className={boardStyle.fileLabels} aria-hidden>
        {files.map((file, idx) => (
          <span
            key={file}
            className={`${boardStyle.axisLabel} ${idx % 2 === 0 ? boardStyle.axisOnDark : boardStyle.axisOnLight}`}
          >
            {file}
          </span>
        ))}
      </div>
    </div>
  )
}

export function setBenchDragData(dataTransfer: DataTransfer, benchSlot: number): void {
  const payload = JSON.stringify({ source: 'bench', benchSlot })
  dataTransfer.setData(PIECE_DRAG_MIME, payload)
  dataTransfer.setData('application/json', payload)
  dataTransfer.effectAllowed = 'move'
}

export function setBoardPieceDragData(dataTransfer: DataTransfer, fromCol: number, fromRow: number): void {
  const payload = JSON.stringify({ source: 'board', fromCol, fromRow })
  dataTransfer.setData(PIECE_DRAG_MIME, payload)
  dataTransfer.setData('application/json', payload)
  dataTransfer.effectAllowed = 'move'
}
