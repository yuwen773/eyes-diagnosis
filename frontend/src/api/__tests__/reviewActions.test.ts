/**
 * 审核动作矩阵测试 —— 必须与后端 ReviewDecisionCompatibilityGuard 逐字一致。
 */
import { describe, expect, it } from 'vitest'
import { DECISION_LABELS, resolveAllowedActions } from '@/api/review'

describe('resolveAllowedActions（镜像后端动作矩阵）', () => {
  it('IMAGE_QUALITY_GATE allows exactly the two quality decisions (any outcome)', () => {
    for (const outcome of ['VALID_PREDICTION', 'SAFETY_ABSTENTION', 'TECHNICAL_FAILURE', null]) {
      expect(resolveAllowedActions('IMAGE_QUALITY_GATE', outcome)).toEqual([
        'APPROVE_CONTINUE',
        'REJECT_RESUBMIT',
      ])
    }
  })

  it('FINAL_CLINICAL_REVIEW + VALID_PREDICTION allows confirm / correct / inconclusive', () => {
    expect(resolveAllowedActions('FINAL_CLINICAL_REVIEW', 'VALID_PREDICTION')).toEqual([
      'CONFIRM_AI_ASSESSMENT',
      'CORRECT_AI_ASSESSMENT',
      'INCONCLUSIVE',
    ])
  })

  it('FINAL_CLINICAL_REVIEW + SAFETY_ABSTENTION allows abstention decisions', () => {
    expect(resolveAllowedActions('FINAL_CLINICAL_REVIEW', 'SAFETY_ABSTENTION')).toEqual([
      'CONFIRM_ABSTENTION',
      'PROVIDE_INDEPENDENT_REVIEW',
      'INCONCLUSIVE',
    ])
  })

  it('FINAL_CLINICAL_REVIEW + TECHNICAL_FAILURE allows NO decision at all', () => {
    expect(resolveAllowedActions('FINAL_CLINICAL_REVIEW', 'TECHNICAL_FAILURE')).toEqual([])
  })

  it('unknown review type or missing outcome yields an empty action list', () => {
    expect(resolveAllowedActions('SOMETHING_ELSE', 'VALID_PREDICTION')).toEqual([])
    expect(resolveAllowedActions(null, 'VALID_PREDICTION')).toEqual([])
    expect(resolveAllowedActions('FINAL_CLINICAL_REVIEW', null)).toEqual([])
    expect(resolveAllowedActions('FINAL_CLINICAL_REVIEW', undefined)).toEqual([])
  })

  it('every decision code has a display label', () => {
    const allCodes = new Set([
      ...resolveAllowedActions('IMAGE_QUALITY_GATE', null),
      ...resolveAllowedActions('FINAL_CLINICAL_REVIEW', 'VALID_PREDICTION'),
      ...resolveAllowedActions('FINAL_CLINICAL_REVIEW', 'SAFETY_ABSTENTION'),
    ])
    for (const code of allCodes) {
      expect(DECISION_LABELS[code]).toBeTruthy()
    }
  })
})
