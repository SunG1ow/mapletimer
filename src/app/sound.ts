// 알림 소리, 음성, 데스크톱 알림.

let ctx: AudioContext | null = null

export function unlockAudio() {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
}

export function beep(volume: number, pattern: number[] = [880, 1175]) {
  unlockAudio()
  const c = ctx!
  let t = c.currentTime
  for (const freq of pattern) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(volume * 0.6, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.2)
    t += 0.16
  }
}

export function speak(text: string, volume: number) {
  if (!('speechSynthesis' in window) || !text) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ko-KR'
  u.volume = volume
  u.rate = 1.15
  window.speechSynthesis.speak(u)
}

export function notify(text: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  new Notification('메이플 타이머', { body: text, silent: true, tag: text })
}

export interface AlertOptions {
  volume: number
  speech: boolean
  desktop: boolean
}

export function fireAlert(text: string, o: AlertOptions, pattern?: number[]) {
  beep(o.volume, pattern)
  if (o.speech) window.setTimeout(() => speak(text, o.volume), 350)
  if (o.desktop) notify(text)
}
