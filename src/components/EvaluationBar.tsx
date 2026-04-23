import gameStyle from '../pages/GamePage.module.css'

/** Map centipawns (White’s perspective) to white’s vertical share of the bar, chess.com–style. */
export function centipawnsToWhiteBarShare(cp: number): number {
  const scale = 450
  const raw = 0.5 + 0.5 * (cp / (Math.abs(cp) + scale))
  return Math.min(0.97, Math.max(0.03, raw))
}

function formatAdvantagePawns(cp: number): string {
  const pawns = Math.abs(cp) / 100
  if (pawns >= 10) return pawns.toFixed(1)
  if (pawns >= 1) return pawns.toFixed(1)
  if (pawns >= 0.05) return pawns.toFixed(1)
  return pawns.toFixed(2)
}

type Props = {
  centipawns: number
  className?: string
  invert?: boolean
}

/**
 * Vertical bar: white on top, black on bottom; fill shows who is ahead (Stockfish cp from White’s view).
 */
export function EvaluationBar({ centipawns, className, invert = false }: Props) {
  const whiteShare = centipawnsToWhiteBarShare(centipawns)
  const whitePct = whiteShare * 100
  const blackPct = 100 - whitePct
  const label = formatAdvantagePawns(centipawns)
  const whiteAhead = centipawns > 0
  const blackAhead = centipawns < 0
  const even = centipawns === 0
  const whiteOnTop = !invert
  const topPct = whiteOnTop ? whitePct : blackPct
  const bottomPct = 100 - topPct

  const aria = even
    ? 'Position is equal'
    : whiteAhead
      ? `White is better by about ${label} pawns`
      : `Black is better by about ${label} pawns`

  return (
    <aside
      className={`${gameStyle.evalBarWrap} ${className ?? ''}`}
      aria-label={aria}
    >
      <div className={gameStyle.evalBarTrack}>
        <div
          className={whiteOnTop ? gameStyle.evalBarWhite : gameStyle.evalBarBlack}
          style={{ height: `${topPct}%` }}
        />
        <div
          className={whiteOnTop ? gameStyle.evalBarBlack : gameStyle.evalBarWhite}
          style={{ height: `${bottomPct}%` }}
        />
        {whiteAhead ? (
          <div
            className={`${gameStyle.evalBarScore} ${whiteOnTop ? gameStyle.evalBarScoreTop : gameStyle.evalBarScoreBottom}`}
          >
            <span className={gameStyle.evalBarScoreInner}>+{label}</span>
          </div>
        ) : null}
        {blackAhead ? (
          <div
            className={`${gameStyle.evalBarScore} ${whiteOnTop ? gameStyle.evalBarScoreBottom : gameStyle.evalBarScoreTop}`}
          >
            <span className={gameStyle.evalBarScoreInner}>{label}</span>
          </div>
        ) : null}
        {even ? (
          <div className={`${gameStyle.evalBarScore} ${gameStyle.evalBarScoreCenter}`}>
            <span className={gameStyle.evalBarScoreInner}>0.0</span>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
