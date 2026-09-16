export type ScenarioInput = {
  entry: number
  direction: 'up' | 'down'
  endpointPct: number
  adversePct: number
  horizonHours: number
  feePct: number
}

export type Scenario = { id: 'baseline' | 'shock' | 'delay'; label: string; color: string; values: number[]; endpointPct: number; worstPct: number; netDirectionPct: number; netWorstDirectionPct: number }

export function validateScenario(input: ScenarioInput): string[] {
  const errors: string[] = []
  if (!Number.isFinite(input.entry) || input.entry <= 0) errors.push('Reference price must be greater than zero.')
  if (!Number.isFinite(input.endpointPct) || Math.abs(input.endpointPct) > 100) errors.push('Thesis change must be between −100% and +100%.')
  if (!Number.isFinite(input.adversePct) || input.adversePct < 0 || input.adversePct > 100) errors.push('Adverse move must be between 0% and 100%.')
  if (!Number.isFinite(input.horizonHours) || input.horizonHours <= 0 || input.horizonHours > 8760) errors.push('Horizon must be 1–8,760 hours.')
  if (!Number.isFinite(input.feePct) || input.feePct < 0 || input.feePct > 10) errors.push('Cost assumption must be 0–10%.')
  return errors
}

export function buildScenarios(input: ScenarioInput): Scenario[] {
  const sign = input.direction === 'up' ? 1 : -1
  const endpoint = sign * Math.abs(input.endpointPct)
  const shock = -sign * Math.abs(input.adversePct)
  const directionSign = input.direction === 'up' ? 1 : -1
  const path = (id: Scenario['id'], label: string, color: string, moves: number[]): Scenario => {
    const endpointPct = moves.at(-1) ?? 0
    const worstPct = moves.reduce((worst, move) => move * directionSign < worst * directionSign ? move : worst, moves[0] ?? 0)
    return { id, label, color, values: moves.map((move) => input.entry * (1 + move / 100)), endpointPct, worstPct,
      netDirectionPct: endpointPct * directionSign - input.feePct,
      netWorstDirectionPct: worstPct * directionSign - input.feePct }
  }
  return [
    path('baseline', 'Baseline', '#90C9DE', [0, endpoint * 0.24, endpoint * 0.68, endpoint]),
    path('shock', 'Adverse first', '#D9AF5E', [0, shock, shock * 0.35, endpoint]),
    path('delay', 'Delayed thesis', '#A7AAA9', [0, endpoint * 0.12, shock * 0.28, endpoint * 0.72]),
  ]
}

export function buildArtifact(input: ScenarioInput, thesis: string, symbol: string, dataAt: string | null, id: string) {
  const scenarios = buildScenarios(input)
  return {
    schema: 'drift-rehearsal-v1', id, symbol, thesis: thesis.trim(),
    createdAt: new Date().toISOString(),
    reference: { price: input.entry, direction: input.direction, source: dataAt ? 'Bitget public ticker' : 'User-entered scenario value', observedAt: dataAt },
    assumptions: { thesisEndpointPct: input.endpointPct, adverseMovePct: input.adversePct, horizonHours: input.horizonHours, estimatedRoundTripCostPct: input.feePct },
    scenarios: scenarios.map(({ id: scenarioId, label, values, endpointPct, worstPct, netDirectionPct, netWorstDirectionPct }) => ({ id: scenarioId, label, prices: values, endpointPct, worstPct, netDirectionPct, netWorstDirectionPct })),
    limitation: 'A commitment to this artifact does not verify the truth of its inputs or complete any market action.',
  }
}
