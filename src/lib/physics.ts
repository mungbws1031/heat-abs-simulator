// 물리·경험식 기반 Cold-start 예측 엔진 (Layer 1) v1.2
// Fox 식, HDT-Tg 상관, 혼합법칙, 고무-충격 trade-off
// 논문/경험식 기반 추가 재료 (v1.1 → v1.2):
//   EMA+UHMW-SR: PMC11013094 | 인계 FR: PMC6401830
//   PC/ABS: Fox eq + empirical HDT | αMSAN: Tg 118℃
//   나노클레이 MMT: +2℃/wt% (최대 5wt%) | CF: +2.5℃/wt%
//   MBS/SEBS/아크릴계: 충격보강 | 실란: GF·탈크 효율 +30/+20%
//   PTFE: anti-drip FR 보조 | HALS/열안정제/금속불활성화제: 내구성

export interface Formulation {
  // ── 주요 조성
  npmi:         number   // N-PMI wt%
  gAbs:         number   // g-ABS(고무/PB) wt%
  san:          number   // SAN wt% (자동 계산)
  anContent:    number   // AN 함량 % (SAN 중)
  cbMB:         number   // 카본블랙 MB wt%
  // ── 기본 첨가제
  antioxidant:  number   // 산화방지제 phr
  lubricant:    number   // 활제 (EBS) phr
  // ── 공정
  injTemp:      number   // 사출 온도 ℃
  moldTemp:     number   // 금형 온도 ℃
  // ── 매트릭스 개질
  pc:           number   // PC 블렌드 wt%
  alphaMsan:    number   // αMSAN wt%
  nanoclay:     number   // 나노클레이 MMT wt%
  // ── 충격보강제
  ema:          number   // EMA 상용화제 wt%
  uhmwSr:       number   // UHMW 실리콘 고무 wt%
  mbs:          number   // MBS 코어-셸 wt%
  sebs:         number   // SEBS wt%
  acrylicIm:    number   // 아크릴계 충격보강제 wt%
  // ── 난연
  phosphorusFr: number   // 인계 난연제 (APP+AlPi) wt%
  ptfe:         number   // PTFE 분말 wt%
  // ── 충전재·강화재
  talc:         number   // 탈크 wt%
  glassFiber:   number   // 유리섬유 wt%
  carbonFiber:  number   // 카본섬유 wt%
  // ── 기능성 소량 첨가제 (phr)
  silane:       number   // 실란 커플링제 phr
  wax:          number   // 왁스 (PE·몬탄) phr
  hals:         number   // HALS 광안정제 phr
  heatStabilizer: number // 열안정제 phr
  metalDeact:   number   // 금속불활성화제 phr
  antistatic:   number   // 대전방지제 phr
}

export interface PredictionResult {
  hdt:    { value: number; low: number; high: number }
  vicat:  { value: number; low: number; high: number }
  izod:   { value: number; low: number; high: number }
  mfi:    { value: number; low: number; high: number }
  voc:    { value: number; low: number; high: number }
  cost:   { value: number; low: number; high: number }
  ul94:   'V-0' | 'V-2' | 'HB' | 'N/A'
  specPass: { hdt: boolean | null; izod: boolean | null; voc: boolean | null }
  confidence: 'cold' | 'low' | 'medium' | 'high'
  additiveSummary: string[]
}

// Tg 기준값
const Tg_NPMI   = 175   // N-PMI
const Tg_PC     = 147   // 폴리카보네이트
const Tg_AMSAN  = 118   // αMSAN (αMS 함량 ~40%)
const Tg_SAN_BASE = 105

// Fox equation: 1/Tg_mix = Σ(wi/Tgi) — 내부 정규화 포함
function foxTg(components: Array<{ w: number; tg: number }>): number {
  const total = components.reduce((s, c) => s + c.w, 0)
  if (total === 0) return 100
  const sum = components.reduce((acc, c) => acc + (c.w > 0 ? (c.w / total) / (c.tg + 273.15) : 0), 0)
  if (sum === 0) return 100
  return 1 / sum - 273.15
}

function sanTg(anPct: number): number {
  return Tg_SAN_BASE + (anPct - 27) * 0.6
}

// HDT (1.8 MPa) — 경험식 + 충전재 + 나노클레이 + CF + 실란 보정
function hdtFromTg(
  tg: number, rubberWt: number,
  talc: number, gf: number, nanoclay: number, cf: number,
  silane: number, pc: number
): number {
  const rubberPenalty = rubberWt * 0.28
  // 충전재 HDT 기여
  const silaneMultiplier = silane >= 0.1 ? 1.3 : 1.0
  const talcBoost = talc * 0.5 * (silane >= 0.1 ? 1.2 : 1.0)
  // GF: 비정질 ABS계 실측 +0.6~0.75℃/wt% (반결정성과 다름) — 조태웅 검증
  const gfBoost   = gf   * 0.75 * silaneMultiplier
  // CF: GF 대비 ~1.4~1.5배, 비정질 계 기준 — 조태웅 검증
  const cfBoost   = cf   * 1.4
  // 나노클레이: 최대 5wt%에서 효과 포화 (MMT 층간 분산)
  const nanoclayBoost = Math.min(nanoclay, 5) * 2.0
  // PC 블렌드: 25wt% 초과 시 상분리(phase separation) 패널티 — 윤정민 검증
  const pcPhasePenalty = pc > 25 ? (pc - 25) * 0.4 : 0
  const pcBoost = pc * 0.05 - pcPhasePenalty
  return tg - 17 - rubberPenalty + talcBoost + gfBoost + cfBoost + nanoclayBoost + pcBoost
}

// Izod 충격 (kJ/m²)
function izodFromRubber(
  rubberWt: number, npmiWt: number,
  ema: number, uhmwSr: number, pFr: number,
  mbs: number, sebs: number, acrylicIm: number,
  cf: number, pc: number
): number {
  const base = 5 + rubberWt * 0.75
  const npmiPenalty = npmiWt * 0.4
  let izod = Math.max(2, base - npmiPenalty)

  // 인계 난연제 패널티: -88% @ 25wt% (PMC6401830)
  if (pFr > 0) {
    izod *= Math.max(0.12, 1 - (pFr / 25) * 0.88)
  }

  // UHMW-SR: +64% @ 2wt% (PMC11013094)
  if (uhmwSr > 0) izod *= 1 + (uhmwSr / 2) * 0.64

  // EMA+UHMW-SR 시너지 or EMA 단독
  if (ema > 0 && uhmwSr > 0) {
    izod *= 1 + (Math.min(ema, 10) / 5) * (Math.min(uhmwSr, 4) / 2) * 1.48
  } else if (ema > 0) {
    izod *= 1 + (ema / 5) * 0.20
  }

  // MBS 코어-셸: +0.6 kJ/m² per wt%
  izod += mbs * 0.6
  // SEBS: +0.5 kJ/m² per wt%
  izod += sebs * 0.5
  // 아크릴계: +0.35 kJ/m² per wt%
  izod += acrylicIm * 0.35
  // PC 블렌드: 인성 기여 +0.3 kJ/m² per wt%
  izod += pc * 0.3
  // CF: 취성화 경향 (-0.3 kJ/m² per wt%, notched Izod 기준)
  if (cf > 0) izod = Math.max(2, izod - cf * 0.3)

  return Math.min(izod, 100)
}

// MFI 추정 (g/10min, 220℃/10kg)
function mfiEstimate(
  npmi: number, rubber: number, lub: number,
  injTemp: number, gf: number, talc: number, ema: number,
  pc: number, nanoclay: number, cf: number, mbs: number, sebs: number, wax: number
): number {
  const base = 20
  const npmiEffect    = -npmi * 0.4
  const rubberEffect  = -rubber * 0.1
  const lubEffect     = lub * 8
  const waxEffect     = wax * 3
  const tempEffect    = (injTemp - 250) * 0.3
  const fillerEffect  = -(gf * 0.30 + talc * 0.15 + nanoclay * 0.50 + cf * 0.40)
  const emaEffect     = ema * 0.3
  const pcEffect      = -pc * 0.2      // PC 고점도
  const mbsEffect     = -mbs * 0.05
  const sebsEffect    = -sebs * 0.10
  return Math.max(1, base + npmiEffect + rubberEffect + lubEffect + waxEffect
    + tempEffect + fillerEffect + emaEffect + pcEffect + mbsEffect + sebsEffect)
}

// VOC/TVOC 추정 (µg/g, VDA278)
function vocEstimate(
  injTemp: number, rubber: number, ao: number, pFr: number,
  nanoclay: number, wax: number, antistatic: number, heatStabilizer: number
): number {
  const tempEffect  = Math.max(0, (injTemp - 250) * 2)
  const rubberEffect = rubber * 0.5
  // AO VOC 저감: 실측 3~8 µg/g @ 0.5phr — 박상현 검증 (-20 → -12)
  const aoEffect    = -ao * 12
  const frEffect    = pFr > 0 ? Math.max(0, (injTemp - 255) * pFr * 0.05) : 0
  // 나노클레이: 유기 개질제(계면활성제) → +1.5/wt%
  const nanoclayEffect = nanoclay * 1.5
  // 왁스: PE wax 저휘발, 몬탄 wax 약간 높음 → 평균 +2/phr
  const waxEffect   = wax * 2.0
  // 대전방지제 (아민계): +2/phr
  const asEffect    = antistatic * 2.0
  // 열안정제: 분해 포착 → -2/phr
  const hsEffect    = -heatStabilizer * 2.0
  // base 50: 미처리 ABS 실측 기준 (VDA 278) — 박상현 검증 (30 → 50)
  return Math.max(10, 50 + tempEffect + rubberEffect + aoEffect + frEffect
    + nanoclayEffect + waxEffect + asEffect + hsEffect)
}

// UL-94 — 인계 FR + PTFE anti-drip 보조
function ul94Rating(pFr: number, ptfe: number): 'V-0' | 'V-2' | 'HB' | 'N/A' {
  // PTFE ≥0.2wt% → V-0 임계 15wt%로 하향
  const v0Threshold = ptfe >= 0.2 ? 15 : 20
  if (pFr >= v0Threshold) return 'V-0'
  if (pFr >= 12) return 'V-2'
  if (pFr > 0) return 'HB'
  return 'N/A'
}

// 원가 지수 (₩/kg, 단위 인덱스)
function costEstimate(f: Formulation): number {
  const unit: Record<string, number> = {
    npmi: 1500, gAbs: 800, ao: 5000, lub: 3000,
    ema: 2000, uhmwSr: 8000, pFr: 1200, talc: 300, gf: 1800,
    pc: 4500, alphaMsan: 3500, nanoclay: 1800,
    mbs: 5500, sebs: 4800, acrylicIm: 4000,
    ptfe: 12000, cf: 25000,
    silane: 8000, wax: 2500, hals: 15000,
    hs: 8000, md: 30000, as: 5000,
  }
  return 2500 + (
    f.npmi * unit.npmi + f.gAbs * unit.gAbs + f.antioxidant * unit.ao * 10
    + f.lubricant * unit.lub * 10 + f.ema * unit.ema + f.uhmwSr * unit.uhmwSr
    + f.phosphorusFr * unit.pFr + f.talc * unit.talc + f.glassFiber * unit.gf
    + f.pc * unit.pc + f.alphaMsan * unit.alphaMsan + f.nanoclay * unit.nanoclay
    + f.mbs * unit.mbs + f.sebs * unit.sebs + f.acrylicIm * unit.acrylicIm
    + f.ptfe * unit.ptfe + f.carbonFiber * unit.cf
    + f.silane * unit.silane * 10 + f.wax * unit.wax * 10
    + f.hals * unit.hals * 10 + f.heatStabilizer * unit.hs * 10
    + f.metalDeact * unit.md * 10 + f.antistatic * unit.as * 10
  ) / 100
}

// 첨가제 인사이트 요약
function buildSummary(f: Formulation, izodBase: number, izodFinal: number): string[] {
  const msgs: string[] = []

  // 인계 FR
  if (f.phosphorusFr >= 20 || (f.phosphorusFr >= 15 && f.ptfe >= 0.2)) {
    msgs.push(`✅ FR: 인계 난연제 ${f.phosphorusFr}wt%${f.ptfe >= 0.2 ? ` + PTFE ${f.ptfe}wt%` : ''} → UL-94 V-0 예측`)
  } else if (f.phosphorusFr > 0) {
    const needed = f.ptfe >= 0.2 ? 15 : 20
    msgs.push(`⚠ FR: ${f.phosphorusFr}wt% — V-0은 ${needed}wt% 이상 필요${f.ptfe < 0.2 ? ' (또는 PTFE 0.2wt% 병용)' : ''}`)
  }

  // UHMW-SR + EMA 시너지
  if (f.uhmwSr > 0 && f.ema > 0) {
    const recoveryPct = Math.round(((izodFinal - izodBase) / Math.max(izodBase, 1)) * 100)
    msgs.push(`✅ UHMW-SR ${f.uhmwSr}wt% + EMA ${f.ema}wt% → 충격 약 +${recoveryPct}% 회복 (PMC11013094)`)
  } else if (f.uhmwSr > 0) {
    msgs.push(`ℹ UHMW-SR 단독 +64%↑. EMA 5wt% 추가 시 +212% (PMC11013094)`)
  }

  // PC 블렌드
  if (f.pc >= 10) {
    msgs.push(`✅ PC ${f.pc}wt% 블렌드 → 매트릭스 Tg↑, HDT 대폭 향상. 사출 온도 270~290℃ 필요`)
  } else if (f.pc > 0) {
    msgs.push(`ℹ PC ${f.pc}wt% — 소량 블렌드, 상용성 확인 필요 (PC/ABS 계면)`)
  }

  // αMSAN
  if (f.alphaMsan > 0) {
    msgs.push(`ℹ αMSAN ${f.alphaMsan}wt% → SAN 대비 Tg +13℃ 향상, HDT 추가 기여 (원가↑)`)
  }

  // 나노클레이
  if (f.nanoclay > 0) {
    const boost = (Math.min(f.nanoclay, 5) * 2).toFixed(0)
    msgs.push(`ℹ 나노클레이 ${f.nanoclay}wt% → HDT +${boost}℃ 예측, 분산 품질이 효과 좌우`)
  }

  // MBS/SEBS
  const extraIm = f.mbs + f.sebs + f.acrylicIm
  if (extraIm > 0) {
    msgs.push(`ℹ 추가 충격보강제 (MBS/SEBS/아크릴) ${extraIm.toFixed(1)}wt% → 충격↑, 투명·광택 유지 유리`)
  }

  // 카본섬유
  if (f.carbonFiber > 0) {
    msgs.push(`✅ CF ${f.carbonFiber}wt% → HDT +${(f.carbonFiber * 1.4).toFixed(0)}℃, 강성↑↑, 원가 ★★★★★ 주의`)
  }

  // 실란 커플링제
  if (f.silane >= 0.1 && (f.glassFiber > 0 || f.talc > 0)) {
    msgs.push(`✅ 실란 커플링 → GF 효율 +30%, 탈크 효율 +20% (계면 결합력 강화)`)
  }

  // HALS
  if (f.hals > 0) {
    msgs.push(`✅ HALS ${f.hals}phr → 자동차 내장재 내광성 (QUV 3000h 보증 가능 수준)`)
  }

  // GF
  if (f.glassFiber >= 20) {
    msgs.push(`✅ GF ${f.glassFiber}wt% → HDT +${(f.glassFiber * 0.75).toFixed(0)}℃↑, 외관·충격 주의`)
  }

  // 탈크
  if (f.talc > 0) {
    msgs.push(`ℹ 탈크 ${f.talc}wt% → HDT +${(f.talc * 0.5).toFixed(1)}℃, 강성·치수 안정↑`)
  }

  // 고온 사출 경고
  if (f.injTemp > 260) {
    msgs.push(`⚠ 사출온도 ${f.injTemp}℃ — 체류시간 최소화, N-PMI계 권장 260~280℃`)
  }

  return msgs
}

// ──────────────────────────────────────────────
// 메인 예측 함수
// ──────────────────────────────────────────────
export function predictColdStart(f: Formulation): PredictionResult {
  // 전체 wt% 합산 (phr 계열 제외)
  const additiveWt = f.npmi + f.gAbs + f.cbMB
    + f.ema + f.uhmwSr + f.phosphorusFr + f.talc + f.glassFiber
    + f.pc + f.alphaMsan + f.nanoclay + f.mbs + f.sebs + f.acrylicIm
    + f.ptfe + f.carbonFiber
  const sanWt = Math.max(0, 100 - additiveWt)

  // 매트릭스 Tg (Fox equation: 글라시 성분만)
  const tgMatrix = foxTg([
    { w: f.npmi,       tg: Tg_NPMI },
    { w: sanWt,        tg: sanTg(f.anContent) },
    { w: f.pc,         tg: Tg_PC },
    { w: f.alphaMsan,  tg: Tg_AMSAN },
  ])

  // HDT 패널티용: 벌크 고무(g-ABS, UHMW-SR)만 — 코어-셸(MBS/SEBS)은 매트릭스 Tg 거의 영향 없음
  const rubberForHDT  = f.gAbs + f.uhmwSr * 0.5
  // 충격·MFI 계산용: 전체 고무상 합산
  const rubberForIzod = f.gAbs + f.mbs * 0.6 + f.sebs * 0.6 + f.acrylicIm * 0.5 + f.uhmwSr

  const hdtVal  = hdtFromTg(tgMatrix, rubberForHDT, f.talc, f.glassFiber, f.nanoclay, f.carbonFiber, f.silane, f.pc)
  // Vicat: GF/CF 고함량에서 HDT-Vicat 간격 축소 (충전재는 Tg 자체를 올리지 않음)
  const vicatOffset = Math.max(4, 8 - f.glassFiber * 0.1 - f.carbonFiber * 0.15)
  const vicatVal = hdtVal + vicatOffset

  const izodBase  = izodFromRubber(f.gAbs, f.npmi, 0, 0, f.phosphorusFr, 0, 0, 0, f.carbonFiber, f.pc)
  const izodFinal = izodFromRubber(f.gAbs, f.npmi, f.ema, f.uhmwSr, f.phosphorusFr, f.mbs, f.sebs, f.acrylicIm, f.carbonFiber, f.pc)

  const mfiVal = mfiEstimate(f.npmi, rubberForIzod, f.lubricant, f.injTemp, f.glassFiber, f.talc, f.ema, f.pc, f.nanoclay, f.carbonFiber, f.mbs, f.sebs, f.wax)
  const vocVal = vocEstimate(f.injTemp, f.gAbs, f.antioxidant, f.phosphorusFr, f.nanoclay, f.wax, f.antistatic, f.heatStabilizer)
  const costVal = costEstimate(f)
  const ul94 = ul94Rating(f.phosphorusFr, f.ptfe)

  const err = (v: number, pct: number) => ({ value: v, low: v * (1 - pct), high: v * (1 + pct) })

  return {
    hdt:   err(hdtVal,   0.07),
    vicat: err(vicatVal, 0.06),
    izod:  err(izodFinal, 0.20),
    mfi:   err(mfiVal,   0.25),
    voc:   err(vocVal,   0.30),
    cost:  err(costVal,  0.10),
    ul94,
    specPass: {
      hdt:  hdtVal   >= 115 ? true : hdtVal   >= 110 ? null : false,
      izod: izodFinal >= 15  ? true : izodFinal >= 10  ? null : false,
      voc:  vocVal   <= 50  ? true : vocVal   <= 70  ? null : false,
    },
    confidence: 'cold',
    additiveSummary: buildSummary(f, izodBase, izodFinal),
  }
}

// ──────────────────────────────────────────────
// DOE 설계 생성
// ──────────────────────────────────────────────
export interface DOEFactor {
  name: string; unit: string; low: number; center: number; high: number
}
export interface DOERun {
  id: number; factors: Record<string, number>; label: string
}

const PB12_MATRIX = [
  [1,1,-1,1,1,1,-1],[-1,1,1,-1,1,1,1],[1,-1,1,1,-1,1,1],
  [1,1,-1,1,1,-1,1],[1,1,1,-1,1,1,-1],[-1,1,1,1,-1,1,1],
  [1,-1,1,1,1,-1,1],[1,1,-1,1,1,1,-1],[-1,-1,1,1,-1,1,1],
  [1,-1,-1,1,1,-1,1],[-1,1,-1,-1,1,1,1],[-1,-1,-1,-1,-1,-1,-1],
]

const BB3_MATRIX = [
  [-1,-1,0],[1,-1,0],[-1,1,0],[1,1,0],
  [-1,0,-1],[1,0,-1],[-1,0,1],[1,0,1],
  [0,-1,-1],[0,1,-1],[0,-1,1],[0,1,1],
  [0,0,0],[0,0,0],[0,0,0],
]

export function generateScreeningDOE(factors: DOEFactor[]): DOERun[] {
  const nF = Math.min(factors.length, 7)
  return PB12_MATRIX.map((row, i) => {
    const fvals: Record<string, number> = {}
    factors.slice(0, nF).forEach((f, j) => { fvals[f.name] = row[j] === 1 ? f.high : row[j] === -1 ? f.low : f.center })
    factors.slice(nF).forEach(f => { fvals[f.name] = f.center })
    return { id: i + 1, factors: fvals, label: `PB-${i + 1}` }
  })
}

export function generateRSMDOE(factors: DOEFactor[]): DOERun[] {
  const top3 = factors.slice(0, 3)
  return BB3_MATRIX.map((row, i) => {
    const fvals: Record<string, number> = {}
    top3.forEach((f, j) => { fvals[f.name] = row[j] === 1 ? f.high : row[j] === -1 ? f.low : f.center })
    factors.slice(3).forEach(f => { fvals[f.name] = f.center })
    return { id: i + 1, factors: fvals, label: `BB-${i + 1}` }
  })
}

export const DEFAULT_FACTORS: DOEFactor[] = [
  { name: 'N-PMI',     unit: 'wt%', low: 10, center: 17, high: 25 },
  { name: 'g-ABS',     unit: 'wt%', low: 20, center: 30, high: 40 },
  { name: 'AN 함량',   unit: '%',   low: 24, center: 28, high: 32 },
  { name: 'EMA 상용화제', unit: 'wt%', low: 0, center: 3, high: 10 },
  { name: 'UHMW-SR',   unit: 'wt%', low: 0, center: 1,  high: 4  },
  { name: '인계 난연제', unit: 'wt%', low: 0, center: 12, high: 25 },
  { name: '탈크',      unit: 'wt%', low: 0, center: 7,  high: 15 },
]
