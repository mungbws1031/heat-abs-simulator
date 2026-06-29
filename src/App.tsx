import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  predictColdStart,
  computeSensitivity,
  generateScreeningDOE,
  generateRSMDOE,
  DEFAULT_FACTORS,
  type Formulation,
  type PredictionResult,
  type SensProp,
  type DOERun,
  setUnitCosts,
  DEFAULT_UNIT_COSTS,
  type UnitCosts,
} from '@/lib/physics'
import {
  runGridSearch,
  DEFAULT_SEARCH_CONFIG,
  DEFAULT_TARGET,
  type SearchConfig,
  type SearchRange,
  type SearchTarget,
  type CandidateResult,
} from '@/lib/optimizer'
import {
  fitCalibration,
  applyCalibration,
  type CalibResult,
} from '@/lib/calibration'
import {
  validateModel,
  referenceCalibPairs,
  REFERENCE_GRADES,
  type ValidationSummary,
} from '@/lib/referenceData'

const REFERENCE_GRADES_COUNT = REFERENCE_GRADES.length

// ──────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────
interface CalibPoint {
  id: number
  lot: string
  npmi: number; gAbs: number; anContent: number; injTemp: number
  talc: number; glassFiber: number; pc: number; phosphorusFr: number
  carbonFiber: number; nanoclay: number
  segment: string
  predictedHdt: number; predictedIzod: number; predictedVoc: number
  predictedTensile: number; predictedMfi: number; predictedVicat: number
  measuredHdt?: number; measuredIzod?: number; measuredVoc?: number
  measuredTensile?: number; measuredMfi?: number; measuredVicat?: number
}

interface ExperimentRecord {
  id: number
  lot: string
  formulation: Formulation
  prediction: PredictionResult
  actual?: { hdt?: number; izod?: number; mfi?: number; voc?: number }
  date: string
  note: string
}

// ──────────────────────────────────────────────
// 상수
// ──────────────────────────────────────────────
const SPEC = {
  hdt:     { target: 115,  unit: '℃',       label: 'HDT (1.8MPa)',       min: 80,   max: 140,  higherIsBetter: true  },
  vicat:   { target: 123,  unit: '℃',       label: 'Vicat',               min: 88,   max: 150,  higherIsBetter: true  },
  izod:    { target: 15,   unit: 'kJ/m²',   label: 'Izod 충격',           min: 0,    max: 80,   higherIsBetter: true  },
  tensile: { target: 40,   unit: 'MPa',     label: '인장강도',             min: 15,   max: 80,   higherIsBetter: true  },
  density: { target: 0,    unit: 'g/cm³',   label: '비중 (계산)',          min: 1.00, max: 1.50, higherIsBetter: false },
  mfi:     { target: 5,    unit: 'g/10min', label: 'MFI (220℃/10kg)',     min: 0,    max: 40,   higherIsBetter: false },
  voc:     { target: 50,   unit: 'µg/g',    label: 'TVOC (VDA278)',        min: 0,    max: 100,  higherIsBetter: false },
  cost:    { target: 0,    unit: '₩/kg',    label: '원가 지수',            min: 2500, max: 6000, higherIsBetter: false },
}

const DEFAULT_FORM: Formulation = {
  npmi: 17, gAbs: 28, san: 50, anContent: 28,
  cbMB: 2.5,
  // 미세구조 (고급) — 기본값에서 효과 중립
  gAbsRubber: 50, rubberPSize: 0.3, sanMw: 100, gelContent: 75,
  pcMw: 100, alphaMsanMw: 100,
  // 환경/공정 조건 — 표준에서 중립
  ambientTemp: 23, humidity: 50, materialDried: true,
  // 가공·이방성·형태학·시험 조건 — 기본값에서 중립
  compoundingShear: 'med', weldLinePresent: false,
  rubberBimodal: 0, graftRatio: 40, annealed: false, notchType: 'notched',
  antioxidant: 0.5, lubricant: 1.0,
  injTemp: 250, moldTemp: 70,
  // 매트릭스 개질
  pc: 0, alphaMsan: 0, nanoclay: 0,
  // 충격보강제
  ema: 0, uhmwSr: 0, mbs: 0, sebs: 0, acrylicIm: 0,
  // 난연
  phosphorusFr: 0, ptfe: 0,
  // 충전재·강화재
  talc: 0, glassFiber: 0, carbonFiber: 0,
  // 기능성 소량 첨가제
  silane: 0, wax: 0, hals: 0, heatStabilizer: 0, metalDeact: 0, antistatic: 0,
}

const PRESETS: Record<string, Partial<Formulation>> = {
  '표준 (충격 우수)': {
    npmi: 14, gAbs: 32, anContent: 27,
    cbMB: 2.5, antioxidant: 0.5, lubricant: 1.0,
    injTemp: 250, moldTemp: 70,
    pc: 0, alphaMsan: 0, nanoclay: 0,
    ema: 5, uhmwSr: 2, mbs: 0, sebs: 0, acrylicIm: 0,
    phosphorusFr: 0, ptfe: 0,
    talc: 0, glassFiber: 0, carbonFiber: 0,
    silane: 0, wax: 0, hals: 0, heatStabilizer: 0, metalDeact: 0, antistatic: 0,
  },
  '고내열형 (Tg↑)': {
    npmi: 22, gAbs: 25, anContent: 30,
    cbMB: 2.5, antioxidant: 0.5, lubricant: 1.0,
    injTemp: 260, moldTemp: 70,
    pc: 10, alphaMsan: 0, nanoclay: 3,
    ema: 0, uhmwSr: 0, mbs: 0, sebs: 0, acrylicIm: 0,
    phosphorusFr: 0, ptfe: 0,
    talc: 8, glassFiber: 0, carbonFiber: 0,
    silane: 0.2, wax: 0, hals: 0, heatStabilizer: 0, metalDeact: 0, antistatic: 0,
  },
  '골든존 (내열+충격)': {
    npmi: 18, gAbs: 28, anContent: 28,
    cbMB: 2.5, antioxidant: 0.5, lubricant: 1.0,
    injTemp: 252, moldTemp: 70,
    pc: 5, alphaMsan: 0, nanoclay: 2,
    ema: 4, uhmwSr: 1.5, mbs: 0, sebs: 0, acrylicIm: 0,
    phosphorusFr: 0, ptfe: 0,
    talc: 5, glassFiber: 0, carbonFiber: 0,
    silane: 0.1, wax: 0, hals: 0, heatStabilizer: 0, metalDeact: 0, antistatic: 0,
  },
}

// ──────────────────────────────────────────────
// 훅: 숫자 애니메이션 (spring-like)
// ──────────────────────────────────────────────
function useAnimatedNumber(target: number, duration = 400): number {
  const [current, setCurrent] = useState(target)
  const rafRef = useRef<number>(0)
  const startRef = useRef<number>(0)
  const fromRef = useRef<number>(target)

  useEffect(() => {
    if (Math.abs(target - current) < 0.01) return
    fromRef.current = current
    startRef.current = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / duration)
      // ease out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setCurrent(fromRef.current + (target - fromRef.current) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  return current
}

// ──────────────────────────────────────────────
// 컴포넌트: 애니메이션 게이지 바 + 숫자
// ──────────────────────────────────────────────
function MetricGauge({
  label, value, low, high, unit,
  min, max, target, higherIsBetter,
}: {
  label: string; value: number; low: number; high: number; unit: string;
  min: number; max: number; target?: number; higherIsBetter: boolean
}) {
  const animVal = useAnimatedNumber(value)
  const animLow = useAnimatedNumber(low)
  const animHigh = useAnimatedNumber(high)

  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))

  const valPct  = pct(animVal)
  const lowPct  = pct(animLow)
  const highPct = pct(animHigh)
  const targPct = target != null ? pct(target) : null

  const pass = target == null ? null
    : higherIsBetter ? value >= target : value <= target
  const warn = target == null ? false
    : higherIsBetter ? (value >= target * 0.96 && value < target) : (value <= target * 1.04 && value > target)

  const barColor = pass === true ? '#22c55e'
    : pass === false ? (warn ? '#f97316' : '#ef4444')
    : '#94a3b8'

  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-xl font-bold font-mono tabular-nums transition-colors duration-300"
            style={{ color: barColor }}
          >
            {animVal.toFixed(label === 'MFI (220℃/10kg)' || label === 'TVOC (VDA278)' ? 0 : 1)}
          </span>
          <span className="text-xs text-gray-400">{unit}</span>
          {target != null && (
            <span className="text-xs text-gray-300 ml-1">
              / {higherIsBetter ? `≥${target}` : `≤${target}`}
            </span>
          )}
        </div>
      </div>

      {/* 게이지 트랙 */}
      <div className="relative h-5 rounded bg-gray-100 overflow-hidden">
        {/* 신뢰구간 대역 */}
        <div
          className="absolute top-0 bottom-0 rounded transition-all duration-400 ease-out"
          style={{
            left: `${lowPct}%`,
            width: `${Math.max(0, highPct - lowPct)}%`,
            background: `${barColor}22`,
            border: `1px solid ${barColor}55`,
            transition: 'left 400ms cubic-bezier(0.33,1,0.68,1), width 400ms cubic-bezier(0.33,1,0.68,1)',
          }}
        />
        {/* 중심값 바 */}
        <div
          className="absolute top-1 bottom-1 rounded-full"
          style={{
            left: 0,
            width: `${valPct}%`,
            background: barColor,
            transition: 'width 400ms cubic-bezier(0.33,1,0.68,1), background 300ms',
          }}
        />
        {/* 목표값 마커 */}
        {targPct != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5"
            style={{
              left: `${targPct}%`,
              background: '#64748b',
              transition: 'left 400ms cubic-bezier(0.33,1,0.68,1)',
            }}
          />
        )}
      </div>

      {/* 오차구간 텍스트 */}
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-gray-300 font-mono">{animLow.toFixed(1)}</span>
        <span className="text-[10px] text-gray-300 font-mono">{animHigh.toFixed(1)}</span>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// 컴포넌트: Spec 신호등 (애니메이션)
// ──────────────────────────────────────────────
function SpecLight({ pass }: { pass: boolean | null }) {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full transition-all duration-300"
      style={{
        background: pass === true ? '#22c55e' : pass === false ? '#ef4444' : '#facc15',
        boxShadow: pass === true ? '0 0 6px #22c55e88' : pass === false ? '0 0 6px #ef444488' : '0 0 6px #facc1588',
      }}
    />
  )
}

// ──────────────────────────────────────────────
// 컴포넌트: 슬라이더 행
// ──────────────────────────────────────────────
function SliderRow({ label, value, min, max, step = 0.5, unit, onChange, warn, highlight }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string
  onChange: (v: number) => void; warn?: string; highlight?: boolean
}) {
  return (
    <div className={`grid grid-cols-[160px_1fr_68px] items-center gap-3 py-1.5 px-2 rounded transition-colors duration-200 ${highlight ? 'bg-blue-50' : ''}`}>
      <Label className="text-sm">{label}</Label>
      <Slider min={min} max={max} step={step} value={[value]}
        onValueChange={([v]) => onChange(v)} className="w-full" />
      <span className="text-sm font-mono text-right tabular-nums">
        {value}<span className="text-gray-400 text-xs ml-0.5">{unit}</span>
      </span>
      {warn && <span className="col-span-3 text-xs text-yellow-600 -mt-0.5 pl-0">{warn}</span>}
    </div>
  )
}

// ──────────────────────────────────────────────
// UL-94 뱃지
// ──────────────────────────────────────────────
function UL94Badge({ rating }: { rating: string }) {
  const cfg = {
    'V-0': { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
    'V-2': { bg: '#fef9c3', color: '#854d0e', border: '#fde047' },
    'HB':  { bg: '#ffedd5', color: '#9a3412', border: '#fdba74' },
    'N/A': { bg: '#f1f5f9', color: '#94a3b8', border: '#cbd5e1' },
  }[rating] ?? { bg: '#f1f5f9', color: '#94a3b8', border: '#cbd5e1' }
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-bold font-mono transition-all duration-300"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
    >
      {rating}
    </span>
  )
}

// ──────────────────────────────────────────────
// 컴포넌트: 5단계 표정 미터
// ──────────────────────────────────────────────
const FACES = [
  { emoji: '😖', label: '심각',   bg: '#fecaca', border: '#f87171', text: '#991b1b' },
  { emoji: '😟', label: '미달',   bg: '#fed7aa', border: '#fb923c', text: '#9a3412' },
  { emoji: '😐', label: '보통',   bg: '#fef9c3', border: '#facc15', text: '#854d0e' },
  { emoji: '🙂', label: '양호',   bg: '#d1fae5', border: '#34d399', text: '#065f46' },
  { emoji: '😄', label: '최고',   bg: '#bfdbfe', border: '#60a5fa', text: '#1e3a8a' },
]

function FaceMeter({ pred }: { pred: PredictionResult }) {
  // 점수 계산: HDT·Izod·VOC 3축 기반 0~100
  const hdtScore  = Math.max(0, Math.min(1, (pred.hdt.value  - 95)  / 30))   // 95→125
  const izodScore = Math.max(0, Math.min(1, (pred.izod.value - 8)   / 30))   // 8→38
  const vocScore  = Math.max(0, Math.min(1, (80 - pred.voc.value)   / 60))   // 80→20
  const raw = (hdtScore * 40 + izodScore * 35 + vocScore * 25)               // 가중합 0~100

  // Spec 미달 패널티
  const hdtFail  = pred.specPass.hdt  === false
  const izodFail = pred.specPass.izod === false
  const vocFail  = pred.specPass.voc  === false
  const failCount = [hdtFail, izodFail, vocFail].filter(Boolean).length
  const score = Math.max(0, raw - failCount * 20)

  // 5단계 매핑
  const idx = score < 20 ? 0 : score < 40 ? 1 : score < 60 ? 2 : score < 80 ? 3 : 4
  const face = FACES[idx]

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3 mb-3 transition-all duration-500"
      style={{ background: face.bg, border: `2px solid ${face.border}` }}
    >
      <span
        className="text-4xl leading-none transition-all duration-500"
        style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}
      >
        {face.emoji}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-bold" style={{ color: face.text }}>{face.label}</span>
          <span className="text-xs font-mono" style={{ color: face.text }}>({Math.round(score)}/100)</span>
        </div>
        {/* 5칸 스텝바 */}
        <div className="flex gap-1">
          {FACES.map((f, i) => (
            <div
              key={i}
              className="flex-1 h-2 rounded-full transition-all duration-500"
              style={{
                background: i <= idx ? face.border : '#e5e7eb',
                opacity: i === idx ? 1 : i < idx ? 0.6 : 0.25,
              }}
            />
          ))}
        </div>
        <p className="text-[10px] mt-1" style={{ color: face.text }}>
          {failCount === 0 ? '3대 Spec 통과권' : `Spec ${failCount}개 미달`}
        </p>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// 2차 검증 컴포넌트
// ──────────────────────────────────────────────
function ValidationChecks({ pred }: { pred: PredictionResult }) {
  const hdt     = pred.hdt.value
  const vic     = pred.vicat.value
  const mi220   = pred.mfi.value
  const mi200   = pred.mi200.value
  const mi250_2 = pred.mi250_2.value
  const mi250_5 = pred.mi250_5.value
  const izod    = pred.izod.value
  const ten     = pred.tensile.value

  type State = 'ok' | 'warn' | 'bad'
  const check = (state: State, title: string, detail: string) => (
    <div key={title} className={`flex items-start gap-2 p-2 rounded border text-xs mb-1.5
      ${state === 'ok' ? 'bg-green-50 border-green-200' : state === 'warn' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
      <span className={`font-bold mt-0.5 ${state === 'ok' ? 'text-green-600' : state === 'warn' ? 'text-yellow-600' : 'text-red-600'}`}>
        {state === 'ok' ? '✓' : state === 'warn' ? '⚠' : '❌'}
      </span>
      <div>
        <p className={`font-semibold ${state === 'ok' ? 'text-green-700' : state === 'warn' ? 'text-yellow-700' : 'text-red-700'}`}>{title}</p>
        <p className="text-gray-500 text-[11px] mt-0.5">{detail}</p>
      </div>
    </div>
  )

  const checks = []

  // 검증1: VICAT >= HDT 절대규칙
  if (vic < hdt) {
    checks.push(check('bad', 'VICAT >= HDT (절대규칙)', `VICAT ${vic.toFixed(1)} < HDT ${hdt.toFixed(1)} — 물리법칙 위반`))
  } else {
    checks.push(check('ok', 'VICAT >= HDT', `VICAT ${vic.toFixed(1)} >= HDT ${hdt.toFixed(1)} ✓`))
  }

  // 검증2: VICAT-HDT 관계 (경험 범위 ±12℃)
  const vicExp = 9.9 + 1.123 * hdt
  const vicDev = vic - vicExp
  if (Math.abs(vicDev) <= 8) {
    checks.push(check('ok', 'VICAT-HDT 관계', `편차 ${vicDev >= 0 ? '+' : ''}${vicDev.toFixed(1)}℃ (경험 범위 ±8℃)`))
  } else if (Math.abs(vicDev) <= 15) {
    checks.push(check('warn', 'VICAT-HDT 관계', `편차 ${vicDev >= 0 ? '+' : ''}${vicDev.toFixed(1)}℃ — 경험 범위 경계`))
  } else {
    checks.push(check('bad', 'VICAT-HDT 관계', `편차 ${vicDev >= 0 ? '+' : ''}${vicDev.toFixed(1)}℃ — 비정상 편차 (실측 필요)`))
  }

  // 검증3: MI 하중-순서 250℃ (5kg > 2.16kg) — Power-Law상 항상 성립
  if (mi250_5 >= mi250_2 * 1.05) {
    checks.push(check('ok', 'MI 하중-순서 (250℃)', `MI(5kg) ${mi250_5.toFixed(1)} > MI(2.16kg) ${mi250_2.toFixed(1)} — Power-Law 정상`))
  } else if (mi250_5 >= mi250_2 * 0.95) {
    checks.push(check('warn', 'MI 하중-순서 (250℃)', `MI(5kg) ${mi250_5.toFixed(1)} ≈ MI(2.16kg) ${mi250_2.toFixed(1)} — 경계값`))
  } else {
    checks.push(check('bad', 'MI 하중-순서 (250℃)', `MI(5kg) ${mi250_5.toFixed(1)} < MI(2.16kg) ${mi250_2.toFixed(1)} — 물리법칙 위반`))
  }

  // 검증4: MI 조건별 순서 — v13 실측 chain: 250/5 > 220/10 > 200/21.6 (+ 250℃ 하중순서)
  if (mi250_5 > mi220 && mi220 > mi200 && mi250_5 > mi250_2) {
    checks.push(check('ok', 'MI 조건별 순서', `250/5 > 220/10 > 200/21.6: ${mi250_5.toFixed(1)} > ${mi220.toFixed(1)} > ${mi200.toFixed(1)} (실측 v13 일치)`))
  } else {
    checks.push(check('warn', 'MI 조건별 순서', `250/5=${mi250_5.toFixed(1)}, 220/10=${mi220.toFixed(1)}, 200/21.6=${mi200.toFixed(1)}, 250/2.16=${mi250_2.toFixed(1)} — 비전형 순서`))
  }

  // 검증5: 트레이드오프 — 충격·내열·인장·MI 동시 최상
  const allGreat = izod >= 20 && hdt >= 120 && ten >= 50 && mi220 >= 10
  if (allGreat) {
    checks.push(check('warn', '트레이드오프 점검', `충격${izod.toFixed(1)}·HDT${hdt.toFixed(1)}·인장${ten.toFixed(1)}·MI${mi220.toFixed(1)} 동시 우수 — 실측 검증 강력 권장`))
  } else {
    checks.push(check('ok', '트레이드오프', '정상 범위 (전 물성 동시 최상 아님)'))
  }

  return <div>{checks}</div>
}

// ──────────────────────────────────────────────
// 민감도 바 컴포넌트
// ──────────────────────────────────────────────
function SensitivityBars({ formulation, prop }: { formulation: Formulation; prop: SensProp }) {
  const sensData = computeSensitivity(formulation, prop)
  if (sensData.length === 0) return <p className="text-xs text-gray-400">해당 물성에 영향 없음</p>

  return (
    <div className="space-y-1.5">
      {sensData.map(({ key, label, value }) => {
        const positive = value >= 0
        const width = Math.abs(value) * 45
        return (
          <div key={key} className="grid grid-cols-[110px_1fr_36px] items-center gap-2 text-xs">
            <span className="text-gray-500 truncate">{label}</span>
            <div className="relative h-4 bg-gray-100 rounded overflow-hidden">
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-300" />
              <div
                className="absolute top-0.5 bottom-0.5 rounded-sm"
                style={{
                  [positive ? 'left' : 'right']: '50%',
                  width: `${width}%`,
                  background: positive ? '#22c55e' : '#ef4444',
                }}
              />
            </div>
            <span className={`text-right font-mono text-[10px] ${positive ? 'text-green-600' : 'text-red-500'}`}>
              {positive ? '+' : ''}{value.toFixed(2)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────
// 자동 제안 컴포넌트
// ──────────────────────────────────────────────
const AUTO_SUGGEST_KEY_LABELS: Record<string, string> = {
  npmi: 'N-PMI', gAbs: 'g-ABS(고무)', anContent: 'AN 함량', pc: 'PC 블렌드',
  talc: '탈크', glassFiber: 'GF 유리섬유', carbonFiber: 'CF 카본섬유',
  ema: 'EMA 상용화제', uhmwSr: 'UHMW-SR', phosphorusFr: '인계 FR',
  nanoclay: '나노클레이',
}

const WT_KEYS = new Set(['npmi','gAbs','pc','talc','glassFiber','carbonFiber','ema','uhmwSr','phosphorusFr','nanoclay'])

function AutoSuggest({ pred, form, onApply }: {
  pred: PredictionResult
  form: Formulation
  onApply: (patch: Partial<Formulation>) => void
}) {
  const needsHDT  = pred.hdt.value  < 115
  const needsIzod = pred.izod.value < 15
  const needsVOC  = pred.voc.value  > 50

  if (!needsHDT && !needsIzod && !needsVOC) {
    return (
      <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 mb-3">
        ✅ 모든 Spec 달성 — 원가 절감을 시도해보세요
      </div>
    )
  }

  // compute sensitivity for each failing spec
  const totalComposition = form.npmi + form.gAbs + form.cbMB
    + form.pc + form.alphaMsan + form.nanoclay
    + form.ema + form.uhmwSr + form.mbs + form.sebs + form.acrylicIm
    + form.phosphorusFr + form.ptfe
    + form.talc + form.glassFiber + form.carbonFiber
  const sanEst = Math.max(0, 100 - totalComposition)
  const formWithSan: Formulation = { ...form, san: sanEst }

  type Suggestion = { key: string; label: string; delta: number; newVal: number; spec: string }
  const suggestions: Suggestion[] = []

  const makeSuggestions = (spec: 'hdt' | 'izod' | 'voc') => {
    const sensData = computeSensitivity(formWithSan, spec)
    // For VOC, lower is better — take negative contributors (sens < 0 means increase in factor decreases VOC)
    const candidates = spec === 'voc'
      ? sensData.filter(s => s.value < 0)
      : sensData.filter(s => s.value > 0)
    const top2 = candidates.slice(0, 2)
    for (const s of top2) {
      const key = s.key as keyof Formulation
      const curVal = form[key] as number
      const delta = key === 'anContent' ? 2 : WT_KEYS.has(s.key) ? 3 : 0.5
      const newVal = curVal + delta
      // For HDT improvement, check if Izod is hurt >10%
      let tradeoffWarn = ''
      if (spec === 'hdt' && !needsIzod) {
        const patchedForm: Formulation = { ...formWithSan, [key]: newVal }
        const newPred = predictColdStart(patchedForm)
        const izodDrop = pred.izod.value - newPred.izod.value
        if (izodDrop > pred.izod.value * 0.1) {
          tradeoffWarn = ` ⚠ Izod -${izodDrop.toFixed(1)} 주의`
        }
      }
      suggestions.push({
        key: s.key,
        label: AUTO_SUGGEST_KEY_LABELS[s.key] ?? s.key,
        delta,
        newVal,
        spec: spec.toUpperCase() + tradeoffWarn,
      })
    }
  }

  if (needsHDT)  makeSuggestions('hdt')
  if (needsIzod) makeSuggestions('izod')
  if (needsVOC)  makeSuggestions('voc')

  const shown = suggestions.slice(0, 4)

  return (
    <div className="mb-3 space-y-1.5">
      <p className="text-xs font-semibold text-gray-400">자동 제안</p>
      {shown.map((s, i) => (
        <div key={i} className="flex items-center gap-2 border border-gray-200 rounded px-2 py-1.5 bg-gray-50 text-xs">
          <div className="flex-1 text-gray-700">
            <span className="font-medium">{s.label}</span>
            <span className="text-gray-400 ml-1">+{s.delta} → {s.newVal.toFixed(1)}</span>
            <span className="text-blue-600 ml-1 text-[10px]">({s.spec})</span>
          </div>
          <button
            className="px-2 py-0.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
            onClick={() => onApply({ [s.key]: s.newVal } as Partial<Formulation>)}>
            적용
          </button>
        </div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────
// M1 + M2: 배합 입력기 & 물성 예측기 (실시간)
// ──────────────────────────────────────────────
function PredictorTab({ records, onAddRecord, loadedFormulation, onFormulationLoaded, calibResult, costVersion }: {
  records: ExperimentRecord[]
  onAddRecord: (r: ExperimentRecord) => void
  loadedFormulation: Formulation | null
  onFormulationLoaded: () => void
  calibResult: CalibResult | null
  costVersion: number
}) {
  const [form, setForm] = useState<Formulation>(DEFAULT_FORM)
  const [pred, setPred] = useState<PredictionResult>(() => predictColdStart(DEFAULT_FORM))
  const [lotName, setLotName] = useState('')
  const [changedKey, setChangedKey] = useState<string | null>(null)
  const [miTab, setMiTab] = useState<'mfi'|'mi200'|'mi250_2'|'mi250_5'>('mfi')
  const [sensTab, setSensTab] = useState<SensProp>('hdt')
  const [savedPresets, setSavedPresets] = useState<Record<string, Formulation>>(() => {
    try { return JSON.parse(localStorage.getItem('abs_saved_presets') ?? '{}') } catch { return {} }
  })
  const [presetName, setPresetName] = useState('')

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    const updated = { ...savedPresets, [name]: { ...form } }
    setSavedPresets(updated)
    localStorage.setItem('abs_saved_presets', JSON.stringify(updated))
    setPresetName('')
  }
  const deletePreset = (name: string) => {
    const updated = { ...savedPresets }
    delete updated[name]
    setSavedPresets(updated)
    localStorage.setItem('abs_saved_presets', JSON.stringify(updated))
  }

  const totalComposition = form.npmi + form.gAbs + form.cbMB
    + form.pc + form.alphaMsan + form.nanoclay
    + form.ema + form.uhmwSr + form.mbs + form.sebs + form.acrylicIm
    + form.phosphorusFr + form.ptfe
    + form.talc + form.glassFiber + form.carbonFiber
  const sanEst = Math.max(0, 100 - totalComposition)
  const compositionOk = totalComposition <= 100

  // 자동 탐색에서 배합 로드
  useEffect(() => {
    if (!loadedFormulation) return
    setForm(loadedFormulation)
    onFormulationLoaded()
  }, [loadedFormulation, onFormulationLoaded])

  // 실시간 예측: 슬라이더 변경 즉시 반영
  useEffect(() => {
    if (!compositionOk) return
    const rawPred = predictColdStart({ ...form, san: sanEst })
    setPred(calibResult ? applyCalibration(rawPred, calibResult) : rawPred)
  }, [form, sanEst, compositionOk, calibResult, costVersion])

  const set = useCallback((key: keyof Formulation) => (v: number) => {
    setForm(f => ({ ...f, [key]: v }))
    setChangedKey(key)
    // 하이라이트 0.6초 후 해제
    setTimeout(() => setChangedKey(null), 600)
  }, [])

  const handleSave = () => {
    const rec: ExperimentRecord = {
      id: Date.now(),
      lot: lotName || `LOT-${records.length + 1}`,
      formulation: { ...form, san: sanEst },
      prediction: pred,
      date: new Date().toLocaleDateString('ko-KR'),
      note: '',
    }
    onAddRecord(rec)
    setLotName('')
  }

  return (
    <div className="grid grid-cols-[1fr_360px] gap-4">
      {/* 왼쪽: 배합 입력 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            M1 — 배합 입력기
            <span className="text-xs font-normal text-green-600 bg-green-50 px-2 py-0.5 rounded">● 실시간 예측</span>
          </CardTitle>
          <p className="text-xs text-gray-500">
            조성 합계:{' '}
            <strong className={compositionOk ? 'text-green-600' : 'text-red-600'}>
              {totalComposition.toFixed(1)} wt%
            </strong>
            {' '}/ SAN 추정: <strong>{sanEst.toFixed(1)} wt%</strong>
          </p>
        </CardHeader>
        <CardContent className="space-y-0 pb-4">
          {/* 프리셋 */}
          <div className="pb-3 border-b mb-2 space-y-2">
            <div className="flex gap-2 flex-wrap">
              {Object.entries(PRESETS).map(([name, preset]) => (
                <Button key={name} size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => setForm(f => ({ ...f, ...preset }))}>
                  ▸ {name}
                </Button>
              ))}
            </div>
            {Object.keys(savedPresets).length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {Object.entries(savedPresets).map(([name, f]) => (
                  <div key={name} className="flex items-center gap-0.5">
                    <button
                      className="px-2 py-0.5 text-xs rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                      onClick={() => setForm(f)}>
                      ★ {name}
                    </button>
                    <button
                      className="text-[10px] text-gray-400 hover:text-red-500 px-0.5"
                      onClick={() => deletePreset(name)}
                      title="삭제">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1.5 items-center">
              <input
                type="text" placeholder="현재 배합 저장 이름..."
                value={presetName} onChange={e => setPresetName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && savePreset()}
                className="flex-1 text-xs border rounded px-2 py-1 outline-none focus:border-indigo-400 min-w-0" />
              <Button size="sm" variant="outline" className="h-7 text-xs whitespace-nowrap"
                onClick={savePreset} disabled={!presetName.trim()}>
                저장
              </Button>
            </div>
          </div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">── 주요 조성</p>
          <SliderRow label="N-PMI 함량"   value={form.npmi}       min={10}  max={25}  step={0.5} unit="wt%"  onChange={set('npmi')}       highlight={changedKey==='npmi'} />
          <SliderRow label="g-ABS(고무)"  value={form.gAbs}       min={20}  max={40}  step={0.5} unit="wt%"  onChange={set('gAbs')}       highlight={changedKey==='gAbs'} />
          <SliderRow label="SAN AN 함량"  value={form.anContent}  min={24}  max={32}  step={0.5} unit="%"    onChange={set('anContent')}  highlight={changedKey==='anContent'} />
          <SliderRow label="카본블랙 MB"  value={form.cbMB}       min={2}   max={3}   step={0.1} unit="wt%"  onChange={set('cbMB')}       highlight={changedKey==='cbMB'} />

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">── 미세구조 (고급)</p>
          <SliderRow label="g-ABS 고무함량"  value={form.gAbsRubber ?? 50}  min={30}  max={70}  step={1}    unit="%"  onChange={set('gAbsRubber')}  highlight={changedKey==='gAbsRubber'} />
          <SliderRow label="고무 평균입경"   value={form.rubberPSize ?? 0.3} min={0.05} max={1.0} step={0.05} unit="μm" onChange={set('rubberPSize')} highlight={changedKey==='rubberPSize'} />
          <SliderRow label="SAN 분자량지수"  value={form.sanMw ?? 100}      min={60}  max={160} step={5}    unit=""   onChange={set('sanMw')}       highlight={changedKey==='sanMw'} />
          <SliderRow label="고무 가교도(겔)" value={form.gelContent ?? 75}  min={40}  max={90}  step={1}    unit="%"  onChange={set('gelContent')}  highlight={changedKey==='gelContent'} />
          <SliderRow label="PC 분자량지수"   value={form.pcMw ?? 100}       min={70}  max={140} step={5}    unit=""   onChange={set('pcMw')}        highlight={changedKey==='pcMw'} />
          <SliderRow label="αMSAN 분자량지수" value={form.alphaMsanMw ?? 100} min={70} max={140} step={5}    unit=""   onChange={set('alphaMsanMw')} highlight={changedKey==='alphaMsanMw'} />
          <SliderRow label="이중분포 대입자"  value={form.rubberBimodal ?? 0} min={0}  max={60}  step={5}    unit="%"  onChange={set('rubberBimodal')} highlight={changedKey==='rubberBimodal'} />
          <SliderRow label="그래프트율"      value={form.graftRatio ?? 40}  min={20}  max={60}  step={1}    unit="%"  onChange={set('graftRatio')}    highlight={changedKey==='graftRatio'} />

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">── 환경/공정 조건</p>
          <SliderRow label="외기/서비스 온도" value={form.ambientTemp ?? 23} min={-40} max={60} step={1} unit="℃"
            onChange={set('ambientTemp')} highlight={changedKey==='ambientTemp'}
            warn={(form.ambientTemp ?? 23) < 0 ? '저온 취성 → 충격 저하 (자동차 -30℃ 요구 반영)' : undefined} />
          <SliderRow label="상대습도" value={form.humidity ?? 50} min={10} max={95} step={5} unit="%RH"
            onChange={set('humidity')} highlight={changedKey==='humidity'} />
          <div className="grid grid-cols-[160px_1fr] items-center gap-3 py-1.5 px-2">
            <Label className="text-sm">건조 여부</Label>
            <div className="flex gap-1 items-center">
              {[
                { v: true,  l: '건조함' },
                { v: false, l: '미건조' },
              ].map(({ v, l }) => (
                <button key={l}
                  className={`px-3 py-1 text-xs rounded border transition-colors ${(form.materialDried ?? true) === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'}`}
                  onClick={() => setForm(f => ({ ...f, materialDried: v }))}>
                  {l}
                </button>
              ))}
              <span className="text-[10px] text-gray-400 ml-1">건조 시 습도 영향 최소</span>
            </div>
          </div>

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">── 가공·시험 조건</p>
          {/* 컴파운딩 전단 */}
          <div className="grid grid-cols-[160px_1fr] items-center gap-3 py-1.5 px-2">
            <Label className="text-sm">컴파운딩 전단</Label>
            <div className="flex gap-1 items-center flex-wrap">
              {[
                { v: 'low'  as const, l: '저전단' },
                { v: 'med'  as const, l: '표준' },
                { v: 'high' as const, l: '고전단' },
              ].map(({ v, l }) => (
                <button key={l}
                  className={`px-3 py-1 text-xs rounded border transition-colors ${(form.compoundingShear ?? 'med') === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'}`}
                  onClick={() => setForm(f => ({ ...f, compoundingShear: v }))}>
                  {l}
                </button>
              ))}
            </div>
            <span className="col-span-2 text-[10px] text-gray-400 -mt-0.5 pl-2">저전단=섬유길이 유지(보강↑), 고전단=분산↑/섬유파단</span>
          </div>
          {/* 웰드라인 */}
          <div className="grid grid-cols-[160px_1fr] items-center gap-3 py-1.5 px-2">
            <Label className="text-sm">웰드라인</Label>
            <div className="flex gap-1 items-center">
              {[
                { v: true,  l: '있음' },
                { v: false, l: '없음' },
              ].map(({ v, l }) => (
                <button key={l}
                  className={`px-3 py-1 text-xs rounded border transition-colors ${(form.weldLinePresent ?? false) === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'}`}
                  onClick={() => setForm(f => ({ ...f, weldLinePresent: v }))}>
                  {l}
                </button>
              ))}
            </div>
            <span className="col-span-2 text-[10px] text-gray-400 -mt-0.5 pl-2">용접선 부위 충격·인장 저하 (충전재일수록 심함)</span>
          </div>
          {/* 어닐링 */}
          <div className="grid grid-cols-[160px_1fr] items-center gap-3 py-1.5 px-2">
            <Label className="text-sm">어닐링</Label>
            <div className="flex gap-1 items-center">
              {[
                { v: true,  l: '함' },
                { v: false, l: '안함' },
              ].map(({ v, l }) => (
                <button key={l}
                  className={`px-3 py-1 text-xs rounded border transition-colors ${(form.annealed ?? false) === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'}`}
                  onClick={() => setForm(f => ({ ...f, annealed: v }))}>
                  {l}
                </button>
              ))}
              <span className="text-[10px] text-gray-400 ml-1">응력완화 → HDT↑</span>
            </div>
          </div>
          {/* 노치 시험 */}
          <div className="grid grid-cols-[160px_1fr] items-center gap-3 py-1.5 px-2">
            <Label className="text-sm">노치 시험</Label>
            <div className="flex gap-1 items-center">
              {[
                { v: 'notched'   as const, l: '노치' },
                { v: 'unnotched' as const, l: '무노치' },
              ].map(({ v, l }) => (
                <button key={l}
                  className={`px-3 py-1 text-xs rounded border transition-colors ${(form.notchType ?? 'notched') === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'}`}
                  onClick={() => setForm(f => ({ ...f, notchType: v }))}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">── 첨가제</p>
          <SliderRow label="산화방지제"   value={form.antioxidant} min={0.3} max={0.8} step={0.05} unit="phr" onChange={set('antioxidant')} highlight={changedKey==='antioxidant'} />
          <SliderRow label="활제 (EBS)"   value={form.lubricant}  min={0.5} max={1.5} step={0.1} unit="phr"  onChange={set('lubricant')}  highlight={changedKey==='lubricant'} />

          {/* ── 매트릭스 개질 */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">── 매트릭스 개질</p>
          <SliderRow label="PC 블렌드"      value={form.pc}         min={0}  max={40} step={2}   unit="wt%"
            onChange={set('pc')} highlight={changedKey==='pc'}
            warn={form.pc > 0 ? `PC/ABS 형성 → Tg↑ 사출 270~290℃ 필요, 상용성 확인` : undefined} />
          <SliderRow label="αMSAN"          value={form.alphaMsan}  min={0}  max={30} step={2}   unit="wt%"
            onChange={set('alphaMsan')} highlight={changedKey==='alphaMsan'}
            warn={form.alphaMsan > 0 ? `SAN Tg +13℃ → HDT 추가 기여 (원가↑)` : undefined} />
          <SliderRow label="나노클레이 (MMT)" value={form.nanoclay} min={0}  max={8}  step={0.5} unit="wt%"
            onChange={set('nanoclay')} highlight={changedKey==='nanoclay'}
            warn={form.nanoclay > 5 ? '5wt% 초과 시 효과 포화·분산 저하 주의' : undefined} />

          {/* ── 충격보강제 */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">
            ── 충격보강제{' '}
            <span className="normal-case font-normal text-gray-300">(PMC11013094)</span>
          </p>
          <SliderRow label="EMA 상용화제"    value={form.ema}       min={0}  max={10} step={0.5} unit="wt%"
            onChange={set('ema')} highlight={changedKey==='ema'}
            warn={form.ema > 0 && form.uhmwSr > 0 ? `UHMW-SR 조합 → 충격 +212% (PMC11013094)` : undefined} />
          <SliderRow label="UHMW 실리콘 고무" value={form.uhmwSr}   min={0}  max={4}  step={0.5} unit="wt%"
            onChange={set('uhmwSr')} highlight={changedKey==='uhmwSr'}
            warn={form.uhmwSr > 0 && form.ema === 0 ? '단독 +64% — EMA 5wt% 추가 시 +212%' : undefined} />
          <SliderRow label="MBS 코어-셸"     value={form.mbs}       min={0}  max={10} step={0.5} unit="wt%"
            onChange={set('mbs')} highlight={changedKey==='mbs'}
            warn={form.mbs > 0 ? '투명·광택 유지 우수, 내열 영향 최소' : undefined} />
          <SliderRow label="SEBS"            value={form.sebs}      min={0}  max={10} step={0.5} unit="wt%"
            onChange={set('sebs')} highlight={changedKey==='sebs'}
            warn={form.sebs > 0 ? '저온 충격(-30℃) 특히 유효' : undefined} />
          <SliderRow label="아크릴계 충격보강" value={form.acrylicIm} min={0} max={8}  step={0.5} unit="wt%"
            onChange={set('acrylicIm')} highlight={changedKey==='acrylicIm'} />

          {/* ── 난연 */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">
            ── 난연{' '}
            <span className="normal-case font-normal text-gray-300">(PMC6401830)</span>
          </p>
          <SliderRow label="인계 난연제 (APP+AlPi)" value={form.phosphorusFr} min={0} max={25} step={1} unit="wt%"
            onChange={set('phosphorusFr')} highlight={changedKey==='phosphorusFr'}
            warn={form.phosphorusFr > 0 && form.phosphorusFr < (form.ptfe >= 0.2 ? 15 : 20)
              ? `V-0은 ≥${form.ptfe >= 0.2 ? 15 : 20}wt% 필요${form.ptfe < 0.2 ? ' (또는 PTFE 0.2wt+ 병용)' : ''}` : undefined} />
          <SliderRow label="PTFE 분말 (anti-drip)" value={form.ptfe} min={0} max={1} step={0.1} unit="wt%"
            onChange={set('ptfe')} highlight={changedKey==='ptfe'}
            warn={form.ptfe >= 0.2 && form.phosphorusFr > 0 ? `PTFE 병용 → V-0 임계 15wt%로 하향` : undefined} />

          {/* ── 충전재·강화재 */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">── 충전재·강화재</p>
          <SliderRow label="탈크 (Talc)"     value={form.talc}        min={0}  max={15} step={1}  unit="wt%"
            onChange={set('talc')} highlight={changedKey==='talc'} />
          <SliderRow label="유리섬유 (GF)"   value={form.glassFiber}  min={0}  max={30} step={5}  unit="wt%"
            onChange={set('glassFiber')} highlight={changedKey==='glassFiber'}
            warn={form.glassFiber > 0 ? '외관·충격↓, HDT·강성↑. 가공온도 265℃+ 권장' : undefined} />
          <SliderRow label="카본섬유 (CF)"   value={form.carbonFiber} min={0}  max={20} step={5}  unit="wt%"
            onChange={set('carbonFiber')} highlight={changedKey==='carbonFiber'}
            warn={form.carbonFiber > 0 ? `GF 대비 경량·강성↑↑, 원가 ★★★★★` : undefined} />

          {/* ── 기능성 소량 첨가제 */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">── 기능성 소량 첨가제</p>
          <SliderRow label="실란 커플링제"   value={form.silane}         min={0}  max={0.5} step={0.05} unit="phr"
            onChange={set('silane')} highlight={changedKey==='silane'}
            warn={form.silane >= 0.1 && (form.glassFiber > 0 || form.talc > 0) ? `GF 효율 +30%, 탈크 효율 +20%` : undefined} />
          <SliderRow label="왁스 (PE·몬탄)"  value={form.wax}            min={0}  max={1.5} step={0.1} unit="phr"
            onChange={set('wax')} highlight={changedKey==='wax'} />
          <SliderRow label="HALS 광안정제"   value={form.hals}           min={0}  max={1.0} step={0.1} unit="phr"
            onChange={set('hals')} highlight={changedKey==='hals'}
            warn={form.hals > 0 ? `QUV 3000h 내광성 보증 가능 수준` : undefined} />
          <SliderRow label="열안정제"         value={form.heatStabilizer} min={0}  max={0.5} step={0.05} unit="phr"
            onChange={set('heatStabilizer')} highlight={changedKey==='heatStabilizer'} />
          <SliderRow label="금속불활성화제"   value={form.metalDeact}     min={0}  max={0.2} step={0.02} unit="phr"
            onChange={set('metalDeact')} highlight={changedKey==='metalDeact'} />
          <SliderRow label="대전방지제"       value={form.antistatic}     min={0}  max={1.0} step={0.1} unit="phr"
            onChange={set('antistatic')} highlight={changedKey==='antistatic'} />

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">── 공정 조건</p>
          <SliderRow label="사출 온도" value={form.injTemp} min={240} max={280} step={1} unit="℃"
            onChange={set('injTemp')}
            highlight={changedKey==='injTemp'}
            warn={form.injTemp > 255 ? '⚠ 고온 체류 시 VOC 증가 위험' : undefined} />
          <div className="grid grid-cols-[160px_1fr] items-center gap-3 py-1.5 px-2">
            <Label className="text-sm">금형 온도</Label>
            <div className="flex gap-1">
              {[50,70,80].map(t => (
                <button key={t}
                  className={`px-3 py-1 text-xs rounded border transition-colors ${form.moldTemp === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'}`}
                  onClick={() => set('moldTemp')(t)}>
                  {t}℃
                </button>
              ))}
            </div>
          </div>

          {!compositionOk && (
            <p className="text-xs text-red-600 pt-2 px-2">⚠ 조성 합계 초과. N-PMI·g-ABS 또는 추가 재료 함량을 낮추세요.</p>
          )}
        </CardContent>
      </Card>

      {/* 오른쪽: 예측 결과 (실시간) */}
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">M2 — 물성 예측</CardTitle>
              <div className="flex items-center gap-2">
                <button
                  className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                  onClick={() => {
                    const headers = 'LOT,N-PMI,g-ABS,AN함량,PC,αMSAN,나노클레이,EMA,UHMW-SR,MBS,SEBS,아크릴IM,인계FR,PTFE,탈크,GF,CF,실란,산화방지제,활제,왁스,사출온도,금형온도,SAN추정,HDT_1.8,HDT_0.45,Vicat,Izod,인장강도,비중,MFI_220_10,MI_200_21.6,MI_250_2.16,MI_250_5,TVOC,원가,UL94,세그먼트'
                    const row = [
                      lotName || '(미지정)',
                      form.npmi, form.gAbs, form.anContent, form.pc, form.alphaMsan, form.nanoclay,
                      form.ema, form.uhmwSr, form.mbs, form.sebs, form.acrylicIm,
                      form.phosphorusFr, form.ptfe, form.talc, form.glassFiber, form.carbonFiber,
                      form.silane, form.antioxidant, form.lubricant, form.wax,
                      form.injTemp, form.moldTemp, sanEst.toFixed(1),
                      pred.hdt.value.toFixed(1), pred.hdt045.value.toFixed(1), pred.vicat.value.toFixed(1),
                      pred.izod.value.toFixed(1), pred.tensile.value.toFixed(1), pred.density.value.toFixed(3),
                      pred.mfi.value.toFixed(1), pred.mi200.value.toFixed(1), pred.mi250_2.value.toFixed(1), pred.mi250_5.value.toFixed(1),
                      pred.voc.value.toFixed(0), pred.cost.value.toFixed(0), pred.ul94, pred.segment,
                    ].join(',')
                    const csv = headers + '\n' + row
                    const a = document.createElement('a')
                    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
                    a.download = `M2_pred_${lotName || 'export'}.csv`; a.click()
                  }}>
                  📥 CSV 내보내기
                </button>
                <span className="text-xs px-2 py-0.5 rounded font-mono"
                  style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }}>
                  {pred.segment}
                </span>
                {form.weldLinePresent && (
                  <span className="text-xs px-2 py-0.5 rounded font-medium"
                    style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #f59e0b' }}>
                    ⚠ 웰드라인
                  </span>
                )}
                {((!(form.materialDried ?? true) && (form.humidity ?? 50) >= 70) || (form.ambientTemp ?? 23) < 0) && (
                  <span className="text-xs px-2 py-0.5 rounded font-medium"
                    style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #f59e0b' }}>
                    ⚠ 환경 영향
                  </span>
                )}
                {calibResult?.active
                  ? <Badge className="text-xs bg-green-600 text-white border-0">M5 보정 적용 중</Badge>
                  : <Badge variant="outline" className="text-xs">Cold-start</Badge>}
                {(() => {
                  const conf = pred.confidence
                  const map: Record<typeof conf, { label: string; bg: string; color: string; border: string }> = {
                    cold:   { label: '콜드스타트',   bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
                    low:    { label: '신뢰도 낮음', bg: '#fef3c7', color: '#b45309', border: '#f59e0b' },
                    medium: { label: '신뢰도 보통', bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
                    high:   { label: '신뢰도 높음', bg: '#dcfce7', color: '#15803d', border: '#86efac' },
                  }
                  const m = map[conf]
                  return (
                    <span className="text-xs px-2 py-0.5 rounded font-medium"
                      style={{ background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
                      {m.label}
                    </span>
                  )
                })()}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-3">
            <MetricGauge label={SPEC.hdt.label}  {...pred.hdt}  unit={SPEC.hdt.unit}  min={SPEC.hdt.min}  max={SPEC.hdt.max}  target={SPEC.hdt.target}  higherIsBetter={true} />
            <MetricGauge label="HDT (0.45MPa)" {...pred.hdt045} unit="℃" min={90} max={160} higherIsBetter={true} />
            <MetricGauge label={SPEC.vicat.label} {...pred.vicat} unit={SPEC.vicat.unit} min={SPEC.vicat.min} max={SPEC.vicat.max} higherIsBetter={true} />
            {form.notchType === 'unnotched'
              ? <MetricGauge label="Izod 충격(무노치)" {...pred.izodUnnotched} unit={SPEC.izod.unit} min={0} max={120} higherIsBetter={true} />
              : <MetricGauge label="Izod 충격(노치)" {...pred.izod} unit={SPEC.izod.unit} min={SPEC.izod.min} max={SPEC.izod.max} target={SPEC.izod.target} higherIsBetter={true} />}
            {/* 인장강도 */}
            <MetricGauge label="인장강도" {...pred.tensile} unit="MPa" min={15} max={80} higherIsBetter={true} />
            {/* 직각방향 인장 (이방성) — 섬유 충전재일 때만 */}
            {(form.glassFiber + form.carbonFiber) > 0 && (
              <div className="flex items-baseline justify-between -mt-1 mb-2 px-0.5">
                <span className="text-[11px] text-gray-400">인장(직각방향) <span className="text-[9px] text-amber-500">이방성</span></span>
                <span className="text-xs font-mono text-gray-400 tabular-nums">{pred.tensileCross.value.toFixed(1)} <span className="text-[10px]">MPa</span></span>
              </div>
            )}
            {/* 비중 */}
            <MetricGauge label="비중 (계산)" {...pred.density} unit="g/cm³" min={1.0} max={1.5} higherIsBetter={false} />
            {/* MI 4조건 탭 */}
            <div className="mt-2 pt-2 border-t">
              <p className="text-xs font-semibold text-gray-400 mb-1">용융지수 (MI)</p>
              <div className="flex gap-1 mb-2 flex-wrap">
                {[
                  { key: 'mfi', label: '220/10' },
                  { key: 'mi200', label: '200/21.6' },
                  { key: 'mi250_2', label: '250/2.16' },
                  { key: 'mi250_5', label: '250/5' },
                ].map(({ key, label }) => (
                  <button key={key}
                    className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${miTab === key ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-200 text-gray-500 hover:border-purple-400'}`}
                    onClick={() => setMiTab(key as 'mfi'|'mi200'|'mi250_2'|'mi250_5')}>
                    {label}
                  </button>
                ))}
              </div>
              {miTab === 'mfi'    && <MetricGauge label="MFI (220℃/10kg)"  {...pred.mfi}    unit="g/10min" min={0} max={40} higherIsBetter={false} />}
              {miTab === 'mi200'  && <MetricGauge label="MI (200℃/21.6kg)" {...pred.mi200}  unit="g/10min" min={0} max={40} higherIsBetter={false} />}
              {miTab === 'mi250_2' && <MetricGauge label="MI (250℃/2.16kg)" {...pred.mi250_2} unit="g/10min" min={0} max={40} higherIsBetter={false} />}
              {miTab === 'mi250_5' && <MetricGauge label="MI (250℃/5kg)"    {...pred.mi250_5} unit="g/10min" min={0} max={40} higherIsBetter={false} />}
            </div>
            <MetricGauge label={SPEC.voc.label}  {...pred.voc}  unit={SPEC.voc.unit}  min={SPEC.voc.min}  max={SPEC.voc.max}  target={SPEC.voc.target}  higherIsBetter={false} />
            <MetricGauge label={SPEC.cost.label} {...pred.cost} unit={SPEC.cost.unit} min={SPEC.cost.min} max={SPEC.cost.max} higherIsBetter={false} />

            {/* UL-94 */}
            <div className="flex items-center justify-between mt-1 pt-2 border-t">
              <span className="text-xs text-gray-500">UL-94 등급</span>
              <UL94Badge rating={pred.ul94} />
            </div>

            {/* 골든존 배지 */}
            {pred.specPass.hdt !== false && pred.specPass.izod !== false && pred.izod.value >= 10 && pred.hdt.value >= 100 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded mb-2"
                style={{ background: '#fef3c7', border: '1px solid #f59e0b' }}>
                <span className="text-xl">🎯</span>
                <div>
                  <span className="text-sm font-bold text-amber-700">골든존</span>
                  <span className="text-xs text-amber-600 ml-2">충격 ≥10 · 내열 ≥100 동시 달성</span>
                </div>
              </div>
            )}
            {/* 자동 제안 */}
            <AutoSuggest
              pred={pred}
              form={{ ...form, san: sanEst }}
              onApply={patch => setForm(f => ({ ...f, ...patch }))}
            />
            {/* 5단계 표정 미터 */}
            <FaceMeter pred={pred} />

            {/* Spec 게이트 신호등 */}
            <div className="mt-3 pt-2 border-t">
              <p className="text-xs font-semibold text-gray-400 mb-2">M8 — Spec 게이트</p>
              <div className="grid grid-cols-3 gap-2">
                {(Object.entries(pred.specPass) as [keyof typeof pred.specPass, boolean | null][]).map(([key, val]) => (
                  <div key={key} className="flex flex-col items-center gap-1 p-2 rounded bg-gray-50">
                    <SpecLight pass={val} />
                    <span className="text-xs font-mono font-medium">{key.toUpperCase()}</span>
                    <span className="text-[10px] text-gray-400">
                      {key === 'hdt' ? '≥115℃' : key === 'izod' ? '≥15kJ/m²' : '≤50µg/g'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-300 mt-2">Cold-start 오차 ±7~30%. 세로선 = 목표값.</p>
            </div>

            {/* 2차 검증 체크 */}
            <div className="mt-3 pt-2 border-t">
              <p className="text-xs font-semibold text-gray-400 mb-2">2차 검증 (물리법칙)</p>
              <ValidationChecks pred={pred} />
            </div>

            {/* 논문 인사이트 */}
            {pred.additiveSummary.length > 0 && (
              <div className="mt-2 pt-2 border-t space-y-1">
                <p className="text-xs font-semibold text-gray-400">첨가제 인사이트</p>
                {pred.additiveSummary.map((msg, i) => (
                  <p key={i} className="text-xs text-gray-600">{msg}</p>
                ))}
              </div>
            )}

            {/* 저장 */}
            <div className="mt-3 pt-2 border-t flex gap-2">
              <Input placeholder="LOT 번호 (선택)" value={lotName}
                onChange={e => setLotName(e.target.value)} className="text-sm h-8" />
              <Button size="sm" variant="outline" onClick={handleSave} disabled={!compositionOk}>
                트래커 저장
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 영향도 분석 */}
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">영향도 분석</CardTitle>
              <div className="flex gap-1 flex-wrap">
                {(['hdt','izod','tensile','mfi','voc','density'] as SensProp[]).map(p => (
                  <button key={p}
                    className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${sensTab === p ? 'bg-slate-700 text-white border-slate-700' : 'border-gray-200 text-gray-500 hover:border-slate-400'}`}
                    onClick={() => setSensTab(p)}>
                    {p === 'hdt' ? 'HDT' : p === 'izod' ? 'Izod' : p === 'tensile' ? '인장' : p === 'mfi' ? 'MFI' : p === 'voc' ? 'VOC' : '비중'}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-3">
            <SensitivityBars formulation={{ ...form, san: sanEst }} prop={sensTab} />
            <p className="text-[10px] text-gray-400 mt-2">현재 배합 기준 수치 미분 · 초록=증가 기여 · 빨강=감소 기여</p>
          </CardContent>
        </Card>

        {/* Trade-off 인사이트 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Trade-off 인사이트</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1 text-gray-600 pb-3">
            {form.npmi > 20 && <p>🔺 N-PMI {form.npmi}% — 내열↑, 충격↓·MFI↓</p>}
            {form.npmi < 13 && <p>🔻 N-PMI {form.npmi}% — 충격·유동↑, HDT 115℃ 달성 어려움</p>}
            {form.gAbs > 35 && <p>🔺 고무 {form.gAbs}% — 충격↑, HDT·강성↓·VOC 경향↑</p>}
            {form.injTemp > 255 && <p>⚠ 사출 {form.injTemp}℃ — TVOC spike 위험</p>}
            {pred.specPass.hdt === false && <p>❌ HDT 미달 → N-PMI ↑ 또는 탈크·GF 추가</p>}
            {pred.specPass.voc === false && <p>❌ VOC 초과 → 탈휘발 강화 또는 AO 패키지 재검토</p>}
            {pred.specPass.hdt === true && pred.specPass.izod === true && pred.specPass.voc === true && (
              <p>✅ 3대 Spec 통과 예측 — 실배합 검증 권장</p>
            )}
            {pred.specPass.hdt === null && <p>⚠ HDT 경계구간 (110~115℃) — 실험 우선</p>}
            {totalComposition > 90 && <p className="text-orange-600">⚠ 총 조성 {totalComposition.toFixed(0)}% — SAN 잔량 {sanEst.toFixed(0)}%</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// 원가-HDT 파레토 산점도
function ParetoScatter({
  results, selectedRank, onSelect,
}: { results: CandidateResult[]; selectedRank: number | null; onSelect: (r: number | null) => void }) {
  if (results.length === 0) return null
  const W = 340, H = 200, PAD = { l: 38, r: 12, t: 8, b: 28 }
  const costs = results.map(r => r.prediction.cost.value)
  const hdts  = results.map(r => r.prediction.hdt.value)
  const minC = Math.min(...costs), maxC = Math.max(...costs)
  const minH = Math.min(...hdts),  maxH = Math.max(...hdts)
  const cx = (v: number) => PAD.l + ((v - minC) / (maxC - minC + 1)) * (W - PAD.l - PAD.r)
  const cy = (v: number) => H - PAD.b - ((v - minH) / (maxH - minH + 1)) * (H - PAD.t - PAD.b)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
      {/* 축 */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="#cbd5e1" strokeWidth={1} />
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="#cbd5e1" strokeWidth={1} />
      <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" fontSize={8} fill="#94a3b8">HDT</text>
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize={8} fill="#94a3b8">원가 (₩/kg)</text>
      {/* 눈금 */}
      {[minH, (minH + maxH) / 2, maxH].map((v, i) => (
        <text key={i} x={PAD.l - 4} y={cy(v) + 3} textAnchor="end" fontSize={7} fill="#94a3b8">{v.toFixed(0)}</text>
      ))}
      {[minC, maxC].map((v, i) => (
        <text key={i} x={cx(v)} y={H - PAD.b + 10} textAnchor="middle" fontSize={7} fill="#94a3b8">{v.toFixed(0)}</text>
      ))}
      {/* 점 */}
      {results.map(r => {
        const x = cx(r.prediction.cost.value)
        const y = cy(r.prediction.hdt.value)
        const selected = r.rank === selectedRank
        const pass = r.specAllPass
        return (
          <circle key={r.rank} cx={x} cy={y} r={selected ? 6 : 4}
            fill={pass ? (selected ? '#2563eb' : '#22c55e') : (selected ? '#2563eb' : 'none')}
            stroke={pass ? (selected ? '#1d4ed8' : '#16a34a') : '#94a3b8'}
            strokeWidth={selected ? 2 : 1}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect(r.rank === selectedRank ? null : r.rank)}>
            <title>#{r.rank} HDT={r.prediction.hdt.value.toFixed(1)}℃ 원가={r.prediction.cost.value.toFixed(0)}₩</title>
          </circle>
        )
      })}
    </svg>
  )
}

// M6: 자동 탐색 엔진
// ──────────────────────────────────────────────
type SearchRangeKey = keyof Omit<SearchConfig,
  'injTemp'|'moldTemp'|'antioxidant'|'lubricant'|'cbMB'|
  'alphaMsan'|'acrylicIm'|'ptfe'|'silane'|'wax'|'hals'|
  'heatStabilizer'|'metalDeact'|'antistatic'>

const FACTOR_LABELS: Record<SearchRangeKey, string> = {
  npmi:         'N-PMI (wt%)',
  gAbs:         'g-ABS 고무 (wt%)',
  anContent:    'AN 함량 (%)',
  ema:          'EMA 상용화제 (wt%)',
  uhmwSr:       'UHMW 실리콘 고무 (wt%)',
  phosphorusFr: '인계 난연제 (wt%)',
  talc:         '탈크 (wt%)',
  glassFiber:   '유리섬유 GF (wt%)',
  pc:           'PC 블렌드 (wt%)',
  nanoclay:     '나노클레이 (wt%)',
  mbs:          'MBS 코어-셸 (wt%)',
  sebs:         'SEBS (wt%)',
  carbonFiber:  '카본섬유 CF (wt%)',
}

function ScoreBadge({ score, pass }: { score: number; pass: boolean }) {
  const color = pass ? (score >= 80 ? '#15803d' : '#2563eb') : score >= 60 ? '#d97706' : '#dc2626'
  const bg    = pass ? (score >= 80 ? '#dcfce7' : '#dbeafe') : score >= 60 ? '#fef9c3' : '#fee2e2'
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-bold font-mono"
      style={{ color, background: bg, border: `1px solid ${color}44` }}>
      {score.toFixed(0)}점
    </span>
  )
}

function MarginChip({ value, unit, positive }: { value: number; unit: string; positive: boolean }) {
  const ok = positive ? value >= 0 : value >= 0
  return (
    <span className={`text-xs font-mono ${ok ? 'text-green-600' : 'text-red-500'}`}>
      {value >= 0 ? '+' : ''}{value.toFixed(1)}{unit}
    </span>
  )
}

function SearchTab({ onLoadFormulation }: { onLoadFormulation: (f: Formulation) => void }) {
  const [config, setConfig]   = useState<SearchConfig>(DEFAULT_SEARCH_CONFIG)
  const [target, setTarget]   = useState<SearchTarget>(DEFAULT_TARGET)
  const [results, setResults] = useState<CandidateResult[]>([])
  const [meta, setMeta]       = useState<{ searched: number; pass: number; ms: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [selectedRank, setSelectedRank] = useState<number | null>(null)

  const rangeKeys = Object.keys(FACTOR_LABELS) as SearchRangeKey[]

  const setRange = (key: SearchRangeKey, field: 'min'|'max'|'step'|'enabled', val: number | boolean) => {
    setConfig(c => ({ ...c, [key]: { ...(c[key] as SearchRange), [field]: val } }))
  }

  const handleRun = () => {
    setRunning(true)
    setResults([])
    setMeta(null)
    setSelectedRank(null)
    // setTimeout으로 UI가 먼저 렌더링되게 한 뒤 계산
    setTimeout(() => {
      const t0 = performance.now()
      const { candidates, totalSearched, passCount } = runGridSearch(config, target, 50, 8000)
      const ms = performance.now() - t0
      setResults(candidates)
      setMeta({ searched: totalSearched, pass: passCount, ms })
      setRunning(false)
    }, 30)
  }

  const selected = selectedRank != null ? results.find(r => r.rank === selectedRank) : null

  // 탐색 범위별 예상 조합 수
  const estimatedCombinations = rangeKeys.reduce((acc, key) => {
    const r = config[key] as SearchRange
    if (!r.enabled) return acc
    const n = Math.round((r.max - r.min) / r.step) + 1
    return acc * Math.max(1, n)
  }, 1)

  return (
    <div className="grid grid-cols-[320px_1fr] gap-4">
      {/* 왼쪽: 탐색 설정 */}
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">탐색 범위 설정</CardTitle>
            <p className="text-xs text-gray-400">
              예상 조합: <strong className={estimatedCombinations > 8000 ? 'text-orange-500' : 'text-gray-600'}>
                {estimatedCombinations.toLocaleString()}
              </strong>
              {estimatedCombinations > 8000 && ' (8,000개 랜덤 샘플링)'}
            </p>
          </CardHeader>
          <CardContent className="space-y-2 pb-3">
            {rangeKeys.map(key => {
              const r = config[key] as SearchRange
              return (
                <div key={key} className={`rounded border p-2 transition-colors ${r.enabled ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <input type="checkbox" checked={r.enabled}
                      onChange={e => setRange(key, 'enabled', e.target.checked)}
                      className="accent-blue-600" />
                    <span className="text-xs font-medium">{FACTOR_LABELS[key]}</span>
                  </div>
                  {r.enabled && (
                    <div className="grid grid-cols-3 gap-1 mt-1">
                      {(['min','max','step'] as const).map(f => (
                        <label key={f} className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-gray-400">{f === 'min' ? '최솟값' : f === 'max' ? '최댓값' : '간격'}</span>
                          <input type="number" value={(r as unknown as Record<string, number>)[f]}
                            onChange={e => setRange(key, f, +e.target.value)}
                            className="h-6 w-full text-xs border rounded px-1.5 font-mono" />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">목표 Spec & 가중치</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-3 text-xs">
            {[
              { key: 'hdt',  label: 'HDT 최소 (℃)',      field: 'min' as const },
              { key: 'izod', label: 'Izod 최소 (kJ/m²)', field: 'min' as const },
              { key: 'voc',  label: 'VOC 최대 (µg/g)',    field: 'max' as const },
              { key: 'cost', label: '원가 상한 (₩/kg)',   field: 'max' as const },
            ].map(({ key, label, field }) => (
              <div key={key} className="grid grid-cols-[1fr_60px_48px] gap-2 items-center">
                <span className="text-gray-600">{label}</span>
                <input type="number"
                  value={(target as unknown as Record<string, Record<string, number>>)[key][field]}
                  onChange={e => setTarget(t => ({ ...t, [key]: { ...t[key as keyof SearchTarget], [field]: +e.target.value } }))}
                  className="h-6 text-xs border rounded px-1.5 font-mono w-full" />
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-[10px]">×</span>
                  <input type="number" min={0} max={5}
                    value={(target as unknown as Record<string, Record<string, number>>)[key].weight}
                    onChange={e => setTarget(t => ({ ...t, [key]: { ...t[key as keyof SearchTarget], weight: +e.target.value } }))}
                    className="h-6 w-8 text-xs border rounded px-1 font-mono" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Button className="w-full" onClick={handleRun} disabled={running}>
          {running ? '🔍 탐색 중...' : '자동 탐색 실행'}
        </Button>

        {meta && (
          <div className="text-xs text-gray-500 text-center space-y-0.5">
            <p>{meta.searched.toLocaleString()}개 배합 탐색 · {meta.ms.toFixed(0)}ms</p>
            <p>Spec 전체 통과: <strong className="text-green-600">{meta.pass.toLocaleString()}개</strong></p>
          </div>
        )}
      </div>

      {/* 오른쪽: 결과 테이블 + 상세 */}
      <div className="space-y-3">
        {running && (
          <Card>
            <CardContent className="py-16 text-center text-gray-400">
              <div className="text-2xl mb-2 animate-spin inline-block">⚙</div>
              <p className="text-sm">배합 조합 탐색 중...</p>
            </CardContent>
          </Card>
        )}

        {!running && results.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center text-sm text-gray-400">
              탐색 범위를 설정하고 [자동 탐색 실행]을 클릭하세요.<br />
              <span className="text-xs">수천 개 배합을 자동으로 시뮬레이션해서 최적 후보를 랭킹합니다.</span>
            </CardContent>
          </Card>
        )}

        {results.length > 0 && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">
                    탐색 결과 Top {results.length}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      (클릭 → 예측 탭에 로드)
                    </span>
                  </CardTitle>
                  <button
                    className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                    onClick={() => {
                      const headers = '순위,점수,Spec통과,N-PMI,g-ABS,AN함량,EMA,UHMW-SR,인계FR,탈크,GF,PC,나노클레이,MBS,SEBS,CF,HDT,Izod,TVOC,원가,HDT여유,Izod여유,VOC여유'
                      const rows = results.map(r => [
                        r.rank, r.score.toFixed(0), r.specAllPass ? 'Y' : 'N',
                        r.formulation.npmi, r.formulation.gAbs, r.formulation.anContent,
                        r.formulation.ema, r.formulation.uhmwSr, r.formulation.phosphorusFr,
                        r.formulation.talc, r.formulation.glassFiber, r.formulation.pc,
                        r.formulation.nanoclay, r.formulation.mbs, r.formulation.sebs, r.formulation.carbonFiber,
                        r.prediction.hdt.value.toFixed(1), r.prediction.izod.value.toFixed(1),
                        r.prediction.voc.value.toFixed(0), r.prediction.cost.value.toFixed(0),
                        r.hdtMargin.toFixed(1), r.izodMargin.toFixed(1), r.vocMargin.toFixed(1),
                      ].join(','))
                      const csv = [headers, ...rows].join('\n')
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
                      a.download = 'M6_search.csv'; a.click()
                    }}>
                    📥 CSV 내보내기
                  </button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[480px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 border-b">
                      <tr>
                        {['순위','점수','Spec','N-PMI','g-ABS','AN','EMA','SR','FR','탈크','GF',
                          'HDT±','Izod±','VOC±','원가'].map(h => (
                          <th key={h} className="text-left px-2 py-1.5 font-medium text-gray-500 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.map(r => (
                        <tr key={r.rank}
                          onClick={() => setSelectedRank(r.rank === selectedRank ? null : r.rank)}
                          className={`border-b cursor-pointer transition-colors hover:bg-blue-50 ${
                            selectedRank === r.rank ? 'bg-blue-100' : r.specAllPass ? '' : 'opacity-60'
                          }`}>
                          <td className="px-2 py-1.5 font-bold text-gray-600">#{r.rank}</td>
                          <td className="px-2 py-1.5"><ScoreBadge score={r.score} pass={r.specAllPass} /></td>
                          <td className="px-2 py-1.5">
                            <div className="flex gap-0.5">
                              <span className={`w-2 h-2 rounded-full mt-0.5 ${r.prediction.specPass.hdt === true ? 'bg-green-500' : r.prediction.specPass.hdt === null ? 'bg-yellow-400' : 'bg-red-500'}`} />
                              <span className={`w-2 h-2 rounded-full mt-0.5 ${r.prediction.specPass.izod === true ? 'bg-green-500' : r.prediction.specPass.izod === null ? 'bg-yellow-400' : 'bg-red-500'}`} />
                              <span className={`w-2 h-2 rounded-full mt-0.5 ${r.prediction.specPass.voc === true ? 'bg-green-500' : r.prediction.specPass.voc === null ? 'bg-yellow-400' : 'bg-red-500'}`} />
                            </div>
                          </td>
                          <td className="px-2 py-1.5 font-mono">{r.formulation.npmi}</td>
                          <td className="px-2 py-1.5 font-mono">{r.formulation.gAbs}</td>
                          <td className="px-2 py-1.5 font-mono">{r.formulation.anContent}</td>
                          <td className="px-2 py-1.5 font-mono">{r.formulation.ema || '—'}</td>
                          <td className="px-2 py-1.5 font-mono">{r.formulation.uhmwSr || '—'}</td>
                          <td className="px-2 py-1.5 font-mono">{r.formulation.phosphorusFr || '—'}</td>
                          <td className="px-2 py-1.5 font-mono">{r.formulation.talc || '—'}</td>
                          <td className="px-2 py-1.5 font-mono">{r.formulation.glassFiber || '—'}</td>
                          <td className="px-2 py-1.5"><MarginChip value={r.hdtMargin}  unit="℃"     positive={true} /></td>
                          <td className="px-2 py-1.5"><MarginChip value={r.izodMargin} unit=""       positive={true} /></td>
                          <td className="px-2 py-1.5"><MarginChip value={r.vocMargin}  unit="µg/g"  positive={true} /></td>
                          <td className="px-2 py-1.5 font-mono text-gray-500">{r.prediction.cost.value.toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* 원가-HDT 산점도 */}
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm">원가 vs 내열 파레토</CardTitle>
              </CardHeader>
              <CardContent className="pb-3">
                <ParetoScatter results={results} selectedRank={selectedRank} onSelect={setSelectedRank} />
                <p className="text-[10px] text-gray-400 mt-1">● Spec전체통과 ○ 미통과 · 클릭으로 선택</p>
              </CardContent>
            </Card>

            {/* 선택 배합 상세 */}
            {selected && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">#{selected.rank} 배합 상세</CardTitle>
                    <Button size="sm" className="h-7 text-xs"
                      onClick={() => onLoadFormulation(selected.formulation)}>
                      ← 예측 탭에 로드해서 확인
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="font-semibold text-gray-500 mb-2">조성</p>
                      <div className="space-y-1 font-mono">
                        {[
                          ['N-PMI', selected.formulation.npmi, 'wt%'],
                          ['g-ABS', selected.formulation.gAbs, 'wt%'],
                          ['SAN(추정)', selected.formulation.san.toFixed(1), 'wt%'],
                          ['AN 함량', selected.formulation.anContent, '%'],
                          ['카본블랙', selected.formulation.cbMB, 'wt%'],
                          ['EMA', selected.formulation.ema, 'wt%'],
                          ['UHMW-SR', selected.formulation.uhmwSr, 'wt%'],
                          ['인계 FR', selected.formulation.phosphorusFr, 'wt%'],
                          ['탈크', selected.formulation.talc, 'wt%'],
                          ['유리섬유', selected.formulation.glassFiber, 'wt%'],
                        ].map(([k, v, u]) => (
                          <div key={String(k)} className="flex justify-between">
                            <span className="text-gray-500">{k}</span>
                            <span>{v} <span className="text-gray-400">{u}</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-500 mb-2">예측 물성</p>
                      <div className="space-y-1">
                        {[
                          { label: 'HDT', val: selected.prediction.hdt.value, unit: '℃', target: 115, good: selected.prediction.hdt.value >= 115 },
                          { label: 'Izod', val: selected.prediction.izod.value, unit: 'kJ/m²', target: 15, good: selected.prediction.izod.value >= 15 },
                          { label: 'TVOC', val: selected.prediction.voc.value, unit: 'µg/g', target: 50, good: selected.prediction.voc.value <= 50 },
                          { label: 'MFI', val: selected.prediction.mfi.value, unit: 'g/10min', target: 0, good: true },
                          { label: '원가', val: selected.prediction.cost.value, unit: '₩/kg', target: 0, good: true },
                        ].map(row => (
                          <div key={row.label} className="flex justify-between items-center font-mono">
                            <span className="text-gray-500">{row.label}</span>
                            <span className={`font-bold ${row.good ? 'text-green-600' : 'text-red-600'}`}>
                              {row.val.toFixed(1)} <span className="text-gray-400 font-normal text-[10px]">{row.unit}</span>
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between items-center mt-1 pt-1 border-t">
                          <span className="text-gray-500">UL-94</span>
                          <UL94Badge rating={selected.prediction.ul94} />
                        </div>
                      </div>
                    </div>
                  </div>
                  {selected.prediction.additiveSummary.length > 0 && (
                    <div className="mt-3 pt-2 border-t space-y-1">
                      {selected.prediction.additiveSummary.map((msg, i) => (
                        <p key={i} className="text-xs text-gray-600">{msg}</p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// M3: DOE 설계기
// ──────────────────────────────────────────────
function DOETab() {
  const [mode, setMode] = useState<'screening' | 'rsm'>('screening')
  const [factors, setFactors] = useState(DEFAULT_FACTORS)
  const [runs, setRuns] = useState<DOERun[]>([])

  const handleGenerate = () => {
    setRuns(mode === 'screening' ? generateScreeningDOE(factors) : generateRSMDOE(factors))
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">M3 — DOE 설계기</CardTitle>
        <p className="text-xs text-gray-500">
          스크리닝: PB12 (12회, 7인자) → RSM: Box-Behnken (15회, 지배 3인자)
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 items-center">
          <Select value={mode} onValueChange={v => { setMode(v as typeof mode); setRuns([]) }}>
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="screening">스크리닝 DOE — Plackett-Burman 12</SelectItem>
              <SelectItem value="rsm">반응표면 DOE — Box-Behnken 15</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleGenerate}>실험 세트 생성</Button>
          <span className="text-xs text-gray-400">{mode === 'screening' ? '12회' : '15회'}</span>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">인자</TableHead>
              <TableHead className="text-xs">단위</TableHead>
              <TableHead className="text-xs">Low (−1)</TableHead>
              <TableHead className="text-xs">Center (0)</TableHead>
              <TableHead className="text-xs">High (+1)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {factors.map((f, i) => (
              <TableRow key={f.name} className={i >= 3 && mode === 'rsm' ? 'opacity-40' : ''}>
                <TableCell className="text-sm font-medium">{f.name}</TableCell>
                <TableCell className="text-xs text-gray-500">{f.unit}</TableCell>
                {(['low', 'center', 'high'] as const).map(k => (
                  <TableCell key={k}>
                    <Input type="number" className="h-7 w-20 text-xs" value={f[k]}
                      onChange={e => setFactors(fs => fs.map((x, j) => j === i ? { ...x, [k]: +e.target.value } : x))} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {mode === 'rsm' && <p className="text-xs text-gray-400">Box-Behnken: 상위 3개 인자만 활성, 나머지 Center 고정</p>}

        {runs.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400">실험 세트 ({runs.length}회)</p>
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => {
                const csv = [
                  ['Run', ...factors.map(f => `${f.name}(${f.unit})`)].join(','),
                  ...runs.map(r => [r.label, ...factors.map(f => r.factors[f.name] ?? '')].join(','))
                ].join('\n')
                const a = document.createElement('a')
                a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
                a.download = `DOE_${mode}.csv`; a.click()
              }}>CSV 다운로드</Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Run</TableHead>
                    {factors.map(f => <TableHead key={f.name} className="text-xs">{f.name}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.label}</TableCell>
                      {factors.map(f => (
                        <TableCell key={f.name} className="text-xs font-mono">
                          {r.factors[f.name] != null ? r.factors[f.name].toFixed(1) : '—'}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ──────────────────────────────────────────────
// M4: 실험 트래커
// ──────────────────────────────────────────────
function TrackerTab({ records, onUpdateRecord, onBulkAdd }: {
  records: ExperimentRecord[]
  onUpdateRecord: (id: number, actual: ExperimentRecord['actual'], note: string) => void
  onBulkAdd: (recs: ExperimentRecord[]) => void
}) {
  const [editId, setEditId] = useState<number | null>(null)
  const [editActual, setEditActual] = useState<ExperimentRecord['actual']>({})
  const [editNote, setEditNote] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const num = (s: string | undefined, fallback: number): number => {
    if (s == null) return fallback
    const v = parseFloat(s.trim())
    return isNaN(v) ? fallback : v
  }
  const optNum = (s: string | undefined): number | undefined => {
    if (s == null || s.trim() === '') return undefined
    const v = parseFloat(s.trim())
    return isNaN(v) ? undefined : v
  }

  const handleImport = () => {
    const lines = importText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length === 0) { setImportMsg({ kind: 'err', text: '입력 데이터가 없습니다.' }); return }
    const parseLine = (l: string) => l.includes('\t') ? l.split('\t') : l.split(',')
    // 헤더 감지: 첫 행 2번째 셀이 숫자가 아니면 헤더로 보고 스킵
    let dataLines = lines
    const first = parseLine(lines[0])
    if (first.length > 1 && isNaN(parseFloat(first[1]))) dataLines = lines.slice(1)

    const recs: ExperimentRecord[] = []
    dataLines.forEach((line, idx) => {
      const c = parseLine(line).map(x => x.trim())
      if (c.length < 11) return
      const lot = c[0] || `가져오기-${idx + 1}`
      const npmi = num(c[1], DEFAULT_FORM.npmi)
      const gAbs = num(c[2], DEFAULT_FORM.gAbs)
      const anContent = num(c[3], DEFAULT_FORM.anContent)
      const injTemp = num(c[4], DEFAULT_FORM.injTemp)
      const talc = num(c[5], DEFAULT_FORM.talc)
      const glassFiber = num(c[6], DEFAULT_FORM.glassFiber)
      const pc = num(c[7], DEFAULT_FORM.pc)
      const phosphorusFr = num(c[8], DEFAULT_FORM.phosphorusFr)
      const carbonFiber = num(c[9], DEFAULT_FORM.carbonFiber)
      const nanoclay = num(c[10], DEFAULT_FORM.nanoclay)
      // 17열 이상(전체 export): 예측 11~13 스킵, 실측 14,15,16
      // 그 외(14열): 실측 11,12,13
      const measHdt = c.length >= 17 ? optNum(c[14]) : optNum(c[11])
      const measIzod = c.length >= 17 ? optNum(c[15]) : optNum(c[12])
      const measVoc = c.length >= 17 ? optNum(c[16]) : optNum(c[13])
      const formulation: Formulation = {
        ...DEFAULT_FORM, npmi, gAbs, anContent, injTemp, talc, glassFiber, pc, phosphorusFr, carbonFiber, nanoclay,
      }
      const prediction = predictColdStart(formulation)
      const actual = (measHdt != null || measIzod != null || measVoc != null)
        ? { hdt: measHdt, izod: measIzod, voc: measVoc }
        : undefined
      recs.push({
        id: Date.now() + idx,
        lot,
        formulation,
        prediction,
        actual,
        date: new Date().toLocaleDateString('ko-KR'),
        note: 'CSV 가져오기',
      })
    })

    if (recs.length === 0) {
      setImportMsg({ kind: 'err', text: '유효한 행을 찾지 못했습니다. 형식을 확인하세요.' })
      return
    }
    onBulkAdd(recs)
    setImportMsg({ kind: 'ok', text: `${recs.length}건 가져옴 — M5 캘리브레이션에서 사용 가능` })
    setImportText('')
    setImportOpen(false)
  }

  const ImportPanel = importOpen ? (
    <div className="mb-3 border rounded p-3 bg-gray-50 space-y-2">
      <p className="text-xs text-gray-600 font-medium">📋 일괄 가져오기 (Excel 탭/CSV 붙여넣기)</p>
      <p className="text-[10px] text-gray-400 leading-relaxed">
        14열 형식: LOT, N-PMI, g-ABS, AN, 사출온도, 탈크, GF, PC, 인계FR, CF, 나노클레이, 실측HDT, 실측Izod, 실측VOC<br />
        (M4 내보내기 17열 형식도 자동 인식 · 헤더 행 자동 스킵 · 예측값은 재계산됨)
      </p>
      <textarea
        value={importText} onChange={e => setImportText(e.target.value)}
        rows={6} placeholder="LOT-1	17	28	28	250	0	0	0	0	0	0	118	14	45"
        className="w-full text-xs font-mono border rounded p-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
      <div className="flex gap-2">
        <Button size="sm" onClick={handleImport} disabled={!importText.trim()}>가져오기 실행</Button>
        <Button size="sm" variant="outline" onClick={() => { setImportOpen(false); setImportMsg(null) }}>취소</Button>
      </div>
    </div>
  ) : null

  if (records.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-end">
            <button
              className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
              onClick={() => setImportOpen(o => !o)}>
              📋 일괄 가져오기
            </button>
          </div>
        </CardHeader>
        <CardContent className="text-center text-gray-400 text-sm">
          {importMsg && (
            <p className={`mb-3 text-xs ${importMsg.kind === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{importMsg.text}</p>
          )}
          {ImportPanel}
          <p className="py-8">아직 저장된 배합이 없습니다. [물성 예측] 탭에서 트래커 저장하거나 일괄 가져오기 하세요.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">M4 — 실험 트래커 ({records.length}건)</CardTitle>
          <div className="flex gap-2">
          <button
            className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
            onClick={() => setImportOpen(o => !o)}>
            📋 일괄 가져오기
          </button>
          <button
            className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
            onClick={() => {
              const headers = 'LOT,N-PMI,g-ABS,AN함량,사출온도,탈크,GF,PC,인계FR,CF,나노클레이,예측HDT,예측Izod,예측VOC,실측HDT,실측Izod,실측VOC,날짜'
              const rows = records.map(r => [
                r.lot,
                r.formulation.npmi, r.formulation.gAbs, r.formulation.anContent, r.formulation.injTemp,
                r.formulation.talc, r.formulation.glassFiber, r.formulation.pc, r.formulation.phosphorusFr,
                r.formulation.carbonFiber, r.formulation.nanoclay,
                r.prediction.hdt.value.toFixed(1), r.prediction.izod.value.toFixed(1), r.prediction.voc.value.toFixed(0),
                r.actual?.hdt?.toFixed(1) ?? '', r.actual?.izod?.toFixed(1) ?? '', r.actual?.voc?.toFixed(0) ?? '',
                r.date,
              ].join(','))
              const csv = [headers, ...rows].join('\n')
              const a = document.createElement('a')
              a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
              a.download = 'M4_tracker.csv'; a.click()
            }}>
            📥 CSV 내보내기
          </button>
          </div>
        </div>
        <p className="text-xs text-gray-500">실측 결과 입력 → 예측-실측 비교 자동 기록</p>
      </CardHeader>
      <CardContent>
        {importMsg && (
          <p className={`mb-2 text-xs ${importMsg.kind === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{importMsg.text}</p>
        )}
        {ImportPanel}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {['LOT','날짜','N-PMI','g-ABS','HDT 예측','HDT 실측','Izod 예측','Izod 실측','VOC 예측','VOC 실측','Spec','메모',''].map(h => (
                  <TableHead key={h} className="text-xs">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs font-medium">{r.lot}</TableCell>
                  <TableCell className="text-xs text-gray-500">{r.date}</TableCell>
                  <TableCell className="text-xs">{r.formulation.npmi}%</TableCell>
                  <TableCell className="text-xs">{r.formulation.gAbs}%</TableCell>
                  <TableCell className="text-xs font-mono">{r.prediction.hdt.value.toFixed(1)}℃</TableCell>
                  <TableCell className="text-xs font-mono">
                    {editId === r.id
                      ? <Input type="number" className="h-6 w-16 text-xs" value={editActual?.hdt ?? ''}
                          onChange={e => setEditActual(a => ({ ...a, hdt: +e.target.value }))} />
                      : r.actual?.hdt != null
                        ? <span className={Math.abs(r.actual.hdt - r.prediction.hdt.value) > 5 ? 'text-orange-600 font-medium' : ''}>{r.actual.hdt.toFixed(1)}℃</span>
                        : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{r.prediction.izod.value.toFixed(1)}</TableCell>
                  <TableCell className="text-xs font-mono">
                    {editId === r.id
                      ? <Input type="number" className="h-6 w-16 text-xs" value={editActual?.izod ?? ''}
                          onChange={e => setEditActual(a => ({ ...a, izod: +e.target.value }))} />
                      : r.actual?.izod != null ? r.actual.izod.toFixed(1) : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{r.prediction.voc.value.toFixed(0)}</TableCell>
                  <TableCell className="text-xs font-mono">
                    {editId === r.id
                      ? <Input type="number" className="h-6 w-16 text-xs" value={editActual?.voc ?? ''}
                          onChange={e => setEditActual(a => ({ ...a, voc: +e.target.value }))} />
                      : r.actual?.voc != null ? r.actual.voc.toFixed(0) : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <SpecLight pass={r.prediction.specPass.hdt} />
                      <SpecLight pass={r.prediction.specPass.izod} />
                      <SpecLight pass={r.prediction.specPass.voc} />
                    </div>
                  </TableCell>
                  <TableCell className="text-xs max-w-[120px]">
                    {editId === r.id
                      ? <Input className="h-6 text-xs" value={editNote} onChange={e => setEditNote(e.target.value)} />
                      : <span className="text-gray-500 truncate block">{r.note || '—'}</span>}
                  </TableCell>
                  <TableCell>
                    {editId === r.id
                      ? <Button size="sm" className="h-6 text-xs px-2" onClick={() => { onUpdateRecord(r.id, editActual, editNote); setEditId(null) }}>저장</Button>
                      : <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { setEditId(r.id); setEditActual(r.actual ?? {}); setEditNote(r.note) }}>입력</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {records.some(r => r.actual?.hdt != null) && (() => {
          const pairs = records.filter(r => r.actual?.hdt != null)
          const err = pairs.reduce((s, r) => s + Math.abs(r.actual!.hdt! - r.prediction.hdt.value), 0) / pairs.length
          return (
            <div className="mt-3 p-3 bg-gray-50 rounded text-xs text-gray-600">
              HDT 평균 절대오차: <strong>{err.toFixed(1)}℃</strong> (N={pairs.length})
            </div>
          )
        })()}
      </CardContent>
    </Card>
  )
}

// ──────────────────────────────────────────────
// M5: 실험 캘리브레이션
// ──────────────────────────────────────────────
function NInput({ label, value, unit, min, max, step, onChange }: {
  label: string; value: number; unit: string; min: number; max: number; step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] text-gray-500 font-medium">{label}</label>
      <div className="flex items-center gap-1">
        <input type="number" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-16 h-7 text-xs font-mono border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <span className="text-[10px] text-gray-400">{unit}</span>
      </div>
    </div>
  )
}

function CalibStatRow({ label, unit, c }: {
  label: string; unit: string
  c: { scale: number; offset: number; r2: number; rmse: number; n: number }
}) {
  if (c.n < 2) return (
    <div className="p-2 bg-gray-50 rounded text-xs text-gray-400">
      {label}: 데이터 {c.n}건 (최소 2건 필요)
    </div>
  )
  const r2Color = c.r2 >= 0.8 ? '#15803d' : c.r2 >= 0.6 ? '#d97706' : '#dc2626'
  return (
    <div className="p-2 bg-white border rounded text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-700">{label}</span>
        <span className="font-bold font-mono text-sm" style={{ color: r2Color }}>
          R²={c.r2.toFixed(3)}
        </span>
      </div>
      <div className="font-mono text-gray-600 text-[11px]">
        y = {c.scale.toFixed(4)}x {c.offset >= 0 ? '+' : '−'} {Math.abs(c.offset).toFixed(2)}
      </div>
      <div className="flex gap-3 text-[10px] text-gray-400">
        <span>RMSE: {c.rmse.toFixed(2)} {unit}</span>
        <span>N={c.n}</span>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// 다음 실험 추천 (Active-learning lite, Feature C)
// 거리 기반 휴리스틱: 기존 측정점에서 가장 먼 후보를 추천
// ──────────────────────────────────────────────
function ExperimentRecommender({ records, onLoad }: {
  records: ExperimentRecord[]
  onLoad: (f: Formulation) => void
}) {
  // 후보 풀: DEFAULT_FORM 기준 격자 섭동 (현재 form은 PredictorTab 내부에만 있어 DEFAULT_FORM 사용)
  const base = DEFAULT_FORM
  const candidates: Formulation[] = []
  for (const npmi of [12, 16, 20, 24]) {
    for (const gAbs of [24, 30, 36]) {
      for (const talc of [0, 8]) {
        for (const pc of [0, 10]) {
          if (npmi + gAbs + talc + pc > 95) continue
          candidates.push({ ...base, npmi, gAbs, talc, pc })
          if (candidates.length >= 24) break
        }
        if (candidates.length >= 24) break
      }
      if (candidates.length >= 24) break
    }
    if (candidates.length >= 24) break
  }

  const scored = candidates.map(f => ({ f, pred: predictColdStart(f) }))

  // 측정점: actual.hdt 존재
  const measured = records
    .filter(r => r.actual?.hdt != null)
    .map(r => ({
      hdt: r.actual!.hdt!,
      izod: r.actual?.izod ?? r.prediction.izod.value,
    }))

  type Rec = { f: Formulation; pred: PredictionResult; reason: string }
  let top3: Rec[]
  let cornerMode = false

  if (measured.length === 0) {
    cornerMode = true
    // 코너 우선: 최저HDT, 최고HDT, 최고Izod
    const byHdtAsc = [...scored].sort((a, b) => a.pred.hdt.value - b.pred.hdt.value)
    const byHdtDesc = [...scored].sort((a, b) => b.pred.hdt.value - a.pred.hdt.value)
    const byIzodDesc = [...scored].sort((a, b) => b.pred.izod.value - a.pred.izod.value)
    const picked: typeof scored = []
    for (const c of [byHdtAsc[0], byHdtDesc[0], byIzodDesc[0]]) {
      if (c && !picked.includes(c)) picked.push(c)
    }
    top3 = picked.slice(0, 3).map(c => ({ f: c.f, pred: c.pred, reason: '초기 데이터 확보: 설계공간 코너 우선' }))
  } else {
    const minDist = (p: PredictionResult) => Math.min(...measured.map(m =>
      Math.sqrt(((p.hdt.value - m.hdt) / 40) ** 2 + ((p.izod.value - m.izod) / 20) ** 2)
    ))
    top3 = [...scored]
      .map(c => ({ ...c, d: minDist(c.pred) }))
      .sort((a, b) => b.d - a.d)
      .slice(0, 3)
      .map(c => ({ f: c.f, pred: c.pred, reason: '기존 측정점에서 가장 멀어 모델 불확실성을 크게 줄임' }))
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">다음 실험 추천 <span className="text-[10px] font-normal text-gray-400">(거리 기반 휴리스틱)</span></CardTitle>
      </CardHeader>
      <CardContent className="pb-3 space-y-2">
        <p className="text-[11px] text-gray-500">
          {cornerMode
            ? '측정 데이터가 없어 설계공간 코너를 우선 추천합니다.'
            : `측정점 ${measured.length}개 기준, 미탐색 영역을 채우는 배합을 추천합니다.`}
        </p>
        {top3.map((rec, i) => (
          <div key={i} className="border rounded p-2 text-xs space-y-1 bg-gray-50">
            <div className="flex items-center justify-between">
              <span className="font-mono text-gray-700">
                N-PMI {rec.f.npmi} · g-ABS {rec.f.gAbs} · 탈크 {rec.f.talc} · PC {rec.f.pc}
              </span>
              <Button size="sm" className="h-6 text-xs px-2" onClick={() => onLoad(rec.f)}>이 배합 로드</Button>
            </div>
            <div className="font-mono text-gray-500">
              예측 HDT {rec.pred.hdt.value.toFixed(1)}℃ · Izod {rec.pred.izod.value.toFixed(1)} kJ/m²
            </div>
            <p className="text-[10px] text-gray-400">{rec.reason}</p>
          </div>
        ))}
        <p className="text-[10px] text-gray-300">※ 완전한 베이지안 능동학습이 아닌 측정점 거리 기반 spread 휴리스틱입니다.</p>
      </CardContent>
    </Card>
  )
}

function M5CalibrationTab({
  calibPoints, calibResult, records,
  onAdd, onRemove, onFit, onToggle, onLoad,
}: {
  calibPoints: CalibPoint[]
  calibResult: CalibResult | null
  records: ExperimentRecord[]
  onAdd: (p: CalibPoint) => void
  onRemove: (id: number) => void
  onFit: () => void
  onToggle: () => void
  onLoad: (f: Formulation) => void
}) {
  const [lot, setLot] = useState('')
  const [npmi, setNpmi] = useState(17)
  const [gAbs, setGAbs] = useState(28)
  const [anContent, setAnContent] = useState(28)
  const [injTemp, setInjTemp] = useState(250)
  const [talc, setTalc] = useState(0)
  const [glassFiber, setGlassFiber] = useState(0)
  const [pc, setPc] = useState(0)
  const [phosphorusFr, setPhosphorusFr] = useState(0)
  const [carbonFiber, setCarbonFiber] = useState(0)
  const [nanoclay, setNanoclay] = useState(0)
  const [mHdt, setMHdt] = useState('')
  const [mIzod, setMIzod] = useState('')
  const [mVoc, setMVoc] = useState('')
  const [mTensile, setMTensile] = useState('')
  const [mMfi, setMMfi] = useState('')
  const [mVicat, setMVicat] = useState('')

  const addDisabled = mHdt === '' && mIzod === '' && mVoc === ''
    && mTensile === '' && mMfi === '' && mVicat === ''

  const handleAdd = () => {
    const san = Math.max(0, 100 - npmi - gAbs - 2.5 - pc - nanoclay - talc - glassFiber - carbonFiber - phosphorusFr)
    const f: Formulation = {
      npmi, gAbs, anContent, san, cbMB: 2.5, antioxidant: 0.5, lubricant: 1.0,
      injTemp, moldTemp: 70,
      pc, alphaMsan: 0, nanoclay,
      ema: 0, uhmwSr: 0, mbs: 0, sebs: 0, acrylicIm: 0,
      phosphorusFr, ptfe: 0,
      talc, glassFiber, carbonFiber,
      silane: 0, wax: 0, hals: 0, heatStabilizer: 0, metalDeact: 0, antistatic: 0,
    }
    const raw = predictColdStart(f)
    const p: CalibPoint = {
      id: Date.now(),
      lot: lot || `CAL-${calibPoints.length + 1}`,
      npmi, gAbs, anContent, injTemp, talc, glassFiber, pc, phosphorusFr, carbonFiber, nanoclay,
      segment: raw.segment,
      predictedHdt:  raw.hdt.value,
      predictedIzod: raw.izod.value,
      predictedVoc:  raw.voc.value,
      predictedTensile: raw.tensile.value,
      predictedMfi:     raw.mfi.value,
      predictedVicat:   raw.vicat.value,
      measuredHdt:   mHdt  !== '' ? Number(mHdt)  : undefined,
      measuredIzod:  mIzod !== '' ? Number(mIzod) : undefined,
      measuredVoc:   mVoc  !== '' ? Number(mVoc)  : undefined,
      measuredTensile: mTensile !== '' ? Number(mTensile) : undefined,
      measuredMfi:     mMfi     !== '' ? Number(mMfi)     : undefined,
      measuredVicat:   mVicat   !== '' ? Number(mVicat)   : undefined,
    }
    onAdd(p)
    setLot(''); setMHdt(''); setMIzod(''); setMVoc('')
    setMTensile(''); setMMfi(''); setMVicat('')
  }

  const importables = records.filter(r =>
    r.actual?.hdt != null || r.actual?.izod != null || r.actual?.voc != null
  )
  const importedLots = new Set(calibPoints.map(p => p.lot))

  const handleImport = (r: ExperimentRecord) => {
    const p: CalibPoint = {
      id: Date.now(),
      lot: r.lot,
      npmi:         r.formulation.npmi,
      gAbs:         r.formulation.gAbs,
      anContent:    r.formulation.anContent,
      injTemp:      r.formulation.injTemp,
      talc:         r.formulation.talc,
      glassFiber:   r.formulation.glassFiber,
      pc:           r.formulation.pc,
      phosphorusFr: r.formulation.phosphorusFr,
      carbonFiber:  r.formulation.carbonFiber,
      nanoclay:     r.formulation.nanoclay,
      segment:      r.prediction.segment,
      predictedHdt:  r.prediction.hdt.value,
      predictedIzod: r.prediction.izod.value,
      predictedVoc:  r.prediction.voc.value,
      predictedTensile: r.prediction.tensile.value,
      predictedMfi:     r.prediction.mfi.value,
      predictedVicat:   r.prediction.vicat.value,
      measuredHdt:  r.actual?.hdt,
      measuredIzod: r.actual?.izod,
      measuredVoc:  r.actual?.voc,
      measuredMfi:  r.actual?.mfi,
    }
    onAdd(p)
  }

  const canFit = calibPoints.some(
    p => p.measuredHdt != null || p.measuredIzod != null || p.measuredVoc != null
      || p.measuredTensile != null || p.measuredMfi != null || p.measuredVicat != null
  )
  const active = calibResult?.active === true

  const delta = (pred: number, meas: number | undefined, thresh: number) => {
    if (meas == null) return <span className="text-gray-300">—</span>
    const d = meas - pred
    const color = Math.abs(d) > thresh ? 'text-red-500' : 'text-green-600'
    return <span className={`${color} font-mono`}>{d >= 0 ? '+' : ''}{d.toFixed(1)}</span>
  }

  return (
    <div className="grid grid-cols-[1fr_300px] gap-4">
      {/* 왼쪽 */}
      <div className="space-y-4">
        {/* 트래커 가져오기 */}
        {importables.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">트래커(M4) 기록 가져오기</CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <p className="text-xs text-gray-500 mb-2">
                실측값이 입력된 트래커 기록 {importables.length}건을 캘리브레이션 포인트로 바로 사용합니다.
              </p>
              <div className="space-y-1.5">
                {importables.map(r => (
                  <div key={r.id} className="flex items-center gap-2 text-xs">
                    <span className="font-mono w-20 text-gray-700 truncate">{r.lot}</span>
                    {r.actual?.hdt  != null && <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono">HDT {r.actual.hdt}℃</span>}
                    {r.actual?.izod != null && <span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-mono">Izod {r.actual.izod}</span>}
                    {r.actual?.voc  != null && <span className="bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded font-mono">VOC {r.actual.voc}</span>}
                    <Button size="sm" variant="outline" className="h-6 text-xs px-2 ml-auto"
                      disabled={importedLots.has(r.lot)}
                      onClick={() => handleImport(r)}>
                      {importedLots.has(r.lot) ? '✓ 추가됨' : '가져오기'}
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 수동 입력 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">실험 포인트 입력</CardTitle>
          </CardHeader>
          <CardContent className="pb-3 space-y-3">
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] text-gray-500 font-medium">LOT 번호</label>
              <input type="text" value={lot} onChange={e => setLot(e.target.value)}
                placeholder="EXP-001"
                className="h-7 text-xs border rounded px-2 w-40 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>

            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">── 배합 조건</p>
            <div className="grid grid-cols-4 gap-2">
              <NInput label="N-PMI" value={npmi} unit="wt%" min={10} max={25} step={0.5} onChange={setNpmi} />
              <NInput label="g-ABS" value={gAbs} unit="wt%" min={20} max={40} step={0.5} onChange={setGAbs} />
              <NInput label="AN 함량" value={anContent} unit="%" min={24} max={32} step={0.5} onChange={setAnContent} />
              <NInput label="사출온도" value={injTemp} unit="℃" min={240} max={280} step={1} onChange={setInjTemp} />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <NInput label="탈크" value={talc} unit="wt%" min={0} max={15} step={1} onChange={setTalc} />
              <NInput label="GF" value={glassFiber} unit="wt%" min={0} max={30} step={5} onChange={setGlassFiber} />
              <NInput label="PC 블렌드" value={pc} unit="wt%" min={0} max={40} step={2} onChange={setPc} />
              <NInput label="인계 FR" value={phosphorusFr} unit="wt%" min={0} max={25} step={1} onChange={setPhosphorusFr} />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <NInput label="CF" value={carbonFiber} unit="wt%" min={0} max={20} step={5} onChange={setCarbonFiber} />
              <NInput label="나노클레이" value={nanoclay} unit="wt%" min={0} max={8} step={0.5} onChange={setNanoclay} />
            </div>

            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">── 실측값 (하나 이상 필수)</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] text-gray-500 font-medium">HDT 실측</label>
                <div className="flex items-center gap-1">
                  <input type="number" value={mHdt} placeholder="—"
                    onChange={e => setMHdt(e.target.value)}
                    className="w-16 h-7 text-xs font-mono border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <span className="text-[10px] text-gray-400">℃</span>
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] text-gray-500 font-medium">Izod 실측</label>
                <div className="flex items-center gap-1">
                  <input type="number" value={mIzod} placeholder="—"
                    onChange={e => setMIzod(e.target.value)}
                    className="w-16 h-7 text-xs font-mono border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <span className="text-[10px] text-gray-400">kJ/m²</span>
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] text-gray-500 font-medium">VOC 실측</label>
                <div className="flex items-center gap-1">
                  <input type="number" value={mVoc} placeholder="—"
                    onChange={e => setMVoc(e.target.value)}
                    className="w-16 h-7 text-xs font-mono border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <span className="text-[10px] text-gray-400">µg/g</span>
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] text-gray-500 font-medium">인장 실측</label>
                <div className="flex items-center gap-1">
                  <input type="number" value={mTensile} placeholder="—"
                    onChange={e => setMTensile(e.target.value)}
                    className="w-16 h-7 text-xs font-mono border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <span className="text-[10px] text-gray-400">MPa</span>
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] text-gray-500 font-medium">MFI 실측</label>
                <div className="flex items-center gap-1">
                  <input type="number" value={mMfi} placeholder="—"
                    onChange={e => setMMfi(e.target.value)}
                    className="w-16 h-7 text-xs font-mono border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <span className="text-[10px] text-gray-400">g/10min</span>
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] text-gray-500 font-medium">Vicat 실측</label>
                <div className="flex items-center gap-1">
                  <input type="number" value={mVicat} placeholder="—"
                    onChange={e => setMVicat(e.target.value)}
                    className="w-16 h-7 text-xs font-mono border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <span className="text-[10px] text-gray-400">℃</span>
                </div>
              </div>
            </div>

            <Button size="sm" onClick={handleAdd} disabled={addDisabled}>
              데이터 추가
            </Button>
          </CardContent>
        </Card>

        {/* 캘리브레이션 데이터 테이블 */}
        {calibPoints.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">캘리브레이션 데이터 ({calibPoints.length}건)</CardTitle>
                <Button size="sm" onClick={onFit} disabled={!canFit}>
                  캘리브레이션 실행
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">LOT</TableHead>
                      <TableHead className="text-xs text-right">예HDT</TableHead>
                      <TableHead className="text-xs text-right">실HDT</TableHead>
                      <TableHead className="text-xs text-right text-blue-600">Δ</TableHead>
                      <TableHead className="text-xs text-right">예Izod</TableHead>
                      <TableHead className="text-xs text-right">실Izod</TableHead>
                      <TableHead className="text-xs text-right text-blue-600">Δ</TableHead>
                      <TableHead className="text-xs text-right">예VOC</TableHead>
                      <TableHead className="text-xs text-right">실VOC</TableHead>
                      <TableHead className="text-xs text-right text-blue-600">Δ</TableHead>
                      <TableHead className="text-xs text-right">예인장</TableHead>
                      <TableHead className="text-xs text-right text-blue-600">Δ인장</TableHead>
                      <TableHead className="text-xs text-right">예MFI</TableHead>
                      <TableHead className="text-xs text-right text-blue-600">ΔMFI</TableHead>
                      <TableHead className="text-xs text-right">예Vicat</TableHead>
                      <TableHead className="text-xs text-right text-blue-600">ΔVicat</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calibPoints.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs max-w-[80px] truncate">{p.lot}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{p.predictedHdt.toFixed(1)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{p.measuredHdt?.toFixed(1) ?? '—'}</TableCell>
                        <TableCell className="text-xs text-right">{delta(p.predictedHdt, p.measuredHdt, 5)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{p.predictedIzod.toFixed(1)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{p.measuredIzod?.toFixed(1) ?? '—'}</TableCell>
                        <TableCell className="text-xs text-right">{delta(p.predictedIzod, p.measuredIzod, 3)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{p.predictedVoc.toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{p.measuredVoc?.toFixed(0) ?? '—'}</TableCell>
                        <TableCell className="text-xs text-right">{delta(p.predictedVoc, p.measuredVoc, 10)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{p.predictedTensile.toFixed(1)}</TableCell>
                        <TableCell className="text-xs text-right">{delta(p.predictedTensile, p.measuredTensile, 4)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{p.predictedMfi.toFixed(1)}</TableCell>
                        <TableCell className="text-xs text-right">{delta(p.predictedMfi, p.measuredMfi, 3)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{p.predictedVicat.toFixed(1)}</TableCell>
                        <TableCell className="text-xs text-right">{delta(p.predictedVicat, p.measuredVicat, 5)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-gray-300 hover:text-red-500"
                            onClick={() => onRemove(p.id)}>×</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-[10px] text-gray-400 mt-2">
                Δ 열: 실측 − 예측. 초록=±범위 내, 빨강=이상치 주의.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 오른쪽: 결과 패널 */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">캘리브레이션 결과</CardTitle>
          </CardHeader>
          <CardContent className="pb-3 space-y-3">
            {calibResult == null ? (
              <div className="text-xs text-gray-400 text-center py-6 space-y-1">
                <p className="text-2xl">📊</p>
                <p>데이터를 추가하고<br/>"캘리브레이션 실행"을 누르세요</p>
                <p className="text-[10px]">최소 2건 · 권장 3~5건</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between p-2 rounded"
                  style={{ background: active ? '#dcfce7' : '#f8fafc', border: `1px solid ${active ? '#86efac' : '#e2e8f0'}` }}>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: active ? '#15803d' : '#64748b' }}>
                      {active ? '● 보정 적용 중' : '○ 비활성'}
                    </p>
                    <p className="text-[10px]" style={{ color: active ? '#166534' : '#94a3b8' }}>
                      {active ? 'M1·M2 예측에 보정 적용됨' : '토글로 활성화'}
                    </p>
                  </div>
                  <Button size="sm" variant={active ? 'default' : 'outline'}
                    className="h-7 text-xs px-3"
                    onClick={onToggle}>
                    {active ? 'ON' : 'OFF'}
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded font-semibold"
                    style={calibResult.mode === 'segment'
                      ? { background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd' }
                      : { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }}>
                    {calibResult.mode === 'segment' ? '세그먼트별 보정' : '전역 보정'}
                  </span>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">── 전역 회귀 계수</p>
                  {calibResult.hdt.n  >= 2 && <CalibStatRow label="HDT"  unit="℃"      c={calibResult.hdt}  />}
                  {calibResult.izod.n >= 2 && <CalibStatRow label="Izod" unit="kJ/m²"  c={calibResult.izod} />}
                  {calibResult.voc.n  >= 2 && <CalibStatRow label="VOC"  unit="µg/g"   c={calibResult.voc}  />}
                  {calibResult.tensile.n >= 2 && <CalibStatRow label="인장" unit="MPa"     c={calibResult.tensile} />}
                  {calibResult.mfi.n     >= 2 && <CalibStatRow label="MFI"  unit="g/10min" c={calibResult.mfi}     />}
                  {calibResult.vicat.n   >= 2 && <CalibStatRow label="Vicat" unit="℃"      c={calibResult.vicat}   />}
                </div>

                {calibResult.mode === 'segment' && (
                  <div className="space-y-2">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">── 세그먼트별 보정</p>
                    {Object.entries(calibResult.bySegment).map(([seg, fit]) => {
                      const maxN = Math.max(fit.hdt.n, fit.izod.n, fit.voc.n, fit.tensile.n, fit.mfi.n, fit.vicat.n)
                      return (
                        <div key={seg} className="p-2 rounded border bg-violet-50/40 space-y-1.5">
                          <p className="text-[11px] font-semibold text-violet-700">[{seg}] {maxN}개</p>
                          {fit.hdt.n  >= 2 && <CalibStatRow label="HDT"  unit="℃"     c={fit.hdt}  />}
                          {fit.izod.n >= 2 && <CalibStatRow label="Izod" unit="kJ/m²" c={fit.izod} />}
                          {fit.voc.n  >= 2 && <CalibStatRow label="VOC"  unit="µg/g"  c={fit.voc}  />}
                          {fit.tensile.n >= 2 && <CalibStatRow label="인장" unit="MPa"     c={fit.tensile} />}
                          {fit.mfi.n     >= 2 && <CalibStatRow label="MFI"  unit="g/10min" c={fit.mfi}     />}
                          {fit.vicat.n   >= 2 && <CalibStatRow label="Vicat" unit="℃"      c={fit.vicat}   />}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="text-[10px] text-gray-400 pt-1 space-y-0.5 border-t">
                  <p>보정식: y_보정 = scale × y_예측 + offset</p>
                  <p>R² ≥ 0.8 양호 · 0.6~0.8 보통 · &lt; 0.6 데이터 추가</p>
                  <p>데이터가 적은 물성·세그먼트는 전역 보정으로 대체됩니다. 보정 범위 밖 예측은 불확실성이 자동 확대됩니다.</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">사용 가이드</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-gray-600 space-y-1.5 pb-3">
            <p><strong>1단계</strong> 배합·실측값 입력 (또는 트래커 가져오기)</p>
            <p><strong>2단계</strong> "캘리브레이션 실행" 클릭</p>
            <p><strong>3단계</strong> R² 확인 → 0.8+ 권장</p>
            <p><strong>4단계</strong> ON 토글 → M1·M2 예측에 자동 반영</p>
            <hr className="my-1"/>
            <p className="text-gray-400">보정은 선형 최소제곱법 (y=ax+b). Cold-start 모델의 계통 오차를 실험 데이터로 보정합니다.</p>
          </CardContent>
        </Card>

        <ExperimentRecommender records={records} onLoad={onLoad} />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// M7: 배합 비교 테이블
// ──────────────────────────────────────────────
function CompareTab({ onLoad }: { onLoad: (f: Formulation) => void }) {
  const [presets, setPresets] = useState<Record<string, Formulation>>(() => {
    try { return JSON.parse(localStorage.getItem('abs_saved_presets') ?? '{}') } catch { return {} }
  })

  const reload = () => {
    try { setPresets(JSON.parse(localStorage.getItem('abs_saved_presets') ?? '{}')) } catch { /* ignore */ }
  }

  const names = Object.keys(presets).slice(0, 6)

  if (names.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-400 text-sm space-y-2">
          <p>저장된 배합이 없습니다</p>
          <p className="text-xs">(M1 예측 탭에서 배합 저장)</p>
          <Button size="sm" variant="outline" onClick={reload}>새로고침</Button>
        </CardContent>
      </Card>
    )
  }

  const predictions = names.map(n => predictColdStart(presets[n]))

  const hdtColor = (v: number) => v >= 115 ? 'text-green-600 font-bold' : v >= 110 ? 'text-yellow-600 font-bold' : 'text-red-600 font-bold'
  const izodColor = (v: number) => v >= 15 ? 'text-green-600 font-bold' : v >= 10 ? 'text-yellow-600 font-bold' : 'text-red-600 font-bold'
  const vocColor = (v: number) => v <= 50 ? 'text-green-600 font-bold' : v <= 70 ? 'text-yellow-600 font-bold' : 'text-red-600 font-bold'

  type Row = { label: string; get: (p: PredictionResult) => string; color?: (p: PredictionResult) => string }
  const rows: Row[] = [
    { label: 'HDT(1.8)',  get: p => p.hdt.value.toFixed(1) + '℃',     color: p => hdtColor(p.hdt.value) },
    { label: 'HDT(0.45)', get: p => p.hdt045.value.toFixed(1) + '℃',  color: p => hdtColor(p.hdt045.value) },
    { label: 'Vicat',     get: p => p.vicat.value.toFixed(1) + '℃' },
    { label: 'Izod',      get: p => p.izod.value.toFixed(1) + ' kJ',   color: p => izodColor(p.izod.value) },
    { label: '인장강도',  get: p => p.tensile.value.toFixed(1) + ' MPa' },
    { label: '비중',      get: p => p.density.value.toFixed(3) },
    { label: 'MFI(220/10)', get: p => p.mfi.value.toFixed(1) + ' g/10min' },
    { label: 'TVOC',      get: p => p.voc.value.toFixed(0) + ' µg/g',  color: p => vocColor(p.voc.value) },
    { label: 'UL-94',     get: p => p.ul94 },
    { label: '세그먼트',  get: p => p.segment },
    { label: '원가',      get: p => p.cost.value.toFixed(0) + ' ₩/kg' },
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">M7 — 배합 비교</CardTitle>
          <Button size="sm" variant="outline" onClick={reload}>새로고침</Button>
        </div>
        <p className="text-xs text-gray-500">저장된 프리셋 최대 6개 비교 (M1에서 배합 저장 필요)</p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2 font-medium text-gray-500 min-w-[90px]">물성</th>
                {names.map(n => (
                  <th key={n} className="text-left px-3 py-2 font-medium text-gray-700 min-w-[120px] border-l border-gray-100">{n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.label} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-1.5 text-gray-500 font-medium">{row.label}</td>
                  {predictions.map((p, j) => (
                    <td key={j} className={`px-3 py-1.5 font-mono border-l border-gray-100 ${row.color ? row.color(p) : 'text-gray-700'}`}>
                      {row.get(p)}
                    </td>
                  ))}
                </tr>
              ))}
              {/* Load row */}
              <tr className="border-t">
                <td className="px-3 py-2 text-gray-400 text-[11px]">로드</td>
                {names.map((n, j) => (
                  <td key={j} className="px-3 py-2 border-l border-gray-100">
                    <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                      onClick={() => onLoad(presets[n])}>
                      이 배합 로드
                    </Button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

// ──────────────────────────────────────────────
// 원료 단가 편집 모달 (Feature A)
// ──────────────────────────────────────────────
const UNIT_COST_LABELS: Record<keyof UnitCosts, string> = {
  npmi: 'N-PMI', gAbs: 'g-ABS', ao: '산화방지제', lub: '활제', ema: 'EMA', uhmwSr: 'UHMW-SR',
  pFr: '인계FR', talc: '탈크', gf: 'GF', pc: 'PC', alphaMsan: 'αMSAN', nanoclay: '나노클레이',
  mbs: 'MBS', sebs: 'SEBS', acrylicIm: '아크릴IM', ptfe: 'PTFE', cf: 'CF',
  silane: '실란', wax: '왁스', hals: 'HALS', hs: '열안정제', md: '금속불활성화제', as: '대전방지제',
  base: '기본단가',
}

function UnitCostsModal({ costs, onChange, onClose }: {
  costs: UnitCosts
  onChange: (c: UnitCosts) => void
  onClose: () => void
}) {
  const keys = Object.keys(UNIT_COST_LABELS) as (keyof UnitCosts)[]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-auto p-5"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold">원료 단가 설정 <span className="text-xs font-normal text-gray-400">(₩/kg)</span></h2>
          <button className="text-gray-400 hover:text-gray-700 text-xl leading-none" onClick={onClose}>×</button>
        </div>
        <p className="text-xs text-gray-500 mb-3">단가를 수정하면 원가 예측·파레토에 즉시 반영됩니다.</p>
        <div className="grid grid-cols-3 gap-3">
          {keys.map(k => (
            <div key={k} className="flex flex-col gap-0.5">
              <label className="text-[11px] text-gray-500 font-medium">{UNIT_COST_LABELS[k]}</label>
              <input type="number" value={costs[k]}
                onChange={e => onChange({ ...costs, [k]: +e.target.value })}
                className="h-7 text-xs font-mono border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <Button size="sm" variant="outline" onClick={() => onChange({ ...DEFAULT_UNIT_COSTS })}>기본값 복원</Button>
          <Button size="sm" onClick={onClose}>닫기</Button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// M8 검증 탭 (Validation & Grounding)
// ──────────────────────────────────────────────
const VAL_PROPS: Array<{ key: string; label: string; unit: string }> = [
  { key: 'hdt',     label: 'HDT',     unit: '℃' },
  { key: 'izod',    label: 'Izod',    unit: 'kJ/m²' },
  { key: 'tensile', label: '인장',     unit: 'MPa' },
  { key: 'mfi',     label: 'MFI',     unit: 'g/10min' },
  { key: 'density', label: '비중',     unit: 'g/cm³' },
  { key: 'vicat',   label: 'Vicat',   unit: '℃' },
]

function mapeColor(p: number): string {
  if (p <= 10) return 'text-green-600'
  if (p <= 20) return 'text-amber-600'
  return 'text-red-600'
}
function cellColor(p: number): string {
  if (p <= 8) return 'bg-green-50 text-green-700'
  if (p <= 18) return 'bg-amber-50 text-amber-700'
  return 'bg-red-50 text-red-700'
}

function ValidationTab({
  litActive, onToggleGrounding,
}: {
  litActive: boolean
  onToggleGrounding: (on: boolean) => void
}) {
  const raw: ValidationSummary = useMemo(
    () => validateModel(predictColdStart, DEFAULT_FORM), [],
  )
  // 문헌 그라운딩 적용 후의 검증 결과 (BEFORE/AFTER 비교용)
  const grounded: ValidationSummary = useMemo(() => {
    const pairs = referenceCalibPairs(predictColdStart, DEFAULT_FORM)
    const litCalib = fitCalibration(pairs)
    return validateModel(f => applyCalibration(predictColdStart(f), litCalib), DEFAULT_FORM)
  }, [])

  const view = litActive ? grounded : raw

  const fmt = (n: number, d = 1) => n.toFixed(d)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            모델 검증 (M8) — 상용 등급 재현도
            <Badge variant="secondary" className="text-[10px]">{REFERENCE_GRADES_COUNT}개 등급</Badge>
          </CardTitle>
          <p className="text-xs text-gray-500 leading-relaxed mt-1">
            기준값은 상용 등급·문헌의 대표 전형값입니다. 실제 lot은 ±편차가 있습니다.
            이 패널은 모델이 알려진 등급을 얼마나 재현하는지 보여줍니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 문헌 기준 보정 토글 */}
          <div className="flex items-center justify-between rounded-lg border p-3 bg-gray-50">
            <div>
              <div className="text-sm font-medium">문헌 기준 보정 (Literature Grounding)</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {REFERENCE_GRADES_COUNT}개 등급의 전형값으로 모델을 세그먼트별 보정합니다.
                적용 시 기존 M5 캘리브레이션은 대체됩니다.
              </div>
            </div>
            <Button
              variant={litActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => onToggleGrounding(!litActive)}>
              {litActive ? '✓ 적용됨 — 해제' : '문헌 기준 보정 적용'}
            </Button>
          </div>

          {/* 전체 MAPE BEFORE/AFTER */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-3 text-center">
              <div className="text-[11px] text-gray-500">보정 전 (raw)</div>
              <div className={`text-2xl font-bold ${mapeColor(raw.overallMapePct)}`}>{fmt(raw.overallMapePct)}%</div>
              <div className="text-[10px] text-gray-400">전체 MAPE</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-[11px] text-gray-500">문헌 보정 후</div>
              <div className={`text-2xl font-bold ${mapeColor(grounded.overallMapePct)}`}>{fmt(grounded.overallMapePct)}%</div>
              <div className="text-[10px] text-gray-400">전체 MAPE</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-[11px] text-gray-500">개선</div>
              <div className="text-2xl font-bold text-blue-600">
                {(raw.overallMapePct - grounded.overallMapePct).toFixed(1)}%p
              </div>
              <div className="text-[10px] text-gray-400">MAPE 감소</div>
            </div>
          </div>

          {/* 프로퍼티별 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {VAL_PROPS.map(p => {
              const v = view.perProperty[p.key]
              if (!v) return (
                <div key={p.key} className="rounded-lg border p-2 text-center opacity-50">
                  <div className="text-[11px] text-gray-500">{p.label}</div>
                  <div className="text-sm">—</div>
                </div>
              )
              return (
                <div key={p.key} className="rounded-lg border p-2 text-center">
                  <div className="text-[11px] text-gray-500">{p.label}</div>
                  <div className={`text-lg font-bold ${mapeColor(v.mapePct)}`}>{fmt(v.mapePct)}%</div>
                  <div className="text-[10px] text-gray-400">
                    MAE {fmt(v.mae, 2)} · bias {v.bias >= 0 ? '+' : ''}{fmt(v.bias, 2)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 세그먼트별 MAPE */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(view.perSegment).map(([seg, s]) => (
              <div key={seg} className="rounded border px-2.5 py-1 text-xs flex items-center gap-1.5">
                <span className="text-gray-500">{seg}</span>
                <span className={`font-semibold ${mapeColor(s.mapePct)}`}>{fmt(s.mapePct)}%</span>
                <span className="text-gray-400">(n={s.n})</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 등급별 상세 테이블 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">등급별 예측 / 전형값 (오차%)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">등급</TableHead>
                  <TableHead className="text-xs">세그먼트</TableHead>
                  {VAL_PROPS.map(p => (
                    <TableHead key={p.key} className="text-xs text-center">{p.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.perGrade.map(g => (
                  <TableRow key={g.grade.id}>
                    <TableCell className="text-xs font-medium whitespace-nowrap">{g.grade.name}</TableCell>
                    <TableCell className="text-[11px] text-gray-500">{g.segment}</TableCell>
                    {VAL_PROPS.map(p => {
                      const e = g.errors[p.key]
                      if (!e) return <TableCell key={p.key} className="text-center text-[11px] text-gray-300">—</TableCell>
                      const dec = p.key === 'density' ? 2 : p.key === 'mfi' ? 1 : 0
                      return (
                        <TableCell key={p.key} className={`text-center text-[11px] tabular-nums rounded ${cellColor(e.pctErr)}`}>
                          {e.pred.toFixed(dec)} / {e.ref.toFixed(dec)}
                          <div className="text-[10px] opacity-80">({e.pctErr.toFixed(0)}%)</div>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ──────────────────────────────────────────────
// 메인 App
// ──────────────────────────────────────────────
export default function App() {
  const [records, setRecords] = useState<ExperimentRecord[]>([])
  const [loadedFormulation, setLoadedFormulation] = useState<Formulation | null>(null)
  const [activeTab, setActiveTab] = useState('predict')
  const [calibPoints, setCalibPoints] = useState<CalibPoint[]>([])
  const [calibResult, setCalibResult] = useState<CalibResult | null>(null)
  // 문헌 기준 그라운딩 토글 (localStorage 영속)
  const [litGrounding, setLitGrounding] = useState<boolean>(() => {
    try { return localStorage.getItem('abs_lit_grounding') === '1' } catch { return false }
  })

  // 초기 1회: 저장된 그라운딩 상태가 켜져 있으면 calibResult 복원
  useEffect(() => {
    if (litGrounding) {
      const pairs = referenceCalibPairs(predictColdStart, DEFAULT_FORM)
      setCalibResult(fitCalibration(pairs))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleToggleGrounding = useCallback((on: boolean) => {
    if (on && !window.confirm('문헌 기준 보정을 적용하면 기존 M5 캘리브레이션이 대체됩니다. 계속할까요?')) return
    setLitGrounding(on)
    try { localStorage.setItem('abs_lit_grounding', on ? '1' : '0') } catch { /* ignore */ }
    if (on) {
      const pairs = referenceCalibPairs(predictColdStart, DEFAULT_FORM)
      setCalibResult(fitCalibration(pairs))
    } else {
      setCalibResult(null)
    }
  }, [])

  // 원료 단가 (Feature A)
  const [unitCosts, setUnitCostsState] = useState<UnitCosts>(() => {
    try {
      const saved = localStorage.getItem('abs_unit_costs')
      return saved ? { ...DEFAULT_UNIT_COSTS, ...JSON.parse(saved) } : { ...DEFAULT_UNIT_COSTS }
    } catch { return { ...DEFAULT_UNIT_COSTS } }
  })
  const [costVersion, setCostVersion] = useState(0)
  const [costModalOpen, setCostModalOpen] = useState(false)

  // 초기 1회 + 변경 시 active 테이블 동기화 + 재예측 트리거
  useEffect(() => {
    setUnitCosts(unitCosts)
    setCostVersion(v => v + 1)
  }, [unitCosts])

  const handleChangeUnitCosts = useCallback((c: UnitCosts) => {
    setUnitCostsState(c)
    try { localStorage.setItem('abs_unit_costs', JSON.stringify(c)) } catch { /* ignore */ }
  }, [])

  const handleAddCalibPoint = useCallback((p: CalibPoint) => {
    setCalibPoints(prev => [...prev, p])
  }, [])

  const handleRemoveCalibPoint = useCallback((id: number) => {
    setCalibPoints(prev => prev.filter(p => p.id !== id))
  }, [])

  const handleFitCalibration = useCallback(() => {
    setCalibPoints(pts => {
      const pairs = pts.map(p => ({
        segment:       p.segment,
        predictedHdt:  p.predictedHdt,
        predictedIzod: p.predictedIzod,
        predictedVoc:  p.predictedVoc,
        predictedTensile: p.predictedTensile,
        predictedMfi:     p.predictedMfi,
        predictedVicat:   p.predictedVicat,
        measuredHdt:   p.measuredHdt,
        measuredIzod:  p.measuredIzod,
        measuredVoc:   p.measuredVoc,
        measuredTensile: p.measuredTensile,
        measuredMfi:     p.measuredMfi,
        measuredVicat:   p.measuredVicat,
      }))
      setCalibResult(fitCalibration(pairs))
      return pts
    })
  }, [])

  const handleToggleCalibration = useCallback(() => {
    setCalibResult(prev => prev ? { ...prev, active: !prev.active } : null)
  }, [])

  const handleAddRecord = useCallback((r: ExperimentRecord) => {
    setRecords(prev => [r, ...prev])
  }, [])

  const handleBulkAddRecords = useCallback((recs: ExperimentRecord[]) => {
    setRecords(prev => {
      const baseId = Date.now()
      const withIds = recs.map((r, i) => ({ ...r, id: baseId + i }))
      return [...withIds, ...prev]
    })
  }, [])

  const handleUpdateRecord = useCallback((id: number, actual: ExperimentRecord['actual'], note: string) => {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, actual, note } : r))
  }, [])

  const handleLoadFormulation = useCallback((f: Formulation) => {
    setLoadedFormulation(f)
    setActiveTab('predict')
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-baseline gap-3">
          <h1 className="text-lg font-bold tracking-tight">내열 ABS 컴파운드 가상 실험 시뮬레이터</h1>
          <span className="text-xs text-gray-400">N-PMI 내열 ABS · 자동차 내장재 · HDT 115℃+ Track</span>
          <button
            className="ml-auto text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
            onClick={() => setCostModalOpen(true)}>
            ⚙ 단가 설정
          </button>
          <span><Badge variant="secondary" className="text-xs">v1.1 — 실시간 예측</Badge></span>
        </div>
        <div className="max-w-7xl mx-auto mt-0.5 flex gap-4 text-xs text-gray-500">
          <span>목표: HDT ≥ 115℃ · Izod ≥ 15 kJ/m² · TVOC ≤ 50 µg/g</span>
          <span className="ml-auto">실험 트래커: {records.length}건</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="predict">물성 예측 (M1·M2)</TabsTrigger>
            <TabsTrigger value="search">
              자동 탐색 (M6)
              <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">NEW</span>
            </TabsTrigger>
            <TabsTrigger value="doe">DOE 설계 (M3)</TabsTrigger>
            <TabsTrigger value="tracker">
              실험 트래커 (M4)
              {records.length > 0 && <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">{records.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="compare">비교 (M7)</TabsTrigger>
            <TabsTrigger value="validation">
              검증 (M8)
              {litGrounding && <span className="ml-1.5 w-2 h-2 rounded-full bg-green-500 inline-block" />}
            </TabsTrigger>
            <TabsTrigger value="calibration">
              캘리브레이션 (M5)
              {calibResult?.active && <span className="ml-1.5 w-2 h-2 rounded-full bg-green-500 inline-block" />}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="predict">
            <PredictorTab
              records={records}
              onAddRecord={handleAddRecord}
              loadedFormulation={loadedFormulation}
              onFormulationLoaded={() => setLoadedFormulation(null)}
              calibResult={calibResult}
              costVersion={costVersion}
            />
          </TabsContent>
          <TabsContent value="search">
            <SearchTab onLoadFormulation={handleLoadFormulation} />
          </TabsContent>
          <TabsContent value="doe">
            <DOETab />
          </TabsContent>
          <TabsContent value="tracker">
            <TrackerTab records={records} onUpdateRecord={handleUpdateRecord} onBulkAdd={handleBulkAddRecords} />
          </TabsContent>
          <TabsContent value="compare">
            <CompareTab onLoad={handleLoadFormulation} />
          </TabsContent>
          <TabsContent value="validation">
            <ValidationTab litActive={litGrounding} onToggleGrounding={handleToggleGrounding} />
          </TabsContent>
          <TabsContent value="calibration">
            <M5CalibrationTab
              calibPoints={calibPoints}
              calibResult={calibResult}
              records={records}
              onAdd={handleAddCalibPoint}
              onRemove={handleRemoveCalibPoint}
              onFit={handleFitCalibration}
              onToggle={handleToggleCalibration}
              onLoad={handleLoadFormulation}
            />
          </TabsContent>
        </Tabs>
      </div>

      {costModalOpen && (
        <UnitCostsModal
          costs={unitCosts}
          onChange={handleChangeUnitCosts}
          onClose={() => setCostModalOpen(false)}
        />
      )}

      <div className="border-t bg-white mt-8 px-6 py-3 text-xs text-gray-400 max-w-7xl mx-auto">
        Cold-start 예측: Fox 식(Matrix Tg) + HDT-Tg 상관 + 고무-충격 경험 곡선.
        추가 재료: EMA+UHMW-SR 충격 회복 (PMC11013094, 2024) · 인계 FR UL-94 V0 (PMC6401830, Polymers 2019) · 탈크/GF 혼합법칙.
        데이터 0건 기준 오차 ±7~30%. VDA 278 TVOC &lt; 50µg/g · VDA 270 · MS 300-55 기준.
      </div>
    </div>
  )
}
