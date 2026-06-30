// M5 실험 캘리브레이션 엔진
// 실측 데이터(N≥2) 기반 최소제곱 선형회귀 → Cold-start 예측 보정
// 보정식: y_calibrated = scale * y_predicted + offset
// 업그레이드: 세그먼트별 보정 + 잔차(RMSE) 기반 불확실성 밴드 + 외삽 인식 확대

import type { PredictionResult, Formulation } from './physics'
import { testSigma } from './physics'

// LWR(국소가중회귀) 거리 계산에 사용하는 10개 특성 + 도메인 정규화 스팬
export const LWR_FEATURES = [
  'npmi', 'gAbs', 'anContent', 'pc', 'alphaMsan',
  'talc', 'glassFiber', 'carbonFiber', 'phosphorusFr', 'nanoclay',
] as const
export type LwrFeature = typeof LWR_FEATURES[number]

// DOMAIN_RANGES와 동일한 스팬(정규화용). physics.ts의 DOMAIN_RANGES는 export되지 않으므로 동기화 복제.
const FEATURE_SPAN: Record<LwrFeature, number> = {
  npmi: 25, gAbs: 25, anContent: 10, pc: 60, alphaMsan: 30,
  talc: 25, glassFiber: 35, carbonFiber: 20, phosphorusFr: 25, nanoclay: 6,
}

export type FeatureVec = Record<LwrFeature, number>

export function featuresFromFormulation(f: Pick<Formulation, LwrFeature>): FeatureVec {
  const v = {} as FeatureVec
  for (const k of LWR_FEATURES) v[k] = (f[k] as number) ?? 0
  return v
}

// 정규화 단위 bandwidth. LOOCV(16 ref grades) 스윕 결과 h=0.35가 전체 MAPE 최저
// (선형 9.47% → 비선형 8.97%). h를 키우면(0.5~1.0) izod는 약간 나아지나 overall은 악화.
const LWR_BANDWIDTH = 0.35
const getH = () => LWR_BANDWIDTH
const LWR_MIN_POINTS = 5   // 이 미만이면 LWR 비활성 (순수 선형)
const LWR_SUPPORT_TAPER = 1.5

export interface CalibProps {
  scale:  number  // 기울기
  offset: number  // 절편
  r2:     number  // 결정계수 (0~1)
  rmse:   number  // 제곱근 평균제곱오차
  n:      number  // 데이터 포인트 수
  xMin:   number  // 피팅에 사용된 예측값 최소 (외삽 감지용)
  xMax:   number  // 피팅에 사용된 예측값 최대
}

// 한 세그먼트(또는 전역)에서의 프로퍼티별 fit 묶음
export interface SegmentCalib {
  hdt:     CalibProps
  izod:    CalibProps
  voc:     CalibProps
  tensile: CalibProps
  mfi:     CalibProps
  vicat:   CalibProps
}

type SixProps = 'hdt' | 'izod' | 'voc' | 'tensile' | 'mfi' | 'vicat'

// apply-time LWR을 위해 저장하는 캘리브레이션 점
export interface StoredPoint {
  segment: string
  features: FeatureVec
  predicted: Record<SixProps, number>
  measured: Partial<Record<SixProps, number>>
}

export interface CalibResult {
  active: boolean
  mode: 'global' | 'segment' | 'nonlinear'   // 보정 모드 (점≥5에서 nonlinear)
  hdt:     CalibProps   // GLOBAL fit (fallback)
  izod:    CalibProps
  voc:     CalibProps
  tensile: CalibProps
  mfi:     CalibProps
  vicat:   CalibProps
  bySegment: Record<string, SegmentCalib>  // per-segment fits
  points: StoredPoint[]                     // LWR 잔차 보정용 저장점
}

const IDENTITY_PROPS: CalibProps = { scale: 1, offset: 0, r2: NaN, rmse: NaN, n: 0, xMin: NaN, xMax: NaN }

export const IDENTITY_CALIB: CalibResult = {
  active: false,
  mode: 'global',
  hdt:     { ...IDENTITY_PROPS },
  izod:    { ...IDENTITY_PROPS },
  voc:     { ...IDENTITY_PROPS },
  tensile: { ...IDENTITY_PROPS },
  mfi:     { ...IDENTITY_PROPS },
  vicat:   { ...IDENTITY_PROPS },
  bySegment: {},
  points: [],
}

// 최소제곱 선형회귀 (y = scale*x + offset)
function lsq(preds: number[], meas: number[]): CalibProps {
  const n = preds.length
  if (n < 2) return { scale: 1, offset: 0, r2: NaN, rmse: NaN, n, xMin: NaN, xMax: NaN }

  let sp = 0, sm = 0, spp = 0, spm = 0
  let xMin = preds[0], xMax = preds[0]
  for (let i = 0; i < n; i++) {
    sp  += preds[i]
    sm  += meas[i]
    spp += preds[i] ** 2
    spm += preds[i] * meas[i]
    if (preds[i] < xMin) xMin = preds[i]
    if (preds[i] > xMax) xMax = preds[i]
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
    xMin,
    xMax,
  }
}

export interface CalibPair {
  segment?: string
  // LWR 거리 계산용 10개 특성 (없으면 0으로 처리 — 잔차 보정만 영향, 선형은 무관)
  features?: Partial<FeatureVec>
  predictedHdt:      number
  predictedIzod:     number
  predictedVoc:      number
  predictedTensile?: number
  predictedMfi?:     number
  predictedVicat?:   number
  measuredHdt?:      number
  measuredIzod?:     number
  measuredVoc?:      number
  measuredTensile?:  number
  measuredMfi?:      number
  measuredVicat?:    number
}

function fitGroup(points: CalibPair[]): SegmentCalib {
  const hdtPts     = points.filter(p => p.measuredHdt     != null)
  const izodPts    = points.filter(p => p.measuredIzod    != null)
  const vocPts     = points.filter(p => p.measuredVoc     != null)
  const tensilePts = points.filter(p => p.measuredTensile != null && p.predictedTensile != null)
  const mfiPts     = points.filter(p => p.measuredMfi     != null && p.predictedMfi     != null)
  const vicatPts   = points.filter(p => p.measuredVicat   != null && p.predictedVicat   != null)
  return {
    hdt:     lsq(hdtPts.map(p     => p.predictedHdt),      hdtPts.map(p     => p.measuredHdt!)),
    izod:    lsq(izodPts.map(p    => p.predictedIzod),     izodPts.map(p    => p.measuredIzod!)),
    voc:     lsq(vocPts.map(p     => p.predictedVoc),      vocPts.map(p     => p.measuredVoc!)),
    tensile: lsq(tensilePts.map(p => p.predictedTensile!), tensilePts.map(p => p.measuredTensile!)),
    mfi:     lsq(mfiPts.map(p     => p.predictedMfi!),     mfiPts.map(p     => p.measuredMfi!)),
    vicat:   lsq(vicatPts.map(p   => p.predictedVicat!),   vicatPts.map(p   => p.measuredVicat!)),
  }
}

export function fitCalibration(points: CalibPair[]): CalibResult {
  // 전역 피팅 (기존과 동일 — fallback)
  const global = fitGroup(points)

  // 세그먼트별 그룹화 (segment 누락 시 'ABS')
  const groups: Record<string, CalibPair[]> = {}
  for (const p of points) {
    const seg = p.segment || 'ABS'
    ;(groups[seg] ??= []).push(p)
  }

  const bySegment: Record<string, SegmentCalib> = {}
  let anySegmentFit = false
  for (const seg of Object.keys(groups)) {
    const fit = fitGroup(groups[seg])
    bySegment[seg] = fit
    if (fit.hdt.n >= 2 || fit.izod.n >= 2 || fit.voc.n >= 2
      || fit.tensile.n >= 2 || fit.mfi.n >= 2 || fit.vicat.n >= 2) anySegmentFit = true
  }

  // 저장점 구성 (apply-time LWR용)
  const storedPoints: StoredPoint[] = points.map(p => {
    const fv = {} as FeatureVec
    for (const k of LWR_FEATURES) fv[k] = p.features?.[k] ?? 0
    const measured: Partial<Record<SixProps, number>> = {}
    if (p.measuredHdt     != null) measured.hdt     = p.measuredHdt
    if (p.measuredIzod    != null) measured.izod    = p.measuredIzod
    if (p.measuredVoc     != null) measured.voc     = p.measuredVoc
    if (p.measuredTensile != null) measured.tensile = p.measuredTensile
    if (p.measuredMfi     != null) measured.mfi     = p.measuredMfi
    if (p.measuredVicat   != null) measured.vicat   = p.measuredVicat
    return {
      segment: p.segment || 'ABS',
      features: fv,
      predicted: {
        hdt: p.predictedHdt, izod: p.predictedIzod, voc: p.predictedVoc,
        tensile: p.predictedTensile ?? NaN, mfi: p.predictedMfi ?? NaN, vicat: p.predictedVicat ?? NaN,
      },
      measured,
    }
  })

  // mode 결정: 점≥5 → nonlinear(LWR), 아니면 기존 선형(segment/global)
  let mode: 'global' | 'segment' | 'nonlinear' = anySegmentFit ? 'segment' : 'global'
  if (points.length >= LWR_MIN_POINTS) mode = 'nonlinear'

  return {
    active: true, mode,
    hdt: global.hdt, izod: global.izod, voc: global.voc,
    tensile: global.tensile, mfi: global.mfi, vicat: global.vicat,
    bySegment,
    points: storedPoints,
  }
}

type CalibProp = 'hdt' | 'izod' | 'voc' | 'tensile' | 'mfi' | 'vicat'

// 프로퍼티별로 사용할 fit 선택: 세그먼트 fit(n≥2) 우선, 없으면 전역(n≥2), 둘 다 없으면 null
function pickFit(cal: CalibResult, segment: string, prop: CalibProp): CalibProps | null {
  const segFit = cal.bySegment[segment]?.[prop]
  if (segFit && segFit.n >= 2) return segFit
  const glob = cal[prop]
  if (glob.n >= 2) return glob
  return null
}

// fit 신뢰도 → confidence 레벨
function fitConfidence(c: CalibProps): PredictionResult['confidence'] {
  if (c.n >= 5 && c.r2 >= 0.9) return 'high'
  if (c.n >= 3) return 'medium'
  if (c.n >= 2) return 'low'
  return 'cold'
}

const CONF_RANK: Record<PredictionResult['confidence'], number> = { cold: 0, low: 1, medium: 2, high: 3 }

// 두 특성 벡터 사이의 정규화 유클리드 거리 (각 특성을 도메인 스팬으로 정규화)
function normDist(a: FeatureVec, b: FeatureVec): number {
  let s = 0
  for (const k of LWR_FEATURES) {
    const d = (a[k] - b[k]) / FEATURE_SPAN[k]
    s += d * d
  }
  return Math.sqrt(s)
}

interface LwrOutcome { delta: number; localStd: number; nEff: number; dMin: number }

// 한 프로퍼티에 대해 선형보정 후 잔차의 국소가중회귀(LWR) 결과
function lwrResidual(
  cal: CalibResult, prop: CalibProp, fit: CalibProps,
  fFeatures: FeatureVec,
): LwrOutcome | null {
  const pts = cal.points.filter(p => p.measured[prop] != null && Number.isFinite(p.predicted[prop]))
  if (pts.length === 0) return null

  const h = getH()
  let sumW = 0, sumWR = 0, dMin = Infinity
  const ws: number[] = [], rs: number[] = []
  for (const p of pts) {
    const r = (p.measured[prop] as number) - (fit.scale * p.predicted[prop] + fit.offset)
    const d = normDist(fFeatures, p.features)
    if (d < dMin) dMin = d
    const w = Math.exp(-((d / h) ** 2))
    ws.push(w); rs.push(r)
    sumW += w; sumWR += w * r
  }
  const nEff = sumW
  const delta = sumW > 1e-6 ? sumWR / sumW : 0
  // 잔차의 가중 표준편차 (Δ 주변)
  let sumWsq = 0
  for (let i = 0; i < ws.length; i++) sumWsq += ws[i] * (rs[i] - delta) ** 2
  const localStd = sumW > 1e-6 ? Math.sqrt(sumWsq / sumW) : 0
  return { delta, localStd, nEff, dMin }
}

// 예측값에 캘리브레이션 보정 + 불확실성 밴드 적용
// formulation 제공 시 비선형(LWR) 잔차 보정 단계 추가; 생략 시 선형만 (하위호환)
export function applyCalibration(
  pred: PredictionResult,
  cal: CalibResult | null,
  formulation?: Formulation,
): PredictionResult {
  if (!cal?.active) return pred

  const props: CalibProp[] = ['hdt', 'izod', 'voc', 'tensile', 'mfi', 'vicat']
  const adjusted: Partial<Record<CalibProp, { value: number; low: number; high: number }>> = {}
  const usedConfs: PredictionResult['confidence'][] = []

  // LWR 활성 조건: nonlinear 모드 + formulation 제공
  const useLwr = cal.mode === 'nonlinear' && formulation != null
  const fFeatures = formulation ? featuresFromFormulation(formulation) : null
  let lwrNEff = 0, lwrDMin = Infinity, lwrApplied = false

  for (const prop of props) {
    const c = pickFit(cal, pred.segment, prop)
    if (!c) continue  // 보정 불가 — 미조정 유지

    const v = pred[prop].value
    let vCal = c.scale * v + c.offset

    const baseUnc = 1.5 * c.rmse
    const range = Math.max(1e-6, c.xMax - c.xMin)
    const distOutside = Math.max(0, v - c.xMax, c.xMin - v)
    const extraUnc = c.rmse * (distOutside / range) * 2
    const calibUnc = baseUnc + extraUnc

    // ── 비선형 잔차 보정 (LWR)
    let localStdUnc = 0
    if (useLwr && fFeatures) {
      const lwr = lwrResidual(cal, prop, c, fFeatures)
      if (lwr) {
        const taper = Math.min(1, lwr.nEff / LWR_SUPPORT_TAPER)
        vCal += lwr.delta * taper
        // 거리 페널티: 가장 가까운 점이 멀면 불확실성↑
        const distPenalty = lwr.localStd * Math.min(2, lwr.dMin / getH())
        localStdUnc = Math.max(1.96 * lwr.localStd, 1.96 * lwr.localStd + distPenalty)
        lwrNEff = Math.max(lwrNEff, lwr.nEff)
        lwrDMin = Math.min(lwrDMin, lwr.dMin)
        lwrApplied = true
      }
    }

    // 최종 밴드 = max(선형 불확실성, 1.96·testSigma, 1.96·국소잔차std). 실험 재현성보다 좁아지지 않음.
    const scatterUnc = 1.96 * testSigma(prop, vCal)
    const unc = Math.max(calibUnc, scatterUnc, localStdUnc)

    adjusted[prop] = { value: vCal, low: vCal - unc, high: vCal + unc }
    usedConfs.push(fitConfidence(c))
  }

  const hdtAdj     = adjusted.hdt     ?? pred.hdt
  const izodAdj    = adjusted.izod    ?? pred.izod
  const vocAdj     = adjusted.voc     ?? pred.voc
  const tensileAdj = adjusted.tensile ?? pred.tensile
  const mfiAdj     = adjusted.mfi     ?? pred.mfi
  let   vicatAdj   = adjusted.vicat   ?? pred.vicat

  // MFI 보정 시 의존 조건(mi200/mi250_2/mi250_5)을 동일 비율로 재파생 → 4조건 순서 유지
  let mi200Adj   = pred.mi200
  let mi250_2Adj = pred.mi250_2
  let mi250_5Adj = pred.mi250_5
  if (adjusted.mfi) {
    const rawMfi = pred.mfi.value
    const ratio = rawMfi > 1e-9 ? mfiAdj.value / rawMfi : 1
    const scaleM = (m: { value: number; low: number; high: number }) =>
      ({ value: m.value * ratio, low: m.low * ratio, high: m.high * ratio })
    mi200Adj   = scaleM(pred.mi200)
    mi250_2Adj = scaleM(pred.mi250_2)
    mi250_5Adj = scaleM(pred.mi250_5)
  }

  // Vicat ≥ HDT 물리 플로어 유지: 보정 후 vicat < hdt면 hdt+4로 보정
  if (vicatAdj.value < hdtAdj.value) {
    const v = hdtAdj.value + 4
    const unc = vicatAdj.high - vicatAdj.value
    vicatAdj = { value: v, low: v - unc, high: v + unc }
  }

  // 보정에 실제 사용된 프로퍼티들의 최소 신뢰도 (보수적). 아무것도 보정 안 되면 기존 유지.
  let confidence = pred.confidence
  if (usedConfs.length > 0) {
    confidence = usedConfs.reduce((min, c) => CONF_RANK[c] < CONF_RANK[min] ? c : min, usedConfs[0])
  }
  // LWR: 국소 지지가 충분하고 가까운 점이 있을 때만 'high'로 상향 가능
  if (lwrApplied && lwrNEff >= 3 && lwrDMin < 0.15 && CONF_RANK[confidence] < CONF_RANK.high) {
    confidence = 'high'
  }

  return {
    ...pred,
    hdt:     hdtAdj,
    izod:    izodAdj,
    voc:     vocAdj,
    tensile: tensileAdj,
    mfi:     mfiAdj,
    mi200:   mi200Adj,
    mi250_2: mi250_2Adj,
    mi250_5: mi250_5Adj,
    vicat:   vicatAdj,
    specPass: {
      hdt:  hdtAdj.value  >= 115 ? true : hdtAdj.value  >= 110 ? null : false,
      izod: izodAdj.value >= 15  ? true : izodAdj.value >= 10  ? null : false,
      voc:  vocAdj.value  <= 50  ? true : vocAdj.value  <= 70  ? null : false,
    },
    confidence,
  }
}
