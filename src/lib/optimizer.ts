// M6 자동 탐색 엔진
// 수천 개 배합을 자동으로 시뮬레이션하고 Spec 통과 후보를 랭킹
import { predictColdStart, type Formulation, type PredictionResult } from './physics'

export interface SearchRange {
  min: number
  max: number
  step: number
  enabled: boolean
}

export interface SearchConfig {
  // 탐색 범위 (활성화 가능)
  npmi:         SearchRange
  gAbs:         SearchRange
  anContent:    SearchRange
  ema:          SearchRange
  uhmwSr:       SearchRange
  phosphorusFr: SearchRange
  talc:         SearchRange
  glassFiber:   SearchRange
  // 신규 탐색 범위
  pc:           SearchRange
  nanoclay:     SearchRange
  mbs:          SearchRange
  sebs:         SearchRange
  carbonFiber:  SearchRange
  // 고정값 (공정·소량 첨가제)
  injTemp:      number
  moldTemp:     number
  antioxidant:  number
  lubricant:    number
  cbMB:         number
  alphaMsan:    number
  acrylicIm:    number
  ptfe:         number
  silane:       number
  wax:          number
  hals:         number
  heatStabilizer: number
  metalDeact:   number
  antistatic:   number
}

export interface SearchTarget {
  hdt:  { min: number; weight: number }
  izod: { min: number; weight: number }
  voc:  { max: number; weight: number }
  cost: { max: number; weight: number }
}

export interface CandidateResult {
  rank: number
  formulation: Formulation
  prediction: PredictionResult
  score: number          // 0~100 종합 점수
  hdtMargin: number      // HDT - target (℃)
  izodMargin: number     // Izod - target (kJ/m²)
  vocMargin: number      // target - VOC (µg/g)
  specAllPass: boolean
}

function range(min: number, max: number, step: number): number[] {
  const result: number[] = []
  for (let v = min; v <= max + 1e-9; v += step) {
    result.push(Math.round(v * 100) / 100)
  }
  return result
}

function computeScore(pred: PredictionResult, target: SearchTarget): number {
  // 각 목표 대비 달성도 정규화 (0~1), 가중합
  const hdtScore  = Math.max(0, Math.min(1, (pred.hdt.value  - target.hdt.min)  / 20))
  const izodScore = Math.max(0, Math.min(1, (pred.izod.value - target.izod.min) / 20))
  const vocScore  = Math.max(0, Math.min(1, (target.voc.max  - pred.voc.value)  / 50))
  const costScore = target.cost.max > 0
    ? Math.max(0, Math.min(1, (target.cost.max - pred.cost.value) / 2000))
    : 0.5

  const total = target.hdt.weight + target.izod.weight + target.voc.weight + target.cost.weight
  return ((hdtScore * target.hdt.weight + izodScore * target.izod.weight
         + vocScore * target.voc.weight + costScore * target.cost.weight) / total) * 100
}

export function runGridSearch(
  config: SearchConfig,
  target: SearchTarget,
  maxResults = 50,
  maxCombinations = 8000,
): { candidates: CandidateResult[]; totalSearched: number; passCount: number } {
  const npmiVals   = config.npmi.enabled         ? range(config.npmi.min,         config.npmi.max,         config.npmi.step)         : [config.npmi.min]
  const gAbsVals   = config.gAbs.enabled         ? range(config.gAbs.min,         config.gAbs.max,         config.gAbs.step)         : [config.gAbs.min]
  const anVals     = config.anContent.enabled     ? range(config.anContent.min,    config.anContent.max,    config.anContent.step)    : [config.anContent.min]
  const emaVals    = config.ema.enabled           ? range(config.ema.min,          config.ema.max,          config.ema.step)          : [config.ema.min]
  const srVals     = config.uhmwSr.enabled        ? range(config.uhmwSr.min,       config.uhmwSr.max,       config.uhmwSr.step)       : [config.uhmwSr.min]
  const frVals     = config.phosphorusFr.enabled  ? range(config.phosphorusFr.min, config.phosphorusFr.max, config.phosphorusFr.step) : [config.phosphorusFr.min]
  const talcVals   = config.talc.enabled          ? range(config.talc.min,         config.talc.max,         config.talc.step)         : [config.talc.min]
  const gfVals     = config.glassFiber.enabled    ? range(config.glassFiber.min,   config.glassFiber.max,   config.glassFiber.step)   : [config.glassFiber.min]
  const pcVals     = config.pc.enabled            ? range(config.pc.min,           config.pc.max,           config.pc.step)           : [config.pc.min]
  const nanoclayVals = config.nanoclay.enabled    ? range(config.nanoclay.min,     config.nanoclay.max,     config.nanoclay.step)     : [config.nanoclay.min]
  const mbsVals    = config.mbs.enabled           ? range(config.mbs.min,          config.mbs.max,          config.mbs.step)          : [config.mbs.min]
  const sebsVals   = config.sebs.enabled          ? range(config.sebs.min,         config.sebs.max,         config.sebs.step)         : [config.sebs.min]
  const cfVals     = config.carbonFiber.enabled   ? range(config.carbonFiber.min,  config.carbonFiber.max,  config.carbonFiber.step)  : [config.carbonFiber.min]

  const totalCombinations = npmiVals.length * gAbsVals.length * anVals.length
    * emaVals.length * srVals.length * frVals.length * talcVals.length * gfVals.length
    * pcVals.length * nanoclayVals.length * mbsVals.length * sebsVals.length * cfVals.length

  // 조합이 너무 많으면 랜덤 샘플링
  const useRandom = totalCombinations > maxCombinations
  const allCandidates: CandidateResult[] = []
  let searched = 0
  let passCount = 0

  const tryFormulation = (f: Formulation) => {
    searched++
    const totalWt = f.npmi + f.gAbs + f.cbMB
      + (f.ema ?? 0) + (f.uhmwSr ?? 0) + f.phosphorusFr + f.talc + f.glassFiber
      + (f.pc ?? 0) + (f.alphaMsan ?? 0) + (f.nanoclay ?? 0)
      + (f.mbs ?? 0) + (f.sebs ?? 0) + (f.acrylicIm ?? 0) + (f.ptfe ?? 0) + (f.carbonFiber ?? 0)
    if (totalWt > 98) return  // 조성 합계 초과
    const san = Math.max(0, 100 - totalWt)
    const pred = predictColdStart({ ...f, san })
    const allPass = pred.specPass.hdt === true && pred.specPass.izod === true && pred.specPass.voc === true
    if (allPass) passCount++
    // Spec 미달이어도 점수 높으면 포함 (후보 다양성)
    const score = computeScore(pred, target)
    allCandidates.push({
      rank: 0,
      formulation: { ...f, san },
      prediction: pred,
      score,
      hdtMargin:  pred.hdt.value  - target.hdt.min,
      izodMargin: pred.izod.value - target.izod.min,
      vocMargin:  target.voc.max  - pred.voc.value,
      specAllPass: allPass,
    })
  }

  const fixedFields = {
    cbMB: config.cbMB, antioxidant: config.antioxidant,
    lubricant: config.lubricant, injTemp: config.injTemp, moldTemp: config.moldTemp,
    alphaMsan: config.alphaMsan, acrylicIm: config.acrylicIm, ptfe: config.ptfe,
    silane: config.silane, wax: config.wax, hals: config.hals,
    heatStabilizer: config.heatStabilizer, metalDeact: config.metalDeact, antistatic: config.antistatic,
    san: 0,
  }

  if (!useRandom) {
    for (const npmi of npmiVals)
    for (const gAbs of gAbsVals)
    for (const an of anVals)
    for (const ema of emaVals)
    for (const sr of srVals)
    for (const fr of frVals)
    for (const talc of talcVals)
    for (const gf of gfVals)
    for (const pc of pcVals)
    for (const nanoclay of nanoclayVals)
    for (const mbs of mbsVals)
    for (const sebs of sebsVals)
    for (const cf of cfVals) {
      tryFormulation({ npmi, gAbs, anContent: an, ema, uhmwSr: sr,
        phosphorusFr: fr, talc, glassFiber: gf,
        pc, nanoclay, mbs, sebs, carbonFiber: cf,
        ...fixedFields })
    }
  } else {
    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
    for (let i = 0; i < maxCombinations; i++) {
      tryFormulation({
        npmi: pick(npmiVals), gAbs: pick(gAbsVals), anContent: pick(anVals),
        ema: pick(emaVals), uhmwSr: pick(srVals), phosphorusFr: pick(frVals),
        talc: pick(talcVals), glassFiber: pick(gfVals),
        pc: pick(pcVals), nanoclay: pick(nanoclayVals),
        mbs: pick(mbsVals), sebs: pick(sebsVals), carbonFiber: pick(cfVals),
        ...fixedFields })
    }
  }

  // Spec 통과 우선, 그 다음 점수 순
  allCandidates.sort((a, b) => {
    if (a.specAllPass !== b.specAllPass) return a.specAllPass ? -1 : 1
    return b.score - a.score
  })

  const top = allCandidates.slice(0, maxResults).map((c, i) => ({ ...c, rank: i + 1 }))
  return { candidates: top, totalSearched: searched, passCount }
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  npmi:         { min: 10, max: 25, step: 2,   enabled: true  },
  gAbs:         { min: 20, max: 40, step: 4,   enabled: true  },
  anContent:    { min: 24, max: 32, step: 4,   enabled: true  },
  ema:          { min: 0,  max: 10, step: 5,   enabled: false },
  uhmwSr:       { min: 0,  max: 4,  step: 2,   enabled: false },
  phosphorusFr: { min: 0,  max: 0,  step: 5,   enabled: false },
  talc:         { min: 0,  max: 15, step: 5,   enabled: false },
  glassFiber:   { min: 0,  max: 0,  step: 10,  enabled: false },
  pc:           { min: 0,  max: 20, step: 5,   enabled: false },
  nanoclay:     { min: 0,  max: 5,  step: 1,   enabled: false },
  mbs:          { min: 0,  max: 8,  step: 4,   enabled: false },
  sebs:         { min: 0,  max: 8,  step: 4,   enabled: false },
  carbonFiber:  { min: 0,  max: 10, step: 5,   enabled: false },
  // 고정값
  injTemp: 250, moldTemp: 70, antioxidant: 0.5, lubricant: 1.0, cbMB: 2.5,
  alphaMsan: 0, acrylicIm: 0, ptfe: 0, silane: 0, wax: 0,
  hals: 0, heatStabilizer: 0, metalDeact: 0, antistatic: 0,
}

export const DEFAULT_TARGET: SearchTarget = {
  hdt:  { min: 115, weight: 3 },
  izod: { min: 15,  weight: 2 },
  voc:  { max: 50,  weight: 2 },
  cost: { max: 5000,weight: 1 },
}
