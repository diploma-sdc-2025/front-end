import { readApiError } from './client.ts'
import { getBattleApi } from './config.ts'

export type BattleEvaluateResponse = {
  centipawns: number
  advantage: string
  bestMove: string
  principalVariation: string[]
}

export const battleApi = {
  async evaluatePosition(fen: string): Promise<BattleEvaluateResponse> {
    const res = await fetch(getBattleApi('/api/battle/evaluate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen }),
    })
    if (!res.ok) throw new Error(await readApiError(res))
    return (await res.json()) as BattleEvaluateResponse
  },
}
