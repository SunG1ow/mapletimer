// 화면 프레임을 받아 감지를 돌리는 워커. 탭이 백그라운드여도 워커는 타이머 제한을 덜 받는다.

import type { ExpChange } from './core/expwatch'
import { Detector, type Detection, type DetectorConfig } from './detector'
import { gameArea, type Rect, type Rgba } from './core/image'

export type WorkerIn =
  | { type: 'config'; config: DetectorConfig; fps: number }
  | { type: 'stream'; stream: ReadableStream<VideoFrame> }
  | { type: 'frame'; bitmap: ImageBitmap }
  | { type: 'stop' }

export type WorkerOut =
  | {
      type: 'result'
      at: number
      width: number
      height: number
      ms: number
      detections: Detection[]
      exp: ExpChange | null
      /** 사냥 화면 변화량(젠 감지) */
      spawn: number | null
    }
  /** width/height = 게임 화면(창 테두리를 뺀) 크기, raw = 공유 화면 그대로의 크기 */
  | { type: 'size'; width: number; height: number; raw: { width: number; height: number } }
  | { type: 'error'; message: string }

const detector = new Detector()
let configured = false
let intervalMs = 250
let lastProcessed = 0
let busy = false
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null
let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let lastW = 0
let lastH = 0

const post = (msg: WorkerOut, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer)

/** 게임 화면 영역만 그린다(창 모드면 제목 표시줄·테두리를 뺀다). 이후 모든 감지는 이 좌표계. */
function grab(src: VideoFrame | ImageBitmap, area: Rect): Rgba {
  const { w, h } = area
  if (!canvas || canvas.width !== w || canvas.height !== h) {
    canvas = new OffscreenCanvas(w, h)
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  }
  ctx!.drawImage(src, -area.x, -area.y)
  const img = ctx!.getImageData(0, 0, w, h)
  return { width: w, height: h, data: img.data }
}

function process(src: VideoFrame | ImageBitmap, rawW: number, rawH: number) {
  const area = gameArea(rawW, rawH) ?? { x: 0, y: 0, w: rawW, h: rawH }
  const { w, h } = area
  if (rawW !== lastW || rawH !== lastH) {
    lastW = rawW
    lastH = rawH
    post({ type: 'size', width: w, height: h, raw: { width: rawW, height: rawH } })
  }
  if (!configured) return
  const t0 = performance.now()
  // 처리 전에 시각을 잡는다(처리 시간만큼 늦게 찍히면 젠 박자가 그만큼 밀린다).
  const at = Date.now()
  const frame = grab(src, area)
  const detections = detector.detect(frame, t0)
  const exp = detector.watchExp(frame)
  const spawn = detector.watchSpawn(frame)
  const transfer = detections.flatMap((d) => (d.digitCrop ? [d.digitCrop.data.buffer] : []))
  post(
    { type: 'result', at, width: w, height: h, ms: performance.now() - t0, detections, exp, spawn },
    transfer as Transferable[],
  )
}

async function pump(stream: ReadableStream<VideoFrame>) {
  reader = stream.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done || !value) break
    const now = performance.now()
    try {
      if (!busy && now - lastProcessed >= intervalMs) {
        busy = true
        lastProcessed = now
        process(value, value.displayWidth, value.displayHeight)
      }
    } catch (e) {
      post({ type: 'error', message: String(e) })
    } finally {
      busy = false
      value.close()
    }
  }
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'config':
        detector.configure(msg.config)
        configured = true
        intervalMs = 1000 / Math.max(1, msg.fps)
        break
      case 'stream':
        void pump(msg.stream).catch((err) => post({ type: 'error', message: String(err) }))
        break
      case 'frame':
        process(msg.bitmap, msg.bitmap.width, msg.bitmap.height)
        msg.bitmap.close()
        break
      case 'stop':
        void reader?.cancel()
        reader = null
        lastW = lastH = 0
        break
    }
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}
