// 사냥 멈춤 알림: 경험치가 오르다 멈추면 알림(반복), 다시 오르면 재개.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const dir = new URL('.', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
page.on('pageerror', (e) => console.log('pageerror:', e.message))
await page.addInitScript(fs.readFileSync(dir + 'scene.js', 'utf8'))
await page.goto(process.argv[2] ?? 'http://localhost:4173/')
await page.evaluate(() => {
  localStorage.setItem('mapletimer.settings.v1', JSON.stringify({ timed: [], huntStop: { enabled: true, stopSec: 5, repeatSec: 3, speech: '사냥 멈춤' } }))
})
await page.reload()
await page.evaluate(() => (window.__scene.expRunning = true))
await page.getByText('메이플 창 공유 시작').click()
await page.getByText('프로필').waitFor()
const row = () => page.locator('.row').filter({ hasText: '경험치 변화 감시' }).innerText()
await page.waitForTimeout(6000)
console.log('[사냥 중]', (await row()).split('\n').slice(0, 6).join(' | '))
await page.evaluate(() => (window.__scene.expRunning = false))
await page.waitForTimeout(12000)
console.log('[멈춤 12초 뒤]', (await row()).split('\n').slice(0, 6).join(' | '))
await page.evaluate(() => (window.__scene.expRunning = true))
await page.waitForTimeout(4000)
console.log('[재개]', (await row()).split('\n').slice(0, 6).join(' | '))
const log = await page.locator('.log').innerText()
console.log('log:\n' + log)
await browser.close()
const stops = (log.match(/사냥 멈춤/g) ?? []).length
const ok = stops >= 2 && stops <= 3 && log.includes('사냥 재개')
console.log(ok ? 'HUNT OK' : `HUNT FAIL (멈춤 ${stops}번)`)
if (!ok) process.exit(1)
