// M5 실험 캘리브레이션 엔진
// 실측 데이터(N≥2) 기반 최소제곱 선형회귀 → Cold-start 예측 보정
// 보정식: y_calibrated = scale * y_predicted + offset

import type { PredictionResult } from './physics'

export interface CalibProps {
  scale:  number  // 기울기
  offset: number  // 절편
  r2:     number  // 결정계수 (0~1)
  rmse:   number  // 제곱근 평균제곱오차
  n:      number  // 데이터 포인트 수
}

export interface CalibResult {
  active: boolean
  hdt:   CalibProps
  izod:  CalibProps
  voc:   CalibProps
}

export const IDENTITY_CALIB: CalibResult = {
  active: false,
  hdt:   { scale: 1, offset: 0, r2: NaN, rmse: NaN, n: 0 },
  izod:  { scale: 1, offset: 0, r2: NaN, rmse: NaN, n: 0 },
  voc:   { scale: 1, offset: 0, r2: NaN, rmse: NaN, n: 0 },
}

// 최소제곱 선형회귀 (y = scale*x + offset)
function lsq(preds: number[], meas: number[]): CalibProps {
  const n = preds.length
  if (n < 2) return { scale: 1, offset: 0, r2: NaN, rmse: NaN, n }

  let sp = 0, sm = 0, spp = 0, spm = 0
  for (let i = 0; i < n; i++) {
    sp  += preds[i]
    sm  += meas[i]
    spp += preds[i] ** 2
    spm += preds[i] * meas[i]
  }

  const det    = n * spp - sp * sp
  const scale  = Math.abs(det) > 1e-9 ? (n * spm - sp * sm) / det : 1
  const offset = (sm - scale * sp) / n

  const meanM = sm / n
  let ssTot = 0, ssRes = 0
  for (let i = 0; i < n; i++) {
    ssTot += (meas[i] - meanM) ** 2
    ssRes += (meas[i] - (scale * preds[i] + offset)) ** 2
  }

  return {
    scale,
    offset,
    r2:   ssTot > 1e-9 ? 1 - ssRes / ssTot : 1,
    rmse: Math.sqrt(ssRes / n),
    n,
  }
}

export interface CalibPair {
  predictedHdt:  number
  predictedIzod: number
  predictedVoc:  number
  measuredHdt?:  number
  measuredIzod?: number
  measuredVoc?:  number
}

export function fitCalibration(points: CalibPair[]): CalibResult {
  const hdtPts  = points.filter(p => p.measuredHdt  != null)
  const izodPts = points.filter(p => p.measuredIzod != null)
  const vocPts  = points.filter(p => p.measuredVoc  != null)

  return {
    active: true,
    hdt:   lsq(hdtPts.map(p  => p.predictedHdt),   hdtPts.map(p  => p.measuredHdt!)),
    izod:  lsq(izodPts.map(p => p.predictedIzod),  izodPts.map(p => p.measuredIzod!)),
    voc:   lsq(vocPts.map(p  => p.predictedVoc),   vocPts.map(p  => p.measuredVoc!)),
  }
}

// 예측값에 캘리브레이션 보정 적용
export function applyCalibration(
  pred: PredictionResult,
  cal: CalibResult | null
): PredictionResult {
  if (!cal?.active) return pred

  const adj = (
    v: { value: number; low: number; high: number },
    c: CalibProps
  ) => {
    if (c.n < 2) return v
    const f = (x: number) => c.scale * x + c.offset
    return { value: f(v.value), low: f(v.low), high: f(v.high) }
  }

  const hdtAdj  = adj(pred.hdt,  cal.hdt)
  const izodAdj = adj(pred.izod, cal.izod)
  const vocAdj  = adj(pred.voc,  cal.voc)

  return {
    ...pred,
    hdt:  hdtAdj,
    izod: izodAdj,
    voc:  vocAdj,
    specPass: {
      hdt:  hdtAdj.value  >= 115 ? true : hdtAdj.value  >= 110 ? null : false,
      izod: izodAdj.value >= 15  ? true : izodAdj.value >= 10  ? null : false,
      voc:  vocAdj.value  <= 50  ? true : vocAdj.value  <= 70  ? null : false,
    },
  }
}
