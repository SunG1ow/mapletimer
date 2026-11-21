// 녹화 영상을 화면 공유 대신 앱에 넣어 젠 알림 시각을 확인한다(영상은 개인 녹화라 저장소에 넣지 않는다).
// node e2e/video.mjs <영상.webm> [앱 주소]  — 영상 시각 기준 알림 시각을 출력한다.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const file = process.argv[2]
const app = process.argv[3] ?? 'http://localhost:4173/'
// 영상을 앱과 같은 출처처럼 쓰도록 작은 서버로 내준다.
const server = http.createServer((req, res) => {
  const stat = fs.statSync(file)
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
  const start = range ? Number(range[1]) : 0
  const end = range && range[2] ? Number(range[2]) : stat.size - 1
  res.writeHead(range ? 206 : 200, {
    'Content-Type': 'video/webm',
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Access-Control-Allow-Origin': '*',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
  })
  fs.createReadStream(file, { start, end }).pipe(res)
}).listen(4174)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
page.on('pageerror', (e) => console.log('pageerror:', e.message))
await page.addInitScript(() => {
  window.__beeps = []
  const start = OscillatorNode.prototype.start
  OscillatorNode.prototype.start = function (...a) {
    window.__beeps.push({ freq: this.frequency.value, t: window.__video ? window.__video.currentTime : -1 })
    return start.apply(this, a)
  }
  navigator.mediaDevices.getDisplayMedia = async () => {
    const v = document.createElement('video')
    v.src = 'http://localhost:4174/v.webm'
    v.crossOrigin = 'anonymous'
    v.muted = true
    window.__video = v
    await v.play()
    return v.captureStream()
  }
})
await page.goto(app)
await page.evaluate(() => localStorage.setItem('mapletimer.settings.v1', JSON.stringify({ timed: [], huntStop: { enabled: false } })))
await page.reload()
await page.getByText('메이플 창 공유 시작').click()
await page.waitForFunction(() => window.__video && window.__video.ended, null, { timeout: 200000, polling: 1000 })
const beeps = await page.evaluate(() => window.__beeps)
const log = await page.locator('.log').innerText()
// 젠 기록 내보내기
const [download] = await Promise.all([page.waitForEvent('download'), page.getByText('기록 내보내기').click()])
const csv = fs.readFileSync(await download.path(), 'utf8')
const csvOut = path.join(path.dirname(file), 'spawn-log.csv')
fs.writeFileSync(csvOut, csv)
console.log('기록:', csv.split('\n').length, '줄 →', csvOut)
console.log(csv.split('\n').slice(0, 3).join('\n'))
await browser.close()
server.close()
const spawn = beeps.filter((b) => b.freq === 1320).map((b) => b.t)
console.log('log:\n' + log)
console.log('젠 알림(영상 시각, 초):', spawn.map((t) => t.toFixed(2)).join(' '))
console.log(path.basename(file), 'SPAWN BEEPS', spawn.length)
