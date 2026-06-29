import { useState, useCallback, useEffect, useRef } from 'react'
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

// ──────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────
interface CalibPoint {
  id: number
  lot: string
  npmi: number; gAbs: number; anContent: number; injTemp: number
  talc: number; glassFiber: number; pc: number; phosphorusFr: number
  carbonFiber: number; nanoclay: number
  predictedHdt: number; predictedIzod: number; predictedVoc: number
  measuredHdt?: number; measuredIzod?: number; measuredVoc?: number
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
  cbMB: 2.5, antioxidant: 0.5, lubricant: 1.0,
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

  // 검증3: MI 하중-순서 250℃ (5kg > 2.16kg)
  if (mi250_5 >= mi250_2 * 1.05) {
    checks.push(check('ok', 'MI 하중-순서 (250℃)', `MI(5kg) ${mi250_5.toFixed(1)} > MI(2.16kg) ${mi250_2.toFixed(1)} — Power-Law 정상`))
  } else if (mi250_5 >= mi250_2 * 0.95) {
    checks.push(check('warn', 'MI 하중-순서 (250℃)', `MI(5kg) ${mi250_5.toFixed(1)} ≈ MI(2.16kg) ${mi250_2.toFixed(1)} — 경계값`))
  } else {
    checks.push(check('bad', 'MI 하중-순서 (250℃)', `MI(5kg) ${mi250_5.toFixed(1)} < MI(2.16kg) ${mi250_2.toFixed(1)} — 물리법칙 위반`))
  }

  // 검증4: MI 온도-순서
  if (mi250_5 > mi220 && mi220 > mi200) {
    checks.push(check('ok', 'MI 온도-순서', `250·5 > 220·10 > 200·21.6: ${mi250_5.toFixed(1)} > ${mi220.toFixed(1)} > ${mi200.toFixed(1)}`))
  } else {
    checks.push(check('warn', 'MI 온도-순서', `예측: 250·5=${mi250_5.toFixed(1)}, 220·10=${mi220.toFixed(1)}, 200·21.6=${mi200.toFixed(1)} — 비전형 순서`))
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
// M1 + M2: 배합 입력기 & 물성 예측기 (실시간)
// ──────────────────────────────────────────────
function PredictorTab({ records, onAddRecord, loadedFormulation, onFormulationLoaded, calibResult }: {
  records: ExperimentRecord[]
  onAddRecord: (r: ExperimentRecord) => void
  loadedFormulation: Formulation | null
  onFormulationLoaded: () => void
  calibResult: CalibResult | null
}) {
  const [form, setForm] = useState<Formulation>(DEFAULT_FORM)
  const [pred, setPred] = useState<PredictionResult>(() => predictColdStart(DEFAULT_FORM))
  const [lotName, setLotName] = useState('')
  const [changedKey, setChangedKey] = useState<string | null>(null)
  const [miTab, setMiTab] = useState<'mfi'|'mi200'|'mi250_2'|'mi250_5'>('mfi')
  const [sensTab, setSensTab] = useState<SensProp>('hdt')

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
  }, [form, sanEst, compositionOk, calibResult])

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
          <div className="flex gap-2 flex-wrap pb-3 border-b mb-2">
            {Object.entries(PRESETS).map(([name, preset]) => (
              <Button key={name} size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => setForm(f => ({ ...f, ...preset }))}>
                ▸ {name}
              </Button>
            ))}
          </div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide py-2">── 주요 조성</p>
          <SliderRow label="N-PMI 함량"   value={form.npmi}       min={10}  max={25}  step={0.5} unit="wt%"  onChange={set('npmi')}       highlight={changedKey==='npmi'} />
          <SliderRow label="g-ABS(고무)"  value={form.gAbs}       min={20}  max={40}  step={0.5} unit="wt%"  onChange={set('gAbs')}       highlight={changedKey==='gAbs'} />
          <SliderRow label="SAN AN 함량"  value={form.anContent}  min={24}  max={32}  step={0.5} unit="%"    onChange={set('anContent')}  highlight={changedKey==='anContent'} />
          <SliderRow label="카본블랙 MB"  value={form.cbMB}       min={2}   max={3}   step={0.1} unit="wt%"  onChange={set('cbMB')}       highlight={changedKey==='cbMB'} />

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
                <span className="text-xs px-2 py-0.5 rounded font-mono"
                  style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }}>
                  {pred.segment}
                </span>
                {calibResult?.active
                  ? <Badge className="text-xs bg-green-600 text-white border-0">M5 보정 적용 중</Badge>
                  : <Badge variant="outline" className="text-xs">Cold-start</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-3">
            <MetricGauge label={SPEC.hdt.label}  {...pred.hdt}  unit={SPEC.hdt.unit}  min={SPEC.hdt.min}  max={SPEC.hdt.max}  target={SPEC.hdt.target}  higherIsBetter={true} />
            <MetricGauge label={SPEC.vicat.label} {...pred.vicat} unit={SPEC.vicat.unit} min={SPEC.vicat.min} max={SPEC.vicat.max} higherIsBetter={true} />
            <MetricGauge label={SPEC.izod.label} {...pred.izod} unit={SPEC.izod.unit} min={SPEC.izod.min} max={SPEC.izod.max} target={SPEC.izod.target} higherIsBetter={true} />
            {/* 인장강도 */}
            <MetricGauge label="인장강도" {...pred.tensile} unit="MPa" min={15} max={80} higherIsBetter={true} />
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
                <CardTitle className="text-sm">
                  탐색 결과 Top {results.length}
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    (클릭 → 예측 탭에 로드)
                  </span>
                </CardTitle>
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
function TrackerTab({ records, onUpdateRecord }: {
  records: ExperimentRecord[]
  onUpdateRecord: (id: number, actual: ExperimentRecord['actual'], note: string) => void
}) {
  const [editId, setEditId] = useState<number | null>(null)
  const [editActual, setEditActual] = useState<ExperimentRecord['actual']>({})
  const [editNote, setEditNote] = useState('')

  if (records.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-400 text-sm">
          아직 저장된 배합이 없습니다. [물성 예측] 탭에서 트래커 저장 하세요.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">M4 — 실험 트래커 ({records.length}건)</CardTitle>
        <p className="text-xs text-gray-500">실측 결과 입력 → 예측-실측 비교 자동 기록</p>
      </CardHeader>
      <CardContent>
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

function M5CalibrationTab({
  calibPoints, calibResult, records,
  onAdd, onRemove, onFit, onToggle,
}: {
  calibPoints: CalibPoint[]
  calibResult: CalibResult | null
  records: ExperimentRecord[]
  onAdd: (p: CalibPoint) => void
  onRemove: (id: number) => void
  onFit: () => void
  onToggle: () => void
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

  const addDisabled = mHdt === '' && mIzod === '' && mVoc === ''

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
      predictedHdt:  raw.hdt.value,
      predictedIzod: raw.izod.value,
      predictedVoc:  raw.voc.value,
      measuredHdt:   mHdt  !== '' ? Number(mHdt)  : undefined,
      measuredIzod:  mIzod !== '' ? Number(mIzod) : undefined,
      measuredVoc:   mVoc  !== '' ? Number(mVoc)  : undefined,
    }
    onAdd(p)
    setLot(''); setMHdt(''); setMIzod(''); setMVoc('')
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
      predictedHdt:  r.prediction.hdt.value,
      predictedIzod: r.prediction.izod.value,
      predictedVoc:  r.prediction.voc.value,
      measuredHdt:  r.actual?.hdt,
      measuredIzod: r.actual?.izod,
      measuredVoc:  r.actual?.voc,
    }
    onAdd(p)
  }

  const canFit = calibPoints.some(
    p => p.measuredHdt != null || p.measuredIzod != null || p.measuredVoc != null
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

                <div className="space-y-2">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">── 회귀 계수</p>
                  <CalibStatRow label="HDT"  unit="℃"     c={calibResult.hdt}  />
                  <CalibStatRow label="Izod" unit="kJ/m²" c={calibResult.izod} />
                  <CalibStatRow label="VOC"  unit="µg/g"  c={calibResult.voc}  />
                </div>

                <div className="text-[10px] text-gray-400 pt-1 space-y-0.5 border-t">
                  <p>보정식: y_보정 = scale × y_예측 + offset</p>
                  <p>R² ≥ 0.8 양호 · 0.6~0.8 보통 · &lt; 0.6 데이터 추가</p>
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
      </div>
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

  const handleAddCalibPoint = useCallback((p: CalibPoint) => {
    setCalibPoints(prev => [...prev, p])
  }, [])

  const handleRemoveCalibPoint = useCallback((id: number) => {
    setCalibPoints(prev => prev.filter(p => p.id !== id))
  }, [])

  const handleFitCalibration = useCallback(() => {
    setCalibPoints(pts => {
      const pairs = pts.map(p => ({
        predictedHdt:  p.predictedHdt,
        predictedIzod: p.predictedIzod,
        predictedVoc:  p.predictedVoc,
        measuredHdt:   p.measuredHdt,
        measuredIzod:  p.measuredIzod,
        measuredVoc:   p.measuredVoc,
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
          <span className="ml-auto"><Badge variant="secondary" className="text-xs">v1.1 — 실시간 예측</Badge></span>
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
            />
          </TabsContent>
          <TabsContent value="search">
            <SearchTab onLoadFormulation={handleLoadFormulation} />
          </TabsContent>
          <TabsContent value="doe">
            <DOETab />
          </TabsContent>
          <TabsContent value="tracker">
            <TrackerTab records={records} onUpdateRecord={handleUpdateRecord} />
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
            />
          </TabsContent>
        </Tabs>
      </div>

      <div className="border-t bg-white mt-8 px-6 py-3 text-xs text-gray-400 max-w-7xl mx-auto">
        Cold-start 예측: Fox 식(Matrix Tg) + HDT-Tg 상관 + 고무-충격 경험 곡선.
        추가 재료: EMA+UHMW-SR 충격 회복 (PMC11013094, 2024) · 인계 FR UL-94 V0 (PMC6401830, Polymers 2019) · 탈크/GF 혼합법칙.
        데이터 0건 기준 오차 ±7~30%. VDA 278 TVOC &lt; 50µg/g · VDA 270 · MS 300-55 기준.
      </div>
    </div>
  )
}
