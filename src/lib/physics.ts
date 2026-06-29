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
  // ── 미세구조 (선택) — 기본값에서 효과 중립
  gAbsRubber?:  number   // g-ABS 내 고무(PB) 함량 % (기준 50)
  rubberPSize?: number   // 고무 평균 입경 μm (기준 0.3)
  sanMw?:       number   // SAN 분자량 지수 (기준 100)
  gelContent?:  number   // 고무 가교도(겔 함량) % (기준 75)
  pcMw?:        number   // PC 분자량 지수 (기준 100)
  alphaMsanMw?: number   // αMSAN 분자량 지수 (기준 100)
  // ── 환경/공정 조건 (선택) — 표준 조건(23℃, 50%RH, 건조)에서 중립
  ambientTemp?:   number // 외기/서비스 온도 ℃ (기준 23)
  humidity?:      number // 상대습도 %RH (기준 50)
  materialDried?: boolean // 건조 여부 (기준 true)
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
  hdt:     { value: number; low: number; high: number }
  hdt045:  { value: number; low: number; high: number }   // HDT @ 0.45 MPa
  vicat:   { value: number; low: number; high: number }
  izod:    { value: number; low: number; high: number }
  tensile: { value: number; low: number; high: number }   // NEW
  density: { value: number; low: number; high: number }   // NEW
  mfi:     { value: number; low: number; high: number }   // 220℃/10kg (기존)
  mi200:   { value: number; low: number; high: number }   // NEW: 200℃/21.6kg
  mi250_2: { value: number; low: number; high: number }   // NEW: 250℃/2.16kg
  mi250_5: { value: number; low: number; high: number }   // NEW: 250℃/5kg
  voc:     { value: number; low: number; high: number }
  cost:    { value: number; low: number; high: number }
  ul94:    'V-0' | 'V-2' | 'HB' | 'N/A'
  segment: 'ABS' | 'ABS+PC' | 'PC+ABS' | 'αMSAN-ABS'   // NEW
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

// 고무 입경 충격 효율 — 0.3μm에서 최대인 로그정규 종형 (기준 0.3 → 1.0)
function psizeEfficiency(d: number): number {
  const dd = Math.max(0.02, d)
  return Math.exp(-((Math.log(dd / 0.3)) ** 2) / (2 * 0.55 ** 2))
}
// 가교도(겔) 충격 효율 — 75%에서 최대인 종형 (기준 75 → 1.0)
function gelEfficiency(g: number): number {
  return Math.exp(-((g - 75) ** 2) / (2 * 18 ** 2))
}

// HDT (1.8 MPa) — 경험식 + 충전재 + 나노클레이 + CF + 실란 보정
function hdtFromTg(
  tg: number, rubberWt: number,
  talc: number, gf: number, nanoclay: number, cf: number,
  silane: number, pc: number
): number {
  const rubberPenalty = rubberWt * 0.45
  // 충전재 HDT 기여 — 포화형(지수) 강화 (선형 무한증가 제거)
  const silaneMultiplier = silane >= 0.1 ? 1.3 : 1.0
  // 탈크: 소량 기여, plateau ~+7℃
  const talcBoost = 7 * (1 - Math.exp(-talc / 14)) * (silane >= 0.1 ? 1.2 : 1.0)
  // GF: ~0.8℃/wt% 초기, plateau ~+20℃ — 조태웅 검증
  const gfBoost   = 20 * (1 - Math.exp(-gf / 25)) * silaneMultiplier
  // CF: ~1.4℃/wt% 초기, plateau ~+30℃ — 조태웅 검증
  const cfBoost   = 30 * (1 - Math.exp(-cf / 21))
  // 나노클레이: 최대 5wt%에서 효과 포화 (MMT 층간 분산), cap ~+6.5℃
  const nanoclayBoost = Math.min(nanoclay, 5) * 1.3
  // PC 블렌드: 상 블렌드 기여 — PC 분율의 로지스틱(상반전 ~30-40%), pc=0에서 0
  const pcVol = pc / 100
  const pcBoost = 48 * (1 / (1 + Math.exp(-(pcVol - 0.30) / 0.10)) - 1 / (1 + Math.exp(0.30 / 0.10)))
  return tg - 17 - rubberPenalty + talcBoost + gfBoost + cfBoost + nanoclayBoost + pcBoost
}

// Izod 충격 (kJ/m²)
function izodFromRubber(
  rubberWt: number, npmiWt: number,
  ema: number, uhmwSr: number, pFr: number,
  mbs: number, sebs: number, acrylicIm: number,
  cf: number, pc: number
): number {
  // 고무 기여: 로지스틱 S-curve (체감, plateau ~34, knee ~16wt%)
  const base = 3 + 31 / (1 + Math.exp(-(rubberWt - 16) / 6))
  const npmiPenalty = npmiWt * 0.4
  let izod = Math.max(2, base - npmiPenalty)

  // 인계 난연제 패널티: 완화 (PMC6401830)
  if (pFr > 0) {
    izod *= Math.max(0.35, 1 - (pFr / 25) * 0.6)
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

  // 충격보강제 시너지 폭주 방지: 고무 base의 3.5배 소프트 캡
  izod = Math.min(izod, base * 3.5)

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
  // 온도 의존: 지수형 (250℃ 중립, 이상 급상승, 미만 완만 감소)
  const tempEffect  = 16 * (Math.exp((injTemp - 250) / 24) - 1)
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
  return Math.max(15, 50 + tempEffect + rubberEffect + aoEffect + frEffect
    + nanoclayEffect + waxEffect + asEffect + hsEffect)
}

// UL-94 — 인계 FR + PTFE anti-drip 보조
function ul94Rating(pFr: number, ptfe: number, pc: number): 'V-0' | 'V-2' | 'HB' | 'N/A' {
  // PC 함유 시 난연 임계 하향(char 형성), 순수 ABS는 상향. PTFE anti-drip 보조.
  const v0Threshold = pc >= 40 ? 10 : pc >= 20 ? 14 : (ptfe >= 0.2 ? 18 : 22)
  const v2Threshold = pc >= 20 ? 8 : 12
  if (pFr >= v0Threshold) return 'V-0'
  if (pFr >= v2Threshold) return 'V-2'
  if (pFr > 0) return 'HB'
  return 'N/A'
}

// 원가 지수 (₩/kg, 단위 인덱스) — 사용자 편집 가능 단가 테이블
export interface UnitCosts {
  npmi:number; gAbs:number; ao:number; lub:number; ema:number; uhmwSr:number;
  pFr:number; talc:number; gf:number; pc:number; alphaMsan:number; nanoclay:number;
  mbs:number; sebs:number; acrylicIm:number; ptfe:number; cf:number;
  silane:number; wax:number; hals:number; hs:number; md:number; as:number; base:number;
}

export const DEFAULT_UNIT_COSTS: UnitCosts = {
  npmi: 1500, gAbs: 800, ao: 5000, lub: 3000,
  ema: 2000, uhmwSr: 8000, pFr: 1200, talc: 300, gf: 1800,
  pc: 4500, alphaMsan: 3500, nanoclay: 1800,
  mbs: 5500, sebs: 4800, acrylicIm: 4000,
  ptfe: 12000, cf: 45000,
  silane: 8000, wax: 2500, hals: 15000,
  hs: 8000, md: 30000, as: 5000,
  base: 2500,
}

let activeUnitCosts: UnitCosts = { ...DEFAULT_UNIT_COSTS }
export function setUnitCosts(c: UnitCosts) { activeUnitCosts = c }
export function getUnitCosts(): UnitCosts { return activeUnitCosts }

function costEstimate(f: Formulation): number {
  const unit = activeUnitCosts
  return unit.base + (
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
interface EnvSummaryCtx {
  residualMoisture: number
  moistureExcess: number
  moistureKnockdown: number
  ambientTemp: number
  izodTempFactor: number
  pcMw: number
  alphaMsanMw: number
}

function buildSummary(f: Formulation, izodBase: number, izodFinal: number, env?: EnvSummaryCtx): string[] {
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

  // 미세구조 (선택) 인사이트
  if (f.rubberPSize != null && Math.abs(f.rubberPSize - 0.3) > 0.1) {
    msgs.push(`ℹ 고무 입경 ${f.rubberPSize}μm — 충격효율 ${(psizeEfficiency(f.rubberPSize) * 100).toFixed(0)}% (최적 ~0.3μm)`)
  }
  if (f.gelContent != null && Math.abs(f.gelContent - 75) > 8) {
    msgs.push(`ℹ 고무 가교도(겔) ${f.gelContent}% — 충격효율 ${(gelEfficiency(f.gelContent) * 100).toFixed(0)}% (최적 ~75%)`)
  }
  if (f.sanMw != null && Math.abs(f.sanMw - 100) > 5) {
    msgs.push(`ℹ SAN 분자량지수 ${f.sanMw} — ${f.sanMw > 100 ? '점도↑·MFI↓·인성↑' : '점도↓·MFI↑·인성↓'} (기준 100)`)
  }

  // 고온 사출 경고
  if (f.injTemp > 260) {
    msgs.push(`⚠ 사출온도 ${f.injTemp}℃ — 체류시간 최소화, N-PMI계 권장 260~280℃`)
  }

  // PC 분자량 지수
  if (env && f.pc > 0 && Math.abs(env.pcMw - 100) > 1) {
    msgs.push(`ℹ PC 분자량지수 ${env.pcMw} — ${env.pcMw > 100 ? '점도↑·MFI↓·PC-ABS 인성↑' : '점도↓·MFI↑·인성↓'} (PC ${f.pc}wt% 가중)`)
  }
  if (env && f.alphaMsan > 0 && Math.abs(env.alphaMsanMw - 100) > 1) {
    msgs.push(`ℹ αMSAN 분자량지수 ${env.alphaMsanMw} — ${env.alphaMsanMw > 100 ? '점도↑·MFI↓' : '점도↓·MFI↑'} (αMSAN ${f.alphaMsan}wt% 가중)`)
  }

  // 환경/공정 위험
  if (env) {
    if (env.moistureExcess > 0.1) {
      msgs.push(`⚠ 미건조/고습 → 잔류수분 ${env.residualMoisture.toFixed(2)}% → 실버스트릭·스플레이 위험`)
    }
    if (env.moistureExcess > 0.2 && f.pc > 0) {
      msgs.push(`❌ PC 함유 + 고수분 → 가수분해로 충격·인장 저하 (충격 ×${env.moistureKnockdown.toFixed(2)})`)
    }
    if (env.ambientTemp < 0) {
      msgs.push(`ℹ 서비스 온도 ${env.ambientTemp}℃ → 저온 취성, 충격 ×${env.izodTempFactor.toFixed(2)} (기준 23℃ 대비)`)
    }
  }

  return msgs
}

// 인장강도 (MPa) — 경험식
export function tensileStrength(f: Formulation, sanWt: number): number {
  const baseTensile = 35 + (f.anContent - 24) * 0.8
  const rubberTot = f.gAbs + f.uhmwSr * 0.5 + f.mbs * 0.5 + f.sebs * 0.5 + f.acrylicIm * 0.5
  const rubberPenalty = rubberTot * 0.35
  const npmiEffect = f.npmi * 0.2
  const silaneMultiplier = f.silane >= 0.1 ? 1.3 : 1.0
  const gfEffect = 35 * (1 - Math.exp(-f.glassFiber / 23)) * silaneMultiplier
  const cfEffect = 55 * (1 - Math.exp(-f.carbonFiber / 18))
  const talcEffect = 6 * (1 - Math.exp(-f.talc / 12)) * (f.silane >= 0.1 ? 1.2 : 1.0)
  const nanoclayEffect = 6 * (1 - Math.exp(-Math.min(f.nanoclay, 8) / 4))
  const pcEffect = f.pc * 0.25
  const frEffect = -f.phosphorusFr * 0.35
  const softEffect = -(f.ema * 0.8 + f.uhmwSr * 0.3)
  const alphamsanEffect = f.alphaMsan * 0.15
  void sanWt
  return Math.max(15, Math.min(100, baseTensile - rubberPenalty + npmiEffect + gfEffect + cfEffect + talcEffect + nanoclayEffect + pcEffect + frEffect + softEffect + alphamsanEffect))
}

// 비중 (g/cm³) — 원료 밀도 가중평균
export function densityCalc(f: Formulation, sanWt: number): number {
  const parts: Array<{ w: number; d: number }> = [
    { w: f.npmi,         d: 1.068 },
    { w: f.gAbs,         d: 1.040 },
    { w: sanWt,          d: 1.080 },
    { w: f.cbMB,         d: 1.150 },
    { w: f.pc,           d: 1.200 },
    { w: f.alphaMsan,    d: 1.090 },
    { w: f.nanoclay,     d: 1.800 },
    { w: f.ema,          d: 0.940 },
    { w: f.uhmwSr,       d: 0.970 },
    { w: f.mbs,          d: 1.100 },
    { w: f.sebs,         d: 0.920 },
    { w: f.acrylicIm,    d: 1.070 },
    { w: f.phosphorusFr, d: 1.300 },
    { w: f.ptfe,         d: 2.200 },
    { w: f.talc,         d: 2.750 },
    { w: f.glassFiber,   d: 2.540 },
    { w: f.carbonFiber,  d: 1.780 },
    { w: f.antioxidant,  d: 1.050 },
    { w: f.lubricant,    d: 0.970 },
  ]
  // 역혼합법칙 (부피 기반): ρ_blend = ΣW / Σ(W/d)
  let totalW = 0, totalVol = 0
  for (const { w, d } of parts) {
    if (w > 0) { totalW += w; totalVol += w / d }
  }
  return totalVol > 1e-9 ? totalW / totalVol : 1.06
}

// 세그먼트 분류 (v13 로직 준용)
export function classifySegment(f: Formulation): 'ABS' | 'ABS+PC' | 'PC+ABS' | 'αMSAN-ABS' {
  const pcRatio = f.pc / Math.max(1, f.npmi + f.gAbs + f.pc + f.alphaMsan)
  if (pcRatio >= 0.40) return 'PC+ABS'
  if (f.pc >= 5) return 'ABS+PC'
  if (f.alphaMsan >= 15) return 'αMSAN-ABS'
  return 'ABS'
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

  // ── 미세구조 파라미터 (기본값에서 모든 배수 = 1.0 → 예측 불변)
  const gAbsRubber  = f.gAbsRubber  ?? 50
  const rubberPSize = f.rubberPSize ?? 0.3
  const sanMw       = f.sanMw       ?? 100
  const gelContent  = f.gelContent  ?? 75
  // 실효 고무 배수 (고무함량 기준 50% 대비)
  const rubberContentFactor = gAbsRubber / 50
  // 충격 효율 (입경 × 가교도), 기준값(0.3μm, 75%)에서 1.0
  const impactEff = psizeEfficiency(rubberPSize) * gelEfficiency(gelContent)
  // SAN 분자량 배수 (기준 100)
  const mwFactor = sanMw / 100

  // ── PC / αMSAN 분자량 지수 (기준 100, 함량 0이면 중립)
  const pcMw        = f.pcMw        ?? 100
  const alphaMsanMw = f.alphaMsanMw ?? 100
  const pcMwF  = pcMw / 100
  const amMwF  = alphaMsanMw / 100

  // ── 환경/공정 조건 (표준: 23℃, 50%RH, 건조 → 모두 중립)
  const ambientTemp   = f.ambientTemp   ?? 23
  const humidity      = f.humidity      ?? 50
  const materialDried = f.materialDried ?? true
  const residualMoisture = materialDried ? 0.02 : (0.05 + (humidity / 100) * 0.45)
  const moistureExcess = Math.max(0, residualMoisture - 0.05)
  const pcAmp = 1 + (f.pc / 100) * 3
  const moistureKnockdown = Math.max(0.6, 1 - moistureExcess * 0.25 * pcAmp)
  const izodTempFactor = ambientTemp >= 23
    ? 1 + (ambientTemp - 23) * 0.004
    : Math.max(0.35, 1 - (23 - ambientTemp) * 0.008 - Math.max(0, (-10 - ambientTemp)) * 0.010)

  // 매트릭스 Tg (Fox equation: 미시블 SAN상만 — PC는 비미시블이라 제외)
  const tgMatrix = foxTg([
    { w: f.npmi,       tg: Tg_NPMI },
    { w: sanWt,        tg: sanTg(f.anContent) },
    { w: f.alphaMsan,  tg: Tg_AMSAN },
  ])

  // HDT 패널티용: 벌크 고무(g-ABS, UHMW-SR)만 — 코어-셸(MBS/SEBS)은 매트릭스 Tg 거의 영향 없음
  const rubberForHDT  = f.gAbs * rubberContentFactor + f.uhmwSr * 0.5
  // 충격·MFI 계산용: 전체 고무상 합산
  const rubberForIzod = f.gAbs + f.mbs * 0.6 + f.sebs * 0.6 + f.acrylicIm * 0.5 + f.uhmwSr

  const hdtVal  = hdtFromTg(tgMatrix, rubberForHDT, f.talc, f.glassFiber, f.nanoclay, f.carbonFiber, f.silane, f.pc)
  // Vicat: Tg로부터 독립 산정 (비정질 Vicat B50 ≈ Tg − ~6℃), 물리적으로 항상 ≥ HDT
  let vicatVal = tgMatrix - 6 - rubberForHDT * 0.15
  vicatVal = Math.max(vicatVal, hdtVal + 4)

  // 실효 g-ABS (고무함량 × 충격효율) — 기준값에서 f.gAbs 그대로
  const gAbsEff = f.gAbs * rubberContentFactor * impactEff
  const izodBase  = izodFromRubber(gAbsEff, f.npmi, 0, 0, f.phosphorusFr, 0, 0, 0, f.carbonFiber, f.pc)
  let izodFinal   = izodFromRubber(gAbsEff, f.npmi, f.ema, f.uhmwSr, f.phosphorusFr, f.mbs, f.sebs, f.acrylicIm, f.carbonFiber, f.pc)
  // SAN 분자량 매트릭스 인성 (기준 100 → ×1)
  izodFinal *= mwFactor ** 0.3
  // 나노클레이 취성화 (−4%/wt%, cap 8wt%, nanoclay=0 중립)
  izodFinal *= (1 - Math.min(f.nanoclay, 8) * 0.04)
  // 고분자량 PC → PC-ABS 인성↑ (PC 함량 가중, cap pc/40)
  izodFinal *= Math.pow(pcMwF, 0.4 * Math.min(f.pc / 40, 1))
  // 환경: 수분 가수분해 + 서비스/시험 온도
  izodFinal *= moistureKnockdown * izodTempFactor

  let mfiVal = mfiEstimate(f.npmi, rubberForIzod, f.lubricant, f.injTemp, f.glassFiber, f.talc, f.ema, f.pc, f.nanoclay, f.carbonFiber, f.mbs, f.sebs, f.wax)
  // SAN 분자량↑ → 점도↑ → MFI↓ (기준 100 → ×1)
  mfiVal *= (1 / mwFactor) ** 1.5
  // 고분자량 PC/αMSAN → 점도↑ → MFI↓ (함량 가중, 함량 0이면 중립)
  const flowMwAdj = Math.pow(1 / pcMwF, 1.0 * (f.pc / 100)) * Math.pow(1 / amMwF, 0.8 * (f.alphaMsan / 100))
  mfiVal *= flowMwAdj
  let vocVal = vocEstimate(f.injTemp, f.gAbs, f.antioxidant, f.phosphorusFr, f.nanoclay, f.wax, f.antistatic, f.heatStabilizer)
  // 미건조/고습 → 잔류수분 휘발분 추가
  vocVal += moistureExcess * 20
  const costVal = costEstimate(f)
  const ul94 = ul94Rating(f.phosphorusFr, f.ptfe, f.pc)

  const err = (v: number, pct: number) => ({ value: v, low: v * (1 - pct), high: v * (1 + pct) })

  const tensileVal = tensileStrength(f, sanWt) * (sanMw / 100) ** 0.2 * moistureKnockdown
  const densityVal = densityCalc(f, sanWt)
  // MI 4조건: Arrhenius(온도) + power-law(하중). mfiVal(220℃/10kg) 기준, 모든 흐름 보정 후 파생.
  // Ea=120 kJ/mol (ABS 실측), 하중 지수 1.3 (전단박화 반영) — v13 실측(1,744 exp) ordering 일치
  const _Ea = 120000, _R = 8.314
  const _tempF = (T: number) => Math.exp(_Ea / _R * (1 / 493.15 - 1 / (T + 273.15)))
  const _loadF = (L: number) => Math.pow(L / 10, 1.3)
  const mi200Val   = mfiVal * _tempF(200) * _loadF(21.6)
  const mi250_2Val = mfiVal * _tempF(250) * _loadF(2.16)
  const mi250_5Val = mfiVal * _tempF(250) * _loadF(5)
  const segment    = classifySegment(f)

  // HDT @ 0.45 MPa: 저하중 조건 — 경험식 hdt045 ≈ hdt_1.8 + 15℃ (GF/탈크 고함량은 차이 축소)
  const hdt045Val = hdtVal + 15 - f.glassFiber * 0.22 - f.talc * 0.15 - f.carbonFiber * 0.25

  return {
    hdt:     err(hdtVal,    0.07),
    hdt045:  err(hdt045Val, 0.07),
    vicat:   err(vicatVal,  0.06),
    izod:    err(izodFinal, 0.20),
    tensile: err(tensileVal, 0.08),
    density: { value: densityVal, low: densityVal * 0.995, high: densityVal * 1.005 },
    mfi:     err(mfiVal,    0.25),
    mi200:   err(mi200Val,  0.25),
    mi250_2: err(mi250_2Val, 0.25),
    mi250_5: err(mi250_5Val, 0.25),
    voc:     err(vocVal,    0.30),
    cost:    err(costVal,   0.10),
    ul94,
    segment,
    specPass: {
      hdt:  hdtVal   >= 115 ? true : hdtVal   >= 110 ? null : false,
      izod: izodFinal >= 15  ? true : izodFinal >= 10  ? null : false,
      voc:  vocVal   <= 50  ? true : vocVal   <= 70  ? null : false,
    },
    confidence: 'cold',
    additiveSummary: buildSummary(f, izodBase, izodFinal, {
      residualMoisture, moistureExcess, moistureKnockdown,
      ambientTemp, izodTempFactor, pcMw, alphaMsanMw,
    }),
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

// ──────────────────────────────────────────────
// 민감도 분석
// ──────────────────────────────────────────────
const SENS_KEYS: (keyof Formulation)[] = [
  'npmi','gAbs','anContent','pc','alphaMsan','nanoclay',
  'ema','uhmwSr','mbs','sebs','acrylicIm',
  'phosphorusFr','talc','glassFiber','carbonFiber',
  'silane','injTemp','antioxidant','lubricant','wax',
]
const SENS_DELTA: Partial<Record<keyof Formulation, number>> = {
  anContent: 1, injTemp: 5,
}
export type SensProp = 'hdt' | 'izod' | 'tensile' | 'mfi' | 'voc' | 'density'
export function computeSensitivity(f: Formulation, prop: SensProp): Array<{ key: string; label: string; value: number }> {
  const getPropVal = (r: PredictionResult) => r[prop].value
  const base = getPropVal(predictColdStart(f))
  const results: Array<{ key: string; label: string; raw: number }> = []
  const LABELS: Record<string, string> = {
    npmi: 'N-PMI', gAbs: 'g-ABS(고무)', anContent: 'AN 함량',
    pc: 'PC 블렌드', alphaMsan: 'αMSAN', nanoclay: '나노클레이',
    ema: 'EMA 상용화제', uhmwSr: 'UHMW-SR', mbs: 'MBS', sebs: 'SEBS',
    acrylicIm: '아크릴계IM', phosphorusFr: '인계 FR', talc: '탈크',
    glassFiber: 'GF 유리섬유', carbonFiber: 'CF 카본섬유',
    silane: '실란 커플링', injTemp: '사출 온도',
    antioxidant: '산화방지제', lubricant: '활제(EBS)', wax: '왁스',
  }
  void base
  for (const key of SENS_KEYS) {
    const delta = SENS_DELTA[key] ?? 2
    const cur = f[key] as number
    const fPlus: Formulation = { ...f, [key]: cur + delta }
    const fMinus: Formulation = { ...f, [key]: Math.max(0, cur - delta) }
    const vPlus = getPropVal(predictColdStart(fPlus))
    const vMinus = getPropVal(predictColdStart(fMinus))
    const sens = (vPlus - vMinus) / (2 * delta)
    results.push({ key, raw: sens, label: LABELS[key] ?? key })
  }
  const maxAbs = Math.max(...results.map(r => Math.abs(r.raw)), 0.001)
  return results
    .map(r => ({ key: r.key, label: r.label, value: r.raw / maxAbs }))
    .filter(r => Math.abs(r.value) >= 0.04)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 12)
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
