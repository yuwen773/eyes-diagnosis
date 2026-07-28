/**
 * Patient Exposure Guard 测试。
 *
 * 注意：本测试文件中出现的敏感字段名（rawPrediction 等）仅用于
 * 验证白名单投影会将它们全部剔除；生产代码（src，除 __tests__ 外）
 * 中不允许出现这些字段名，由 scripts/exposure-scan.mjs 静态门禁保证。
 */
import { describe, expect, it } from 'vitest'
import { toPatientResult } from '@/api/workflow'

describe('toPatientResult（患者结果白名单投影）', () => {
  it('keeps only diseaseCode and calibratedProbability', () => {
    const projected = toPatientResult({
      diseaseCode: 'D2',
      calibratedProbability: 0.91,
      extraField: 'should-vanish',
    })
    expect(projected).toEqual({ diseaseCode: 'D2', calibratedProbability: 0.91 })
    expect(Object.keys(projected!)).toHaveLength(2)
  })

  it('strips every sensitive AI field even if backend accidentally sends them', () => {
    const projected = toPatientResult({
      diseaseCode: 'D3',
      calibratedProbability: 0.72,
      rawPrediction: { logits: [0.1, 0.9] },
      topK: ['D3', 'D1'],
      modelScore: 0.999,
      abstainReason: 'LOW_CONFIDENCE',
      modelFingerprint: 'sha256:abc',
      predictionSnapshot: '[diseaseCode=D3, probability=0.72]',
      modelWeightFingerprint: 'sha256:def',
    }) as unknown as Record<string, unknown>
    expect(projected).not.toBeNull()
    for (const forbidden of [
      'rawPrediction',
      'topK',
      'modelScore',
      'abstainReason',
      'modelFingerprint',
      'predictionSnapshot',
      'modelWeightFingerprint',
    ]) {
      expect(projected[forbidden]).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(projected, forbidden)).toBe(false)
    }
  })

  it('returns null for null / undefined / non-object input', () => {
    expect(toPatientResult(null)).toBeNull()
    expect(toPatientResult(undefined)).toBeNull()
    expect(toPatientResult('D2')).toBeNull()
    expect(toPatientResult(42)).toBeNull()
  })

  it('returns null when diseaseCode is missing or empty', () => {
    expect(toPatientResult({ calibratedProbability: 0.9 })).toBeNull()
    expect(toPatientResult({ diseaseCode: '', calibratedProbability: 0.9 })).toBeNull()
  })

  it('returns null when calibratedProbability is missing or not a finite number', () => {
    expect(toPatientResult({ diseaseCode: 'D1' })).toBeNull()
    expect(toPatientResult({ diseaseCode: 'D1', calibratedProbability: 'high' })).toBeNull()
    expect(toPatientResult({ diseaseCode: 'D1', calibratedProbability: NaN })).toBeNull()
  })

  it('returns null for a doctor-only material object without patient fields', () => {
    // 医生材料对象没有患者白名单字段时，患者侧必须得到 null（而不是部分透出）
    expect(
      toPatientResult({
        inferenceOutcomeType: 'SAFETY_ABSTENTION',
        safetyAbstentionReasonCode: 'OOD_SUSPECTED',
        oodSnapshot: '{"score":0.99}',
      }),
    ).toBeNull()
  })
})
