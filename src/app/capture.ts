// 화면 공유를 시작하고 프레임을 감지 워커로 넘긴다.

import type { WorkerIn, WorkerOut } from '../detector.worker'
import DetectorWorker from '../detector.worker?worker&inline'

type Processor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> }

export interface CaptureCallbacks {
  onMessage: (msg: WorkerOut) => void
  onEnded: () => void
}

export class Capture {
  readonly worker: Worker
  private stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private fallbackTimer: number | undefined
  private fps = 4
  private cb: CaptureCallbacks

  constructor(cb: CaptureCallbacks) {
    this.cb = cb
    this.worker = new DetectorWorker()
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => cb.onMessage(e.data)
  }

  get active() {
    return !!this.stream
  }

  send(msg: WorkerIn, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer)
  }

  setFps(fps: number) {
    this.fps = fps
    if (this.fallbackTimer !== undefined) this.startFallback()
  }

  async start() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15 } },
      audio: false,
    })
    this.stream = stream
    const track = stream.getVideoTracks()[0]
    track.addEventListener('ended', () => {
      this.stop()
      this.cb.onEnded()
    })

    // 스냅샷(템플릿 등록)용
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    this.video = video

    const MSTP = (window as unknown as { MediaStreamTrackProcessor?: Processor }).MediaStreamTrackProcessor
    if (MSTP) {
      // Chrome: 프레임 스트림을 통째로 워커에 넘긴다. 탭이 가려져도 계속 동작.
      const { readable } = new MSTP({ track: track.clone() })
      this.send({ type: 'stream', stream: readable }, [readable as unknown as Transferable])
    } else {
      this.startFallback()
    }
  }

  private startFallback() {
    window.clearInterval(this.fallbackTimer)
    this.fallbackTimer = window.setInterval(async () => {
      if (!this.video || this.video.readyState < 2) return
      const bitmap = await createImageBitmap(this.video)
      this.send({ type: 'frame', bitmap }, [bitmap])
    }, 1000 / this.fps)
  }

  stop() {
    window.clearInterval(this.fallbackTimer)
    this.fallbackTimer = undefined
    this.send({ type: 'stop' })
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.video) this.video.srcObject = null
    this.video = null
  }

  /** 현재 화면을 캔버스로 가져온다. */
  snapshot(): HTMLCanvasElement | null {
    const v = this.video
    if (!v || !v.videoWidth) return null
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d', { willReadFrequently: true })!.drawImage(v, 0, 0)
    return c
  }
}
