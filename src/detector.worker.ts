// 화면 프레임을 받아 감지를 돌리는 워커. 탭이 백그라운드여도 워커는 타이머 제한을 덜 받는다.

import { Detector, type Detection, type DetectorConfig } from './detector'
import type { Rgba } from './core/image'

export type WorkerIn =
  | { type: 'config'; config: DetectorConfig; fps: number }
  | { type: 'stream'; stream: ReadableStream<VideoFrame> }
  | { type: 'frame'; bitmap: ImageBitmap }
  | { type: 'stop' }

export type WorkerOut =
  | { type: 'result'; at: number; width: number; height: number; ms: number; detections: Detection[] }
  | { type: 'size'; width: number; height: number }
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

function grab(src: VideoFrame | ImageBitmap, w: number, h: number): Rgba {
  if (!canvas || canvas.width !== w || canvas.height !== h) {
    canvas = new OffscreenCanvas(w, h)
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  }
  ctx!.drawImage(src, 0, 0)
  const img = ctx!.getImageData(0, 0, w, h)
  return { width: w, height: h, data: img.data }
}

function process(src: VideoFrame | ImageBitmap, w: number, h: number) {
  if (w !== lastW || h !== lastH) {
    lastW = w
    lastH = h
    post({ type: 'size', width: w, height: h })
  }
  if (!configured) return
  const t0 = performance.now()
  const frame = grab(src, w, h)
  const detections = detector.detect(frame, t0)
  const transfer = detections.flatMap((d) => (d.digitCrop ? [d.digitCrop.data.buffer] : []))
  post(
    { type: 'result', at: Date.now(), width: w, height: h, ms: performance.now() - t0, detections },
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
