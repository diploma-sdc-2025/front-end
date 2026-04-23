import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EvaluationBar, centipawnsToWhiteBarShare } from '../../components/EvaluationBar'

describe('EvaluationBar', () => {
  it('maps centipawns to bounded white share', () => {
    expect(centipawnsToWhiteBarShare(0)).toBe(0.5)
    expect(centipawnsToWhiteBarShare(10_000)).toBeLessThanOrEqual(0.97)
    expect(centipawnsToWhiteBarShare(-10_000)).toBeGreaterThanOrEqual(0.03)
  })

  it('renders white advantage label', () => {
    render(<EvaluationBar centipawns={125} />)
    expect(screen.getByLabelText(/white is better/i)).toBeInTheDocument()
    expect(screen.getByText('+1.3')).toBeInTheDocument()
  })

  it('renders equal position label and score', () => {
    render(<EvaluationBar centipawns={0} />)
    expect(screen.getByLabelText('Position is equal')).toBeInTheDocument()
    expect(screen.getByText('0.0')).toBeInTheDocument()
  })
})
