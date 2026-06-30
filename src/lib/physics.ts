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
  // ── 가공·이방성 (선택) — 기본값에서 효과 중립
  compoundingShear?: 'low' | 'med' | 'high' // 컴파운딩 전단 (기준 'med')
  weldLinePresent?:  boolean               // 웰드라인 존재 (기준 false)
  // ── 형태학·시험 조건 (선택) — 기본값에서 효과 중립
  rubberBimodal?: number  // 이중분포 대입자 비율 % (기준 0 = 단일분포)
  graftRatio?:    number  // 그래프트율 % (기준 40)
  annealed?:      boolean // 어닐링(응력완화) (기준 false)
  notchType?:     'notched' | 'unnotched' // 노치/무노치 (기준 'notched')
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
  izodUnnotched: { value: number; low: number; high: number }  // NEW: 무노치 Izod
  tensile: { value: number; low: number; high: number }   // NEW
  tensileCross: { value: number; low: number; high: number }   // NEW: 직각방향(이방성)
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
  silane: number, pc: number,
  fiberEff = 1.0,   // B1: 컴파운딩 전단 → 섬유 보강효율 (기준 'med'에서 1.0)
  pcCompat = 1.0,   // A3: PC/SAN 상용성 (AN=25에서 1.0). pc=0이면 pcBoost=0이라 무관.
  npmi = 0          // N-PMI wt% — PC 블렌드 시 N-PMI·PC 내열 이중계상 보정용
): number {
  const rubberPenalty = rubberWt * 0.45
  // 충전재 HDT 기여 — 포화형(지수) 강화 (선형 무한증가 제거)
  const silaneMultiplier = silane >= 0.1 ? 1.3 : 1.0
  // 탈크: 소량 기여, plateau ~+7℃
  const talcBoost = 7 * (1 - Math.exp(-talc / 14)) * (silane >= 0.1 ? 1.2 : 1.0)
  // GF: ~0.8℃/wt% 초기, plateau ~+20℃ — 조태웅 검증 (B1: fiberEff 적용)
  const gfBoost   = 20 * (1 - Math.exp(-gf / 25)) * silaneMultiplier * fiberEff
  // CF: ~1.4℃/wt% 초기, plateau ~+30℃ — 조태웅 검증 (B1: fiberEff 적용)
  const cfBoost   = 30 * (1 - Math.exp(-cf / 21)) * fiberEff
  // 나노클레이: 최대 5wt%에서 효과 포화 (MMT 층간 분산), cap ~+6.5℃
  const nanoclayBoost = Math.min(nanoclay, 5) * 1.3
  // PC 블렌드: 상 블렌드 기여 — PC 분율의 로지스틱(상반전 ~30-40%), pc=0에서 0
  // A3: PC/SAN 상용성 계수(pcCompat) 적용 — PC 함유 블렌드에만 영향(pc=0이면 0)
  // PC HDT 기여 — 포화형(지수): 고PC에서 급등 후 plateau (157→175 폭주 제거)
  // 실측 curve: pc30→~+31, pc50→~+41, pc60→~+44 (그 이상 saturating)
  const pcBoost = 52 * (1 - Math.exp(-pc / 33)) * pcCompat
  // PC·N-PMI 이중계상 보정: PC가 비미시블 분산상으로 들어오면 N-PMI-SAN 매트릭스의
  // 부피분율이 줄어 매트릭스 Tg가 블렌드 HDT를 과대평가 → PC 분율×N-PMI 만큼 차감
  const pcNpmiCorr = npmi * (pc / 100) * 4.6
  return tg - 17 - rubberPenalty + talcBoost + gfBoost + cfBoost + nanoclayBoost + pcBoost - pcNpmiCorr
}

// Izod 충격 (kJ/m²)
function izodFromRubber(
  rubberWt: number, npmiWt: number,
  ema: number, uhmwSr: number, pFr: number,
  mbs: number, sebs: number, acrylicIm: number,
  cf: number, pc: number, alphaMsan = 0, gf = 0, talc = 0
): number {
  // 고무 기여: 로지스틱 S-curve (체감, plateau ~46, knee ~16wt%)
  const base = 3 + 44 / (1 + Math.exp(-(rubberWt - 16) / 7))
  // 강성 내열 매트릭스(N-PMI·αMSAN)는 취성화 → 충격 패널티.
  // N-PMI 취성화는 매트릭스가 glassy해지며 포화(saturating S-curve): 저함량은 완만,
  // ~20% 부근에서 급격히 취성화 후 plateau (추가 N-PMI는 노치감도 추가 증가 미미).
  // 과거 2차항(npmi²·k)은 고함량에서 무한 증가해 mid(22%)/high(25%) 동시 정합 불가 →
  // 물리적 포화형 로지스틱으로 교체 (npmi17에서 ~10 유지: GP/고충격/중충격 izod 불변).
  const npmiPenalty = 24.5 / (1 + Math.exp(-(npmiWt - 17.44) / 1.18)) + alphaMsan * 0.42
  let izod = Math.max(2, base - npmiPenalty)
  // 탈크: 강성 충전재 → 노치 취성화 (saturating, talc=0 중립)
  if (talc > 0) izod = Math.max(2, izod - 9 * (1 - Math.exp(-talc / 16)))

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
  // PC 블렌드: PC/ABS는 매우 강인 — 포화형+선형 기여. 약간 완화(amp 33→31, lin 0.25→0.18)해
  // pcabs30/50/고충격 과대예측을 정정 (pc30→~+30, pc50→~+39, pc60→~+42)
  izod += 31 * (1 - Math.exp(-pc / 18)) + 0.18 * pc
  // CF: 취성화 경향 (-0.3 kJ/m² per wt%, notched Izod 기준)
  if (cf > 0) izod = Math.max(2, izod - cf * 0.3)
  // GF: 노치 취성화 — 완만(saturating). gf30 실측이 gf20보다 높아 강한 패널티는 역효과 → 약하게.
  if (gf > 0) izod = Math.max(2, izod - 3 * (1 - Math.exp(-gf / 20)))
  void gf

  // 충격보강제 시너지 폭주 방지: 고무 base의 3.5배 소프트 캡
  izod = Math.min(izod, base * 3.5)

  return Math.min(izod, 100)
}

// MFI 추정 (g/10min, 220℃/10kg)
function mfiEstimate(
  npmi: number, rubber: number, lub: number,
  injTemp: number, gf: number, talc: number, ema: number,
  pc: number, nanoclay: number, cf: number, mbs: number, sebs: number, wax: number,
  alphaMsan = 0, pFr = 0
): number {
  const base = 81.6
  // N-PMI 직접 유동 패널티: 완만한 선형 + 약한 2차(convex). 과거 -2.74·npmi 단일항이
  // 고함량에서 과도하게 지배(near-zero clamp)하던 것을 완화하고, 내열 grade의 점도상승은
  // 분자량 경로(sanMw factor (100/sanMw)^1.5)로 분담. base는 GP(npmi17·sanMw100)=30 유지하도록 재정합.
  const npmiEffect    = -(npmi * 2.0 + npmi * npmi * 0.012)
  const alphaMsanEff  = -alphaMsan * 0.72  // αMSAN 고점도
  const rubberEffect  = -rubber * 1.07
  const lubEffect     = lub * 8
  const waxEffect     = wax * 3
  const tempEffect    = (injTemp - 250) * 0.3
  const fillerEffect  = -(gf * 1.03 + talc * 0.81 + nanoclay * 0.50 + cf * 1.77)
  const frEffect      = -pFr * 0.64        // 인계 FR → 점도↑ (실측 MFI↓)
  const emaEffect     = ema * 0.3
  const pcEffect      = -pc * 0.42      // PC 고점도
  const mbsEffect     = -mbs * 0.05
  const sebsEffect    = -sebs * 0.10
  return Math.max(1, base + npmiEffect + alphaMsanEff + rubberEffect + lubEffect + waxEffect
    + tempEffect + fillerEffect + frEffect + emaEffect + pcEffect + mbsEffect + sebsEffect)
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
export function tensileStrength(f: Formulation, sanWt: number, fiberEff = 1.0): number {
  const baseTensile = 42 + (f.anContent - 24) * 0.8
  const rubberTot = f.gAbs + f.uhmwSr * 0.5 + f.mbs * 0.5 + f.sebs * 0.5 + f.acrylicIm * 0.5
  const rubberPenalty = rubberTot * 0.20
  const npmiEffect = f.npmi * 0.2
  const silaneMultiplier = f.silane >= 0.1 ? 1.3 : 1.0
  // B1: 컴파운딩 전단 → 섬유 보강효율 (기준 'med'에서 1.0)
  const gfEffect = 52 * (1 - Math.exp(-f.glassFiber / 25)) * silaneMultiplier * fiberEff
  const cfEffect = 75 * (1 - Math.exp(-f.carbonFiber / 15)) * fiberEff
  const talcEffect = 3 * (1 - Math.exp(-f.talc / 12)) * (f.silane >= 0.1 ? 1.2 : 1.0)
  const nanoclayEffect = 6 * (1 - Math.exp(-Math.min(f.nanoclay, 8) / 4))
  const pcEffect = f.pc * 0.25
  const frEffect = -f.phosphorusFr * 0.10
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
// 실험 재현성(scatter) 모델 — "실험 예상 범위 (95%)"
// ──────────────────────────────────────────────
// 실제 ABS 시험은 고유 반복정밀도(repeatability) 산포를 가진다 (inter-lot/inter-lab, 1σ).
// 물성별 상대(rel)·절대(abs) 산포를 결합해 1σ = sqrt((rel·value)² + abs²),
// 95% 실험 예상 범위 = value ± 1.96σ. (기존 고정 ±% 밴드를 대체)
export type ScatterProp =
  | 'hdt' | 'vicat' | 'izod' | 'tensile' | 'mfi' | 'density' | 'voc'

const TEST_SCATTER: Record<ScatterProp, { rel: number; abs: number }> = {
  hdt:     { rel: 0.025, abs: 1.5 },   // ℃ : ~±2-3℃ 95%
  vicat:   { rel: 0.02,  abs: 1.5 },
  izod:    { rel: 0.12,  abs: 1.0 },   // notched Izod scatters a lot
  tensile: { rel: 0.05,  abs: 1.0 },
  mfi:     { rel: 0.10,  abs: 0.5 },
  density: { rel: 0.003, abs: 0.002 },
  voc:     { rel: 0.15,  abs: 3 },
}

// 물성별 1σ (실험 재현성). 알려지지 않은 파생물성은 같은 계열의 σ를 재사용한다.
export function testSigma(prop: ScatterProp, value: number): number {
  const s = TEST_SCATTER[prop]
  return Math.sqrt((s.rel * value) ** 2 + s.abs ** 2)
}

// value ± 1.96σ (95% 실험 예상 범위). widen 으로 도메인 신뢰도 반영 가능(기본 1.0).
function scatterBand(prop: ScatterProp, value: number, widen = 1): { value: number; low: number; high: number } {
  const half = 1.96 * testSigma(prop, value) * widen
  return { value, low: value - half, high: value + half }
}

// ──────────────────────────────────────────────
// 적용 가능 도메인 (Applicability Domain, 신뢰 도메인)
// ──────────────────────────────────────────────
// 모델이 grounding/검증된 입력 범위(레퍼런스 등급 + 물리적 한계)를 벗어나면 경고한다.
const DOMAIN_RANGES: Array<{ key: keyof Formulation; label: string; min: number; max: number; unit: string }> = [
  { key: 'npmi',         label: 'N-PMI',   min: 0,   max: 25, unit: 'wt%' },
  { key: 'gAbs',         label: 'g-ABS',   min: 10,  max: 35, unit: 'wt%' },
  { key: 'anContent',    label: 'AN 함량', min: 22,  max: 32, unit: '%' },
  { key: 'pc',           label: 'PC',      min: 0,   max: 60, unit: 'wt%' },
  { key: 'alphaMsan',    label: 'αMSAN',   min: 0,   max: 30, unit: 'wt%' },
  { key: 'talc',         label: '탈크',    min: 0,   max: 25, unit: 'wt%' },
  { key: 'glassFiber',   label: 'GF',      min: 0,   max: 35, unit: 'wt%' },
  { key: 'carbonFiber',  label: 'CF',      min: 0,   max: 20, unit: 'wt%' },
  { key: 'phosphorusFr', label: '인계 FR', min: 0,   max: 25, unit: 'wt%' },
  { key: 'nanoclay',     label: '나노클레이', min: 0, max: 6,  unit: 'wt%' },
  { key: 'injTemp',      label: '사출온도', min: 220, max: 290, unit: '℃' },
]

export interface DomainResult {
  status: 'in' | 'edge' | 'out'
  flags: string[]
}

export function applicabilityDomain(f: Formulation): DomainResult {
  const flags: string[] = []
  let outCount = 0
  let edgeCount = 0

  for (const r of DOMAIN_RANGES) {
    const v = (f[r.key] as number) ?? 0
    const span = r.max - r.min
    if (v > r.max) {
      const pastFrac = (v - r.max) / span
      flags.push(`${r.label} ${v}${r.unit} — 검증 범위(≤${r.max}) 초과`)
      if (pastFrac > 0.20) outCount++; else edgeCount++
    } else if (v < r.min) {
      const pastFrac = (r.min - v) / span
      flags.push(`${r.label} ${v}${r.unit} — 검증 범위(≥${r.min}) 미만`)
      if (pastFrac > 0.20) outCount++; else edgeCount++
    } else if (v > r.max - span * 0.05 && v <= r.max) {
      // 상한 경계 근접 (범위 내 상위 5%) — 하한(대개 0)은 정상 배합이므로 제외
      edgeCount++
    }
  }

  // ── 미검증 조합 규칙 (레퍼런스가 커버하지 않는 조합)
  const rubber = f.gAbs + f.mbs + f.sebs + f.acrylicIm + f.uhmwSr
  if (f.glassFiber >= 25 && rubber >= 30) {
    outCount++
    flags.push('GF 고함량 + 고무 고함량 조합 — 미검증 (강성/충격 trade-off 외삽)')
  }
  if (f.pc >= 20 && f.phosphorusFr >= 15) {
    edgeCount++
    flags.push('PC + 높은 인계 FR 조합 — 미검증 (가수분해·난연 상호작용)')
  }
  if (f.glassFiber >= 15 && f.carbonFiber >= 10) {
    edgeCount++
    flags.push('GF + CF 하이브리드 충전 조합 — 미검증')
  }
  if (f.pc >= 40 && f.npmi >= 15) {
    edgeCount++
    flags.push('고 PC + 고 N-PMI 이중 내열 조합 — 미검증')
  }

  const status: DomainResult['status'] =
    outCount >= 1 ? 'out'
    : edgeCount >= 2 ? 'out'   // 다수 경계 = 외삽 취급
    : edgeCount >= 1 ? 'edge'
    : 'in'

  return { status, flags }
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

  // ── 가공·이방성 파라미터 (기본값에서 모든 배수 = 1.0 → 예측 불변)
  const compoundingShear = f.compoundingShear ?? 'med'
  const weldLinePresent  = f.weldLinePresent  ?? false
  // B1: 컴파운딩 전단 → 섬유 잔존길이 → 보강효율 (med=1.0)
  const fiberEff = compoundingShear === 'low' ? 1.08 : compoundingShear === 'high' ? 0.88 : 1.0
  // B2: 웰드라인 녹다운 — 충전재(섬유)일수록 심함 (false면 1.0)
  const fiberFrac = (f.glassFiber + f.carbonFiber) / 100
  const weldKnock = weldLinePresent ? Math.max(0.3, 1 - (0.25 + fiberFrac * 1.5)) : 1.0
  // B3: 유동/직각 이방성 (출력 전용) — 섬유 충전재일수록 직각방향 물성↓ (무충전 ~1.0)
  const anisoRatio = Math.max(0.55, 1 - fiberFrac * 1.1)

  // ── 형태학·시험 조건 파라미터 (기본값에서 모든 배수 = 1.0 → 예측 불변)
  const rubberBimodal = f.rubberBimodal ?? 0
  const graftRatio    = f.graftRatio    ?? 40
  const annealed      = f.annealed      ?? false
  // C1: 이중분포 고무입경 — bonus는 ~25% 대입자에서 최대, 0이면 +0
  const bimodalBonus = rubberBimodal > 0
    ? 0.20 * Math.exp(-((rubberBimodal - 25) ** 2) / (2 * 15 ** 2)) : 0
  // C2: 그래프트율 → 고무-매트릭스 접착 → 충격. 종형(피크 ~45%), 기준 40에서 정확히 1.0
  const graftEff = Math.exp(-((graftRatio - 45) ** 2) / (2 * 18 ** 2))
    / Math.exp(-((40 - 45) ** 2) / (2 * 18 ** 2))
  // A3: PC/SAN 상용성 계수 (AN=25에서 1.0, 벗어나면 감소) — PC 함유 블렌드에만 영향
  const pcCompat = Math.exp(-((f.anContent - 25) ** 2) / (2 * 8 ** 2))

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

  let hdtVal  = hdtFromTg(tgMatrix, rubberForHDT, f.talc, f.glassFiber, f.nanoclay, f.carbonFiber, f.silane, f.pc, fiberEff, pcCompat, f.npmi)
  // C3: 어닐링 → 성형내응력/배향 완화 → HDT↑ (PC 블렌드는 추가 상승). false면 +0.
  // hdt045·vicat floor 파생 전에 적용해 일관성 유지.
  if (annealed) hdtVal += 5 + Math.min(f.pc, 40) * 0.1
  // Vicat: Tg로부터 독립 산정 (비정질 Vicat B50 ≈ Tg − ~6℃), 물리적으로 항상 ≥ HDT
  let vicatVal = tgMatrix - 6 - rubberForHDT * 0.15
  vicatVal = Math.max(vicatVal, hdtVal + 4)

  // 실효 g-ABS (고무함량 × 충격효율) — 기준값에서 f.gAbs 그대로
  const gAbsEff = f.gAbs * rubberContentFactor * impactEff
  const izodBase  = izodFromRubber(gAbsEff, f.npmi, 0, 0, f.phosphorusFr, 0, 0, 0, f.carbonFiber, f.pc, f.alphaMsan, f.glassFiber, f.talc)
  let izodFinal   = izodFromRubber(gAbsEff, f.npmi, f.ema, f.uhmwSr, f.phosphorusFr, f.mbs, f.sebs, f.acrylicIm, f.carbonFiber, f.pc, f.alphaMsan, f.glassFiber, f.talc)
  // SAN 분자량 매트릭스 인성 (기준 100 → ×1)
  izodFinal *= mwFactor ** 0.3
  // 나노클레이 취성화 (−4%/wt%, cap 8wt%, nanoclay=0 중립)
  izodFinal *= (1 - Math.min(f.nanoclay, 8) * 0.04)
  // 고분자량 PC → PC-ABS 인성↑ (PC 함량 가중, cap pc/40)
  izodFinal *= Math.pow(pcMwF, 0.4 * Math.min(f.pc / 40, 1))
  // 환경: 수분 가수분해 + 서비스/시험 온도
  izodFinal *= moistureKnockdown * izodTempFactor

  // ── 상호작용항 (GROUP A) — 모두 기준값에서 ×1.0
  // A1: 고무 × 매트릭스 분자량 — 강인한 매트릭스가 고무 효율↑ (sanMw=100에서 중립)
  izodFinal *= (1 + 0.15 * (sanMw / 100 - 1))
  // A2: FR × 충격보강제 (취성 상쇄) — IM이 FR 취성화를 부분 회복 (FR 또는 IM 없으면 중립)
  const imTotal = f.ema + f.uhmwSr + f.mbs + f.sebs + f.acrylicIm
  if (f.phosphorusFr > 0) {
    izodFinal *= (1 + Math.min(0.30, imTotal * 0.02) * Math.min(1, f.phosphorusFr / 10))
  }

  // ── 형태학 (GROUP C) — 기준값에서 ×1.0
  // C1: 이중분포 고무입경 — 충격-강성 균형 보너스 (rubberBimodal=0에서 +0)
  izodFinal *= (1 + bimodalBonus)
  // C2: 그래프트율 → 고무-매트릭스 접착 (graftRatio=40에서 정확히 1.0)
  izodFinal *= graftEff

  // B2: 웰드라인 녹다운 — 충격 저하 (weldLinePresent=false에서 1.0)
  izodFinal *= weldKnock

  let mfiVal = mfiEstimate(f.npmi, rubberForIzod, f.lubricant, f.injTemp, f.glassFiber, f.talc, f.ema, f.pc, f.nanoclay, f.carbonFiber, f.mbs, f.sebs, f.wax, f.alphaMsan, f.phosphorusFr)
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

  // B1: fiberEff(섬유 보강효율), B2: weldKnock(웰드라인) 적용
  const tensileVal = tensileStrength(f, sanWt, fiberEff) * (sanMw / 100) ** 0.2 * moistureKnockdown * weldKnock
  // B3: 직각방향 인장 (이방성) — 섬유 충전재일수록 낮음 (무충전 ~1.0)
  const tensileCrossVal = tensileVal * anisoRatio
  // C4: 무노치 Izod — 취성(저고무)일수록 큰 배수, 강인할수록 ~3× (cap 12)
  const unnotchedFactor = Math.min(12, 2.5 + 60 / Math.max(izodFinal, 3))
  const izodUnnotchedVal = izodFinal * unnotchedFactor
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

  void err  // (cost 외 모든 물성은 실험 재현성 기반 scatterBand 사용)

  return {
    // 실험 예상 범위 (95%) = value ± 1.96σ (TEST_SCATTER 기반 실험 재현성)
    hdt:     scatterBand('hdt', hdtVal),
    hdt045:  scatterBand('hdt', hdt045Val),
    vicat:   scatterBand('vicat', vicatVal),
    izod:    scatterBand('izod', izodFinal),
    izodUnnotched: scatterBand('izod', izodUnnotchedVal),
    tensile: scatterBand('tensile', tensileVal),
    tensileCross: scatterBand('tensile', tensileCrossVal),
    density: scatterBand('density', densityVal),
    mfi:     scatterBand('mfi', mfiVal),
    mi200:   scatterBand('mfi', mi200Val),
    mi250_2: scatterBand('mfi', mi250_2Val),
    mi250_5: scatterBand('mfi', mi250_5Val),
    voc:     scatterBand('voc', vocVal),
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
// 예측 근거 분해 (Explainability)
// ──────────────────────────────────────────────
// 각 물성의 예측값을 "base + 기여항들의 합" 형태로 분해한다.
// • 가산항(예: GF 보강 +℃)은 식의 항을 그대로 라벨링한다.
// • 곱셈항(예: ×환경계수, ×난연 녹다운)은 "그 계수를 빼면 값이 얼마나 달라지나"를
//   기준으로 등가 가산 델타(value_with − value_without)로 변환해 합이 실제 .value와
//   재정합되게 한다. 곱셈 체인은 순차적으로 누적 적용하며, 각 단계의 "현재 누적값"에
//   계수를 곱한 차이를 그 항의 기여로 삼는다 → 모든 항을 더하면 최종값과 일치.
export interface Contribution { label: string; value: number }
export interface Explanation {
  property: string
  unit: string
  base: number
  contributions: Contribution[]
  total: number
}

export function explainPrediction(f: Formulation): { hdt: Explanation; izod: Explanation; tensile: Explanation } {
  // predictColdStart과 동일한 전처리 (필요한 부분만 복제)
  const additiveWt = f.npmi + f.gAbs + f.cbMB
    + f.ema + f.uhmwSr + f.phosphorusFr + f.talc + f.glassFiber
    + f.pc + f.alphaMsan + f.nanoclay + f.mbs + f.sebs + f.acrylicIm
    + f.ptfe + f.carbonFiber
  const sanWt = Math.max(0, 100 - additiveWt)

  const gAbsRubber  = f.gAbsRubber  ?? 50
  const rubberPSize = f.rubberPSize ?? 0.3
  const sanMw       = f.sanMw       ?? 100
  const gelContent  = f.gelContent  ?? 75
  const rubberContentFactor = gAbsRubber / 50
  const impactEff = psizeEfficiency(rubberPSize) * gelEfficiency(gelContent)
  const mwFactor = sanMw / 100

  const pcMw        = f.pcMw        ?? 100
  const alphaMsanMw = f.alphaMsanMw ?? 100
  const pcMwF  = pcMw / 100

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

  const compoundingShear = f.compoundingShear ?? 'med'
  const weldLinePresent  = f.weldLinePresent  ?? false
  const fiberEff = compoundingShear === 'low' ? 1.08 : compoundingShear === 'high' ? 0.88 : 1.0
  const fiberFrac = (f.glassFiber + f.carbonFiber) / 100
  const weldKnock = weldLinePresent ? Math.max(0.3, 1 - (0.25 + fiberFrac * 1.5)) : 1.0

  const rubberBimodal = f.rubberBimodal ?? 0
  const graftRatio    = f.graftRatio    ?? 40
  const annealed      = f.annealed      ?? false
  const bimodalBonus = rubberBimodal > 0
    ? 0.20 * Math.exp(-((rubberBimodal - 25) ** 2) / (2 * 15 ** 2)) : 0
  const graftEff = Math.exp(-((graftRatio - 45) ** 2) / (2 * 18 ** 2))
    / Math.exp(-((40 - 45) ** 2) / (2 * 18 ** 2))
  const pcCompat = Math.exp(-((f.anContent - 25) ** 2) / (2 * 8 ** 2))

  const tgMatrix = foxTg([
    { w: f.npmi,       tg: Tg_NPMI },
    { w: sanWt,        tg: sanTg(f.anContent) },
    { w: f.alphaMsan,  tg: Tg_AMSAN },
  ])
  const rubberForHDT = f.gAbs * rubberContentFactor + f.uhmwSr * 0.5
  const gAbsEff = f.gAbs * rubberContentFactor * impactEff

  const MIN = 0.3  // |값| < 0.3 인 항은 생략

  // ── 헬퍼: 곱셈계수를 누적값 기준 등가 가산 델타로 변환
  const mulDelta = (running: { v: number }, factor: number, label: string, out: Contribution[]) => {
    const before = running.v
    running.v = running.v * factor
    const d = running.v - before
    if (Math.abs(d) >= MIN) out.push({ label, value: d })
  }
  const addTerm = (val: number, label: string, out: Contribution[]) => {
    if (Math.abs(val) >= MIN) out.push({ label, value: val })
  }

  // ════════════ HDT ════════════
  const hdtC: Contribution[] = []
  const hdtBase = tgMatrix
  {
    const rubberPenalty = rubberForHDT * 0.45
    const silaneMultiplier = f.silane >= 0.1 ? 1.3 : 1.0
    const talcBoost = 7 * (1 - Math.exp(-f.talc / 14)) * (f.silane >= 0.1 ? 1.2 : 1.0)
    const gfBoost   = 20 * (1 - Math.exp(-f.glassFiber / 25)) * silaneMultiplier * fiberEff
    const cfBoost   = 30 * (1 - Math.exp(-f.carbonFiber / 21)) * fiberEff
    const nanoclayBoost = Math.min(f.nanoclay, 5) * 1.3
    const pcBoost = 52 * (1 - Math.exp(-f.pc / 33)) * pcCompat
    const pcNpmiCorr = f.npmi * (f.pc / 100) * 4.6

    addTerm(-17, '−Tg→HDT 오프셋(−17)', hdtC)
    addTerm(-rubberPenalty, '−고무 패널티', hdtC)
    addTerm(talcBoost, '+탈크', hdtC)
    addTerm(gfBoost, '+GF 보강', hdtC)
    addTerm(cfBoost, '+CF', hdtC)
    addTerm(nanoclayBoost, '+나노클레이', hdtC)
    addTerm(pcBoost, '+PC 상분리', hdtC)
    addTerm(-pcNpmiCorr, '−PC·N-PMI 이중계상 보정', hdtC)
    if (annealed) addTerm(5 + Math.min(f.pc, 40) * 0.1, '+어닐링', hdtC)
  }
  const hdtTotal = hdtBase + hdtC.reduce((s, c) => s + c.value, 0)

  // ════════════ Izod ════════════
  const izodC: Contribution[] = []
  const izodBaseVal = 3 + 42 / (1 + Math.exp(-(gAbsEff - 16) / 7))
  {
    const r = { v: izodBaseVal }
    // 가산형 취성/시너지는 izodFromRubber 내부 순서를 그대로 따른다.
    const npmiPenalty = f.npmi * f.npmi * 0.0306 + f.alphaMsan * 0.40
    // base - penalty (max 2 floor 무시: 정상범위)
    addTerm(-npmiPenalty, '−N-PMI/αMSAN 취성', izodC); r.v = Math.max(2, r.v - npmiPenalty)
    if (f.talc > 0) { const before = r.v; r.v = Math.max(2, r.v - 9 * (1 - Math.exp(-f.talc / 16))); addTerm(r.v - before, '−탈크 취성', izodC) }
    if (f.phosphorusFr > 0) mulDelta(r, Math.max(0.35, 1 - (f.phosphorusFr / 25) * 0.6), '−인계FR', izodC)
    if (f.uhmwSr > 0) mulDelta(r, 1 + (f.uhmwSr / 2) * 0.64, '+UHMW-SR', izodC)
    if (f.ema > 0 && f.uhmwSr > 0) {
      mulDelta(r, 1 + (Math.min(f.ema, 10) / 5) * (Math.min(f.uhmwSr, 4) / 2) * 1.48, '+EMA·UHMW 시너지', izodC)
    } else if (f.ema > 0) {
      mulDelta(r, 1 + (f.ema / 5) * 0.20, '+EMA', izodC)
    }
    { const before = r.v; r.v += f.mbs * 0.6 + f.sebs * 0.5 + f.acrylicIm * 0.35; addTerm(r.v - before, '+MBS/SEBS/아크릴', izodC) }
    { const before = r.v; r.v += 33 * (1 - Math.exp(-f.pc / 18)) + 0.25 * f.pc; addTerm(r.v - before, '+PC 강인화', izodC) }
    if (f.carbonFiber > 0) { const before = r.v; r.v = Math.max(2, r.v - f.carbonFiber * 0.3); addTerm(r.v - before, '−CF 취성', izodC) }
    if (f.glassFiber > 0) { const before = r.v; r.v = Math.max(2, r.v - 3 * (1 - Math.exp(-f.glassFiber / 20))); addTerm(r.v - before, '−GF 취성', izodC) }
    // 소프트 캡 + 100 캡
    { const before = r.v; r.v = Math.min(Math.min(r.v, izodBaseVal * 3.5), 100); if (Math.abs(r.v - before) >= MIN) addTerm(r.v - before, '−상한 캡', izodC) }

    // izodFinal 이후 곱셈 보정 체인 (predictColdStart과 동일 순서)
    mulDelta(r, mwFactor ** 0.3, '×SAN분자량', izodC)
    mulDelta(r, (1 - Math.min(f.nanoclay, 8) * 0.04), '−나노클레이 취성', izodC)
    mulDelta(r, Math.pow(pcMwF, 0.4 * Math.min(f.pc / 40, 1)), '×PC분자량', izodC)
    mulDelta(r, moistureKnockdown, '×수분 가수분해', izodC)
    mulDelta(r, izodTempFactor, '×서비스온도', izodC)
    mulDelta(r, (1 + 0.15 * (sanMw / 100 - 1)), '×고무-매트릭스', izodC)
    const imTotal = f.ema + f.uhmwSr + f.mbs + f.sebs + f.acrylicIm
    if (f.phosphorusFr > 0) mulDelta(r, (1 + Math.min(0.30, imTotal * 0.02) * Math.min(1, f.phosphorusFr / 10)), '×FR-IM 회복', izodC)
    mulDelta(r, (1 + bimodalBonus), '×이중분포', izodC)
    mulDelta(r, graftEff, '×그래프트율', izodC)
    mulDelta(r, weldKnock, '×웰드라인', izodC)
  }
  const izodTotal = izodBaseVal + izodC.reduce((s, c) => s + c.value, 0)

  // ════════════ Tensile ════════════
  const tenC: Contribution[] = []
  const tenBase = 42 + (f.anContent - 24) * 0.8
  {
    const rubberTot = f.gAbs + f.uhmwSr * 0.5 + f.mbs * 0.5 + f.sebs * 0.5 + f.acrylicIm * 0.5
    const rubberPenalty = rubberTot * 0.20
    const npmiEffect = f.npmi * 0.2
    const silaneMultiplier = f.silane >= 0.1 ? 1.3 : 1.0
    const gfEffect = 52 * (1 - Math.exp(-f.glassFiber / 25)) * silaneMultiplier * fiberEff
    const cfEffect = 75 * (1 - Math.exp(-f.carbonFiber / 15)) * fiberEff
    const talcEffect = 3 * (1 - Math.exp(-f.talc / 12)) * (f.silane >= 0.1 ? 1.2 : 1.0)
    const nanoclayEffect = 6 * (1 - Math.exp(-Math.min(f.nanoclay, 8) / 4))
    const pcEffect = f.pc * 0.25
    const frEffect = -f.phosphorusFr * 0.10
    const softEffect = -(f.ema * 0.8 + f.uhmwSr * 0.3)
    const alphamsanEffect = f.alphaMsan * 0.15

    addTerm(-rubberPenalty, '−고무', tenC)
    addTerm(npmiEffect, '+N-PMI', tenC)
    addTerm(gfEffect, '+GF', tenC)
    addTerm(cfEffect, '+CF', tenC)
    addTerm(talcEffect, '+탈크', tenC)
    addTerm(nanoclayEffect, '+나노클레이', tenC)
    addTerm(pcEffect, '+PC', tenC)
    addTerm(frEffect, '−FR', tenC)
    addTerm(softEffect, '−연질IM(EMA/UHMW)', tenC)
    addTerm(alphamsanEffect, '+αMSAN', tenC)

    // 베이스+가산항 = tensileStrength raw (min15/max100 클램프 반영)
    const raw = Math.max(15, Math.min(100,
      tenBase - rubberPenalty + npmiEffect + gfEffect + cfEffect + talcEffect
      + nanoclayEffect + pcEffect + frEffect + softEffect + alphamsanEffect))
    // 클램프로 합이 어긋나면 보정항으로 흡수
    const sumSoFar = tenBase + tenC.reduce((s, c) => s + c.value, 0)
    if (Math.abs(raw - sumSoFar) >= MIN) addTerm(raw - sumSoFar, '(상·하한 클램프)', tenC)

    // predictColdStart 이후 곱셈 체인
    const r = { v: raw }
    mulDelta(r, (sanMw / 100) ** 0.2, '×SAN분자량', tenC)
    mulDelta(r, moistureKnockdown, '×수분 가수분해', tenC)
    mulDelta(r, weldKnock, '×웰드라인', tenC)
  }
  const tenTotal = tenBase + tenC.reduce((s, c) => s + c.value, 0)

  return {
    hdt:     { property: 'HDT (1.8MPa)', unit: '℃',     base: hdtBase,     contributions: hdtC,  total: hdtTotal },
    izod:    { property: 'Izod 충격',     unit: 'kJ/m²', base: izodBaseVal, contributions: izodC, total: izodTotal },
    tensile: { property: '인장강도',       unit: 'MPa',   base: tenBase,     contributions: tenC,  total: tenTotal },
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
