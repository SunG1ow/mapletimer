// 밤의 길 3 스크린샷 17장(1920x1080)으로 presets/bam3-1920x1080.json 을 만들고 정확도를 검증한다.
// 사용: python3 로 스크린샷을 RGBA raw(2.rgba ~ 18.rgba)로 바꾼 폴더를 넘긴다.
//   npx tsx tools/build-preset-bam3.ts <raw폴더> presets/bam3-1920x1080.json
// 정답(아이콘 위 숫자)은 스크린샷을 직접 보고 적은 값. 다른 해상도/사냥터용 프리셋을 만들 때 참고용.
import fs from 'node:fs'
import zlib from 'node:zlib'
import { defaultSettings, newTimedAlert, type Settings, type TemplateData } from '../src/config.ts'
import { Detector, type TargetSpec } from '../src/detector.ts'
import { emptyBank, learn, learnedChars, type DigitBank } from '../src/core/digits.ts'
import { cropRgba, type Rect, type Rgba } from '../src/core/image.ts'

const [RAW, OUT] = process.argv.slice(2)
const P = '1920x1080'
const frames: Record<number, Rgba> = {}
for (let i = 2; i <= 18; i++) frames[i] = { width: 1920, height: 1080, data: new Uint8ClampedArray(fs.readFileSync(`${RAW}/${i}.rgba`)) }

// ---- PNG 인코딩 (dataURL) ----
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(img: Rgba): string {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4); ihdr[8] = 8; ihdr[9] = 6
  const rows = Buffer.alloc((img.width * 4 + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    rows[y * (img.width * 4 + 1)] = 0
    Buffer.from(img.data.buffer, img.data.byteOffset + y * img.width * 4, img.width * 4).copy(rows, y * (img.width * 4 + 1) + 1)
  }
  const buf = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
  return `data:image/png;base64,${buf.toString('base64')}`
}

// ---- 템플릿 ----
const DR: Rect = { x: 0, y: 6, w: 28, h: 16 }
const icon = (i: number, x: number, y: number) => cropRgba(frames[i], { x, y, w: 28, h: 28 })
const janusTpl = icon(3, 1150, 913)
const buffNames = ['경험치 3배 쿠폰', '물약 1', '주머니', 'VIP 부스터', '물약 2', '유니온 1', '유니온 2']
const buffTpls = buffNames.map((_, k) => icon(12, 1675 + 32 * k, 79))
const runeTpl = cropRgba(frames[10], { x: 79, y: 83, w: 15, h: 15 })
const tpl = (img: Rgba, digitRect: Rect | null, extra: Partial<TemplateData> = {}): TemplateData => ({ png: png(img), width: img.width, height: img.height, digitRect, ...extra })

// ---- 정답 ----
const janusTruth: Record<number, string | null> = { 2: '1:11', 3: '58', 4: '47', 5: '37', 6: '24', 7: null, 8: null, 9: '3:09', 10: '13', 11: '', 12: '2:53', 13: '2:35', 14: '2:19', 15: '2:08', 16: '1:58', 17: '1:47', 18: '1:43' }
const buffTruth: Record<number, (string | null)[]> = {
  9: ['1:15', '1:15', '1:15', '1:15', '1:14', '1:14', '1:14'], 12: ['59', '59', '59', '58', '58', '58', '58'],
  13: ['41', '41', '41', '40', '40', '40', '40'], 14: ['25', '25', '24', '24', '24', '24', '24'], 15: ['14', '13', '13', '13', '13', '13', '13'],
  16: ['', '', '', '', '', '', ''], 17: ['', null, null, null, null, null, null],
}
for (let i = 2; i <= 18; i++) buffTruth[i] ??= Array(7).fill(null)
const runeTruth = (i: number) => ([6, 10, 11].includes(i) ? true : i === 7 ? null : false)

const targetsFor = (): TargetSpec[] => [
  { id: 'janus', region: { x: 0, y: 0, w: 1, h: 1 }, variants: [{ rgba: janusTpl, digitRect: DR }], method: 'ncc', threshold: 0.8 },
  ...buffTpls.map((t, k) => ({ id: `buff${k}`, region: { x: 0.5, y: 0, w: 0.5, h: 0.3 }, variants: [{ rgba: t, digitRect: DR }], method: 'ncc' as const, threshold: 0.8 })),
  { id: 'rune', region: { x: 0, y: 0, w: 0.35, h: 0.45 }, variants: [{ rgba: runeTpl, digitRect: null, bgTolerance: 40 }], method: 'shape', threshold: 0.65, withinMinimap: true },
]
const truthOf = (i: number, id: string) => (id === 'janus' ? janusTruth[i] : buffTruth[i][Number(id.slice(4))])

// ---- 숫자 크롭 수집 (감지기로 위치를 찾고 정답 라벨) ----
const labeled: { img: number; crop: Rgba; label: string }[] = []
for (let i = 2; i <= 18; i++) {
  const d = new Detector(); d.configure({ digitBank: emptyBank(), targets: targetsFor() })
  for (let k = 0; k < 6; k++) d.detect(frames[i], k * 250)
  for (const r of d.detect(frames[i], 1500)) {
    if (r.id === 'rune') continue
    const label = truthOf(i, r.id)
    if (r.found && r.digitCrop && label) labeled.push({ img: i, crop: r.digitCrop, label })
  }
}
labeled.push({ img: 12, crop: cropRgba(frames[12], { x: 1771 + DR.x, y: 47 + DR.y, w: DR.w, h: DR.h }), label: '4:26' }) // '6' 학습용
const trainBank = (exclude: number | null) => {
  const b: DigitBank = emptyBank()
  let ok = 0
  for (const c of labeled) if (c.img !== exclude && learn(b, c.crop, c.label).ok) ok++
  return { b, ok }
}

// ---- 검증: 프레임마다 그 프레임을 뺀 학습으로 (처음 보는 화면 기준 정확도) ----
let pass = 0, total = 0
const report: string[] = []
for (let i = 2; i <= 18; i++) {
  const { b } = trainBank(i)
  const d = new Detector(); d.configure({ digitBank: b, targets: targetsFor() })
  const cells: string[] = []
  // 실제처럼 같은 화면을 여러 프레임(4fps로 1.5초) 본 뒤의 결과
  let res = d.detect(frames[i], 0)
  for (let k = 1; k <= 6; k++) {
    const r2 = d.detect(frames[i], k * 250)
    res = res.map((x) => r2.find((y) => y.id === x.id) ?? x)
  }
  for (const r of res) {
    total++
    let ok: boolean, shown: string
    if (r.id === 'rune') {
      const t = runeTruth(i)
      ok = t === null || r.found === t
      shown = r.found ? '룬있음' : '-'
    } else {
      const want = truthOf(i, r.id)
      const reading = r.found ? (r.text ?? '') : null
      ok = want === null ? !r.found : r.found && (want === '' ? !/^\d/.test(reading ?? '') || reading === '' : reading === want)
      shown = r.found ? reading || '(숫자없음)' : '-'
      if (!ok) shown += `≠${want === null ? '없음' : want || '(숫자없음)'}`
    }
    if (ok) pass++
    cells.push(`${ok ? '' : '✗'}${shown}`)
  }
  report.push(`img${String(i).padStart(2)} | 야누스 ${cells[0].padEnd(8)} | 버프 ${cells.slice(1, 8).join(' ')} | 룬 ${cells[8]}`)
}
console.log(report.join('\n'))
console.log(`\n처음 보는 화면 기준 정확도: ${pass}/${total} (${((pass / total) * 100).toFixed(1)}%)`)

// ---- 프리셋 저장 (전체 학습) ----
const { b: bank, ok } = trainBank(null)
console.log(`숫자 학습: ${ok}/${labeled.length}개 크롭, 글자 ${learnedChars(bank).join('')}, 표본 ${bank.samples.length}개`)
const s: Settings = defaultSettings()
const janus = { ...newTimedAlert('skill', '솔 야누스 : 새벽'), id: 'janus', templates: { [P]: [tpl(janusTpl, DR)] } }
const buffs = buffTpls.map((t, k) => ({ ...newTimedAlert('buff', buffNames[k]), id: `buff${k}`, templates: { [P]: [tpl(t, DR)] } }))
s.timed = [janus, ...buffs]
s.rune = { ...s.rune, templates: { [P]: [tpl(runeTpl, null, { bgTolerance: 40 })] } }
s.profiles = { [P]: { digitBank: bank } }
fs.writeFileSync(OUT, JSON.stringify(s, null, 2))
console.log('saved', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB')
