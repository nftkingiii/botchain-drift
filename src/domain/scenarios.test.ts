import { describe, expect, it } from 'vitest'
import { buildScenarios, validateScenario, type ScenarioInput } from './scenarios'

const base: ScenarioInput = { entry: 100, direction: 'up', endpointPct: 8, adversePct: 12, horizonHours: 72, feePct: 0.12 }

describe('scenario notebook', () => {
  it('builds three deterministic and distinct paths', () => {
    const paths = buildScenarios(base)
    expect(paths).toHaveLength(3)
    expect(paths.map((path) => path.values.at(-1))).toEqual([108, 108, 105.76])
    expect(paths[1].worstPct).toBe(-12)
  })
  it('reverses the adverse excursion when the thesis points down', () => {
    const [baseline, adverse] = buildScenarios({ ...base, direction: 'down' })
    expect(baseline.endpointPct).toBe(-8)
    expect(adverse.values[1]).toBeCloseTo(112)
  })
  it('rejects out-of-range inputs', () => {
    expect(validateScenario({ ...base, entry: 0, adversePct: 101 })).toHaveLength(2)
  })
  it('applies the user-set cost assumption to directional outcomes', () => {
    const [baseline] = buildScenarios(base)
    expect(baseline.netDirectionPct).toBeCloseTo(7.88)
  })
})
