// 레퍼런스 데이터셋 — 상용 ABS/PC-ABS 등급의 전형적 물성값
// ⚠ 주의: 아래 값은 문헌·상용 데이터시트의 "대표 전형값(typical)"이며
//   특정 lot의 실측·독점 데이터가 아닙니다. 실제 lot은 ±편차가 있습니다.
// 이 데이터셋은 (1) 물리 모델 자가검증, (2) 문헌 기준 그라운딩에 사용됩니다.

import type { Formulation, PredictionResult } from './physics'
import { classifySegment } from './physics'
import type { CalibPair } from './calibration'
import { fitCalibration, applyCalibration, featuresFromFormulation } from './calibration'

export interface ReferenceGrade {
  id: string
  name: string
  segmentNote: string          // 예상 세그먼트
  form: Partial<Formulation>   // DEFAULT_FORM 대비 비기본 필드 (소비자가 merge)
  ref: {                       // 전형값 (문헌·상용 데이터시트 기준)
    hdt?: number; izod?: number; tensile?: number; mfi?: number; density?: number; vicat?: number
  }
}

// izod = notched Izod kJ/m², hdt = HDT@1.8MPa ℃, tensile MPa,
// mfi = MFI 220℃/10kg, density g/cm³, vicat ℃
export const REFERENCE_GRADES: ReferenceGrade[] = [
  { id: 'gp-abs', name: '범용 ABS (GP)', segmentNote: 'ABS',
    form: { gAbs: 20, anContent: 27 },
    ref: { hdt: 90, izod: 21, tensile: 44, mfi: 30, density: 1.045, vicat: 101 } },
  { id: 'hi-abs', name: '고충격 ABS', segmentNote: 'ABS',
    form: { gAbs: 33, anContent: 25 },
    ref: { hdt: 85, izod: 36, tensile: 38, mfi: 16, density: 1.04, vicat: 98 } },
  { id: 'mi-abs', name: '중충격 ABS', segmentNote: 'ABS',
    form: { gAbs: 26, anContent: 26 },
    ref: { hdt: 88, izod: 27, tensile: 42, mfi: 22, density: 1.04, vicat: 100 } },
  { id: 'amsan-hr', name: 'αMSAN 내열 ABS', segmentNote: 'αMSAN-ABS',
    form: { alphaMsan: 25, gAbs: 24, anContent: 28 },
    ref: { hdt: 104, izod: 15, tensile: 46, mfi: 8, density: 1.05, vicat: 112 } },
  // 내열 N-PMI grade: 실제 "중내열" 상용품은 N-PMI ~20-22wt% + 고Mw 매트릭스를 사용.
  // (기존 form npmi17은 default 상속값과 동일해 GP와 구분 불가했음 → 물리적 실측 조성으로 정정)
  // sanMw 110: 내열 grade는 점도/내열 균형 위해 표준(100) 대비 다소 높은 Mw 매트릭스 사용.
  { id: 'npmi-hr-mid', name: 'N-PMI 내열 ABS (중)', segmentNote: 'ABS',
    form: { npmi: 22, gAbs: 25, anContent: 28, sanMw: 110 },
    ref: { hdt: 108, izod: 14, tensile: 47, mfi: 10, density: 1.05, vicat: 116 } },
  // 고내열: N-PMI 25wt% + 고Mw 매트릭스(sanMw 122). 고함량 N-PMI는 저MFI·고점도 특성.
  { id: 'npmi-hr-high', name: 'N-PMI 고내열 ABS', segmentNote: 'ABS',
    form: { npmi: 25, gAbs: 22, anContent: 29, sanMw: 122 },
    ref: { hdt: 120, izod: 11, tensile: 48, mfi: 6, density: 1.06, vicat: 127 } },
  { id: 'pcabs-30', name: 'PC/ABS 30%', segmentNote: 'ABS+PC',
    form: { pc: 30, gAbs: 20, anContent: 25 },
    ref: { hdt: 108, izod: 50, tensile: 50, mfi: 16, density: 1.10, vicat: 120 } },
  { id: 'pcabs-50', name: 'PC/ABS 50%', segmentNote: 'PC+ABS',
    form: { pc: 50, gAbs: 18, anContent: 25 },
    ref: { hdt: 120, izod: 55, tensile: 54, mfi: 12, density: 1.13, vicat: 132 } },
  { id: 'pcabs-60', name: 'PC/ABS 60% (고PC)', segmentNote: 'PC+ABS',
    form: { pc: 60, gAbs: 15, anContent: 25 },
    ref: { hdt: 125, izod: 58, tensile: 56, mfi: 10, density: 1.15, vicat: 138 } },
  { id: 'gf20-abs', name: 'GF20 강화 ABS', segmentNote: 'ABS',
    form: { glassFiber: 20, gAbs: 15, anContent: 27, silane: 0.3 },
    ref: { hdt: 98, izod: 10, tensile: 78, mfi: 12, density: 1.22, vicat: 103 } },
  { id: 'gf30-abs', name: 'GF30 강화 ABS', segmentNote: 'ABS',
    form: { glassFiber: 30, gAbs: 12, anContent: 27, silane: 0.3 },
    ref: { hdt: 103, izod: 11, tensile: 95, mfi: 8, density: 1.28, vicat: 108 } },
  { id: 'talc20-abs', name: '탈크20 ABS', segmentNote: 'ABS',
    form: { talc: 20, gAbs: 20, anContent: 27 },
    ref: { hdt: 95, izod: 14, tensile: 42, mfi: 14, density: 1.19, vicat: 103 } },
  { id: 'fr-abs-v0', name: '난연 ABS (V-0)', segmentNote: 'ABS',
    form: { phosphorusFr: 22, gAbs: 22, anContent: 26 },
    ref: { hdt: 83, izod: 10, tensile: 40, mfi: 14, density: 1.16, vicat: 96 } },
  // N-PMI+탈크 내열: N-PMI ~20wt% + 탈크 10wt% + 약간 높은 Mw(sanMw 108).
  { id: 'npmi-talc-hr', name: 'N-PMI+탈크 내열', segmentNote: 'ABS',
    form: { npmi: 20, talc: 10, gAbs: 22, anContent: 28, sanMw: 108 },
    ref: { hdt: 110, izod: 12, tensile: 46, mfi: 9, density: 1.12, vicat: 118 } },
  { id: 'pcabs-hi', name: 'PC/ABS 고충격 40%', segmentNote: 'ABS+PC',
    form: { pc: 40, gAbs: 25, ema: 3, anContent: 25 },
    ref: { hdt: 112, izod: 60, tensile: 48, mfi: 14, density: 1.11, vicat: 122 } },
  { id: 'cf-abs', name: 'CF15 강화 ABS', segmentNote: 'ABS',
    form: { carbonFiber: 15, gAbs: 15, anContent: 27 },
    ref: { hdt: 108, izod: 9, tensile: 95, mfi: 9, density: 1.13, vicat: 113 } },
]

// ──────────────────────────────────────────────
// 검증 하네스 (Validation harness)
// ──────────────────────────────────────────────
const PROPS = ['hdt', 'izod', 'tensile', 'mfi', 'density', 'vicat'] as const
type PropKey = typeof PROPS[number]

export interface GradeValidation {
  grade: ReferenceGrade
  predicted: { hdt: number; izod: number; tensile: number; mfi: number; density: number; vicat: number }
  segment: string
  errors: Record<string, { ref: number; pred: number; absErr: number; pctErr: number } | null>
}

export interface ValidationSummary {
  perGrade: GradeValidation[]
  perProperty: Record<string, { mae: number; mapePct: number; bias: number; n: number }>  // bias = mean(pred-ref)
  perSegment: Record<string, { mapePct: number; n: number }>
  overallMapePct: number
}

export function validateModel(
  predict: (f: Formulation) => PredictionResult,
  base: Formulation,
): ValidationSummary {
  const perGrade: GradeValidation[] = []

  // 집계 누산기
  const propAcc: Record<string, { absSum: number; pctSum: number; biasSum: number; n: number }> = {}
  const segAcc: Record<string, { pctSum: number; n: number }> = {}
  let overallPctSum = 0, overallN = 0

  for (const grade of REFERENCE_GRADES) {
    const f: Formulation = { ...base, ...grade.form }
    const r = predict(f)
    const predicted = {
      hdt: r.hdt.value, izod: r.izod.value, tensile: r.tensile.value,
      mfi: r.mfi.value, density: r.density.value, vicat: r.vicat.value,
    }
    const segment = r.segment as string

    const errors: GradeValidation['errors'] = {}
    for (const p of PROPS) {
      const refVal = grade.ref[p]
      if (refVal == null) { errors[p] = null; continue }
      const pred = predicted[p as PropKey]
      const absErr = Math.abs(pred - refVal)
      const pctErr = refVal !== 0 ? (absErr / Math.abs(refVal)) * 100 : 0
      errors[p] = { ref: refVal, pred, absErr, pctErr }

      ;(propAcc[p] ??= { absSum: 0, pctSum: 0, biasSum: 0, n: 0 })
      propAcc[p].absSum += absErr
      propAcc[p].pctSum += pctErr
      propAcc[p].biasSum += pred - refVal
      propAcc[p].n += 1

      ;(segAcc[segment] ??= { pctSum: 0, n: 0 })
      segAcc[segment].pctSum += pctErr
      segAcc[segment].n += 1

      overallPctSum += pctErr
      overallN += 1
    }

    perGrade.push({ grade, predicted, segment, errors })
  }

  const perProperty: ValidationSummary['perProperty'] = {}
  for (const p of Object.keys(propAcc)) {
    const a = propAcc[p]
    perProperty[p] = {
      mae: a.absSum / a.n,
      mapePct: a.pctSum / a.n,
      bias: a.biasSum / a.n,
      n: a.n,
    }
  }

  const perSegment: ValidationSummary['perSegment'] = {}
  for (const s of Object.keys(segAcc)) {
    const a = segAcc[s]
    perSegment[s] = { mapePct: a.pctSum / a.n, n: a.n }
  }

  return {
    perGrade,
    perProperty,
    perSegment,
    overallMapePct: overallN > 0 ? overallPctSum / overallN : 0,
  }
}

// ──────────────────────────────────────────────
// 문헌 기준 그라운딩 (built-in literature grounding)
// REFERENCE_GRADES → CalibPair[] 로 변환, 기존 fitCalibration이 세그먼트별 보정
// hdt·izod는 ref 존재 → measured 로 사용. voc는 ref 없음 → measured 생략.
// ──────────────────────────────────────────────
export function referenceCalibPairs(
  predict: (f: Formulation) => PredictionResult,
  base: Formulation,
): CalibPair[] {
  return REFERENCE_GRADES.map(grade => {
    const f: Formulation = { ...base, ...grade.form }
    const r = predict(f)
    return {
      segment: classifySegment(f),
      features: featuresFromFormulation(f),
      predictedHdt: r.hdt.value,
      predictedIzod: r.izod.value,
      predictedVoc: r.voc.value,
      predictedTensile: r.tensile.value,
      predictedMfi: r.mfi.value,
      predictedVicat: r.vicat.value,
      measuredHdt: grade.ref.hdt,
      measuredIzod: grade.ref.izod,
      measuredTensile: grade.ref.tensile,
      measuredMfi: grade.ref.mfi,
      measuredVicat: grade.ref.vicat,
      // voc: ref 없음 → 생략
    }
  })
}

// ──────────────────────────────────────────────
// LOOCV (leave-one-out) — 정직한 그라운딩 검증 (누수 방지)
// 각 등급에 대해 나머지 15개로 보정 fit → 보류된 등급을 예측 → MAPE 집계.
// linear=true면 선형만(formulation 미전달), false면 비선형(LWR, formulation 전달).
// ──────────────────────────────────────────────
const LOOCV_PROPS = ['hdt', 'izod', 'tensile', 'mfi', 'vicat'] as const

export interface LOOCVResult {
  perProperty: Record<string, { mapePct: number; n: number }>
  overallMapePct: number
}

export function validateLOOCV(
  predict: (f: Formulation) => PredictionResult,
  base: Formulation,
  nonlinear = true,
): LOOCVResult {
  const allPairs = referenceCalibPairs(predict, base)
  const propAcc: Record<string, { pctSum: number; n: number }> = {}
  let overallSum = 0, overallN = 0

  REFERENCE_GRADES.forEach((grade, idx) => {
    const trainPairs = allPairs.filter((_, i) => i !== idx)
    const cal = fitCalibration(trainPairs)
    const f: Formulation = { ...base, ...grade.form }
    const r = nonlinear ? applyCalibration(predict(f), cal, f) : applyCalibration(predict(f), cal)
    const predicted: Record<string, number> = {
      hdt: r.hdt.value, izod: r.izod.value, tensile: r.tensile.value,
      mfi: r.mfi.value, vicat: r.vicat.value,
    }
    for (const p of LOOCV_PROPS) {
      const refVal = grade.ref[p]
      if (refVal == null || refVal === 0) continue
      const pctErr = Math.abs(predicted[p] - refVal) / Math.abs(refVal) * 100
      ;(propAcc[p] ??= { pctSum: 0, n: 0 })
      propAcc[p].pctSum += pctErr
      propAcc[p].n += 1
      overallSum += pctErr
      overallN += 1
    }
  })

  const perProperty: LOOCVResult['perProperty'] = {}
  for (const p of Object.keys(propAcc)) {
    perProperty[p] = { mapePct: propAcc[p].pctSum / propAcc[p].n, n: propAcc[p].n }
  }
  return { perProperty, overallMapePct: overallN > 0 ? overallSum / overallN : 0 }
}
