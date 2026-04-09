import type { ReactNode } from 'react'

import type { ShopPiece } from '../api/game.ts'

import {
  KING_LANE_COL_MAX,
  KING_LANE_COL_MIN,
  KING_RANK_ROWS_MAX,
  KING_RANK_ROWS_MIN,
} from '../api/game.ts'

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



const WHITE_KING_DEFAULT_COL = 4

const WHITE_KING_DEFAULT_ROW = 7

const BLACK_KING_DEFAULT_COL = 4

const BLACK_KING_DEFAULT_ROW = 0



type PieceDragPayload =

  | { source: 'bench'; benchSlot: number }

  | { source: 'board'; fromCol: number; fromRow: number }

  | { source: 'king' }



/**

 * Drag preview from a canvas copy of this img only. The browser default is a screen

 * grab that can include neighbouring pieces (especially identical pawn sprites).

 * Does not hide the source — hiding broke drops in some browsers.

 */

export function assignSpriteDragPreviewCanvas(evt: DragEvent, img: HTMLImageElement): void {

  const dt = evt.dataTransfer

  if (!dt) return



  const dw = Math.max(1, Math.round(img.offsetWidth))

  const dh = Math.max(1, Math.round(img.offsetHeight))

  if (!img.complete || img.naturalWidth < 1) return



  const canvas = document.createElement('canvas')

  canvas.width = dw

  canvas.height = dh

  const ctx = canvas.getContext('2d')

  if (!ctx) return



  try {

    ctx.drawImage(img, 0, 0, dw, dh)

  } catch {

    return

  }



  canvas.style.position = 'fixed'

  canvas.style.left = '0'

  canvas.style.top = '-10000px'

  canvas.style.pointerEvents = 'none'

  document.body.appendChild(canvas)



  try {

    dt.setDragImage(canvas, Math.floor(dw / 2), Math.floor(dh / 2))

  } catch {

    canvas.remove()

    return

  }



  const cleanup = () => {

    canvas.remove()

    window.removeEventListener('dragend', cleanup)

  }

  window.addEventListener('dragend', cleanup, { once: true })

}



type Props = {

  playerColor?: LobbyPlayerColor

  className?: string

  /**

   * King square from server (shop). When omitted, uses e1 / e8 so the plain Lobby screen

   * still looks like standard chess.

   */

  kingSquare?: { col: number; row: number }

  /** Player-owned pieces already placed on squares (not including the king). */

  placedPieces?: BoardPlacedPiece[]

  onDropBenchOnSquare?: (col: number, row: number, benchSlot: number) => void

  onMoveBoardPiece?: (fromCol: number, fromRow: number, toCol: number, toRow: number) => void

  onMoveKing?: (toCol: number, toRow: number) => void

  placementDisabled?: boolean

  /** Fired when a board piece (not the king) starts/ends a drag — e.g. to show a sell bin near the shop. */
  onSellablePieceDragStart?: () => void

  onSellablePieceDragEnd?: () => void

}



export function parsePieceDragPayload(dataTransfer: DataTransfer): PieceDragPayload | null {

  try {

    const raw =

      dataTransfer.getData(PIECE_DRAG_MIME) ||

      dataTransfer.getData('text/plain') ||

      dataTransfer.getData('application/x-diploma-bench') ||

      dataTransfer.getData('application/json')

    if (!raw) return null

    const v = JSON.parse(raw) as {

      source?: unknown

      benchSlot?: unknown

      fromCol?: unknown

      fromRow?: unknown

    }

    if (v.source === 'king') return { source: 'king' }

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

 * 8×8 board from White's perspective (rank 8 at top). King + optional `placedPieces` from inventory.

 */

export function LobbyChessBoard({

  playerColor = 'white',

  className,

  kingSquare,

  placedPieces = [],

  onDropBenchOnSquare,

  onMoveBoardPiece,

  onMoveKing,

  placementDisabled = false,

  onSellablePieceDragStart,

  onSellablePieceDragEnd,

}: Props) {

  const kingCol =

    kingSquare?.col ?? (playerColor === 'white' ? WHITE_KING_DEFAULT_COL : BLACK_KING_DEFAULT_COL)

  const kingRow =

    kingSquare?.row ?? (playerColor === 'white' ? WHITE_KING_DEFAULT_ROW : BLACK_KING_DEFAULT_ROW)

  const kingSprite = playerColor === 'white' ? '/pieces/king-white.png' : '/pieces/king-black.png'

  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1']

  const droppable =

    Boolean(onDropBenchOnSquare || onMoveBoardPiece || onMoveKing) && !placementDisabled

  const boardPieceDraggable = Boolean(onMoveBoardPiece) && !placementDisabled

  const kingDraggable = Boolean(onMoveKing) && !placementDisabled



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

                  const payload = parsePieceDragPayload(e.dataTransfer)

                  if (!payload) return

                  if (payload.source === 'king') {

                    if (col < KING_LANE_COL_MIN || col > KING_LANE_COL_MAX) return
                    if (row < KING_RANK_ROWS_MIN || row > KING_RANK_ROWS_MAX) return

                    onMoveKing?.(col, row)

                    return

                  }

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

            <img

              src={kingSprite}

              alt=""

              aria-hidden

              className={`${boardStyle.pieceSprite} ${kingDraggable ? boardStyle.pieceDraggable : ''}`}

              draggable={kingDraggable}

              onDragStart={

                kingDraggable

                  ? (e) => {

                      assignSpriteDragPreviewCanvas(e.nativeEvent, e.currentTarget)

                      setKingDragData(e.dataTransfer)

                    }

                  : undefined

              }

            />

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

                  ? (e) => {

                      assignSpriteDragPreviewCanvas(e.nativeEvent, e.currentTarget)

                      setBoardPieceDragData(e.dataTransfer, col, row)

                      onSellablePieceDragStart?.()

                    }

                  : undefined

              }

              onDragEnd={boardPieceDraggable ? () => onSellablePieceDragEnd?.() : undefined}

            />

          )}

        </div>,

      )

    }

  }



  return (

    <div className={`${boardStyle.board} ${className ?? ''}`} role="img" aria-label="Chess board with your king">

      <div className={boardStyle.playfield}>{squares}</div>

      <div className={boardStyle.rankLabels} aria-hidden>

        {ranks.map((rank, idx) => (

          <div key={rank} className={boardStyle.rankLabelsCell}>

            <span

              className={`${boardStyle.axisLabel} ${idx % 2 === 0 ? boardStyle.axisOnLight : boardStyle.axisOnDark}`}

            >

              {rank}

            </span>

          </div>

        ))}

      </div>

      <div className={boardStyle.fileLabels} aria-hidden>

        {files.map((file, idx) => (

          <div key={file} className={boardStyle.fileLabelsCell}>

            <span

              className={`${boardStyle.axisLabel} ${idx % 2 === 0 ? boardStyle.axisOnDark : boardStyle.axisOnLight}`}

            >

              {file}

            </span>

          </div>

        ))}

      </div>

    </div>

  )

}



export function setBenchDragData(dataTransfer: DataTransfer, benchSlot: number): void {

  const payload = JSON.stringify({ source: 'bench', benchSlot })

  dataTransfer.setData(PIECE_DRAG_MIME, payload)

  dataTransfer.setData('text/plain', payload)

  dataTransfer.setData('application/json', payload)

  dataTransfer.effectAllowed = 'move'

}



export function setBoardPieceDragData(dataTransfer: DataTransfer, fromCol: number, fromRow: number): void {

  const payload = JSON.stringify({ source: 'board', fromCol, fromRow })

  dataTransfer.setData(PIECE_DRAG_MIME, payload)

  dataTransfer.setData('text/plain', payload)

  dataTransfer.setData('application/json', payload)

  dataTransfer.effectAllowed = 'move'

}



function setKingDragData(dataTransfer: DataTransfer): void {

  const payload = JSON.stringify({ source: 'king' })

  dataTransfer.setData(PIECE_DRAG_MIME, payload)

  dataTransfer.setData('text/plain', payload)

  dataTransfer.setData('application/json', payload)

  dataTransfer.effectAllowed = 'move'

}


