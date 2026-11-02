// 전투 유지 알림: 무아(공격마다 갱신, 5초 뒤 사라짐)가 사라진 뒤 끊기기 전에 '공격' 알림. 계속 때리면 조용.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const dir = new URL('.', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
page.on('pageerror', (e) => console.log('pageerror:', e.message))
await page.addInitScript(fs.readFileSync(dir + 'scene.js', 'utf8'))
await page.goto(process.argv[2] ?? 'http://localhost:4173/')
await page.evaluate(() => {
  const P = '1920x1080'
  localStorage.setItem('mapletimer.settings.v1', JSON.stringify({
    timed: [],
    huntStop: { enabled: false },
    // 14초 대신 9초로 줄여 빨리 확인: 사라진 뒤 9−5−2 = 2초에 알림
    combat: { enabled: true, keepSec: 9, buffSec: 5, alertBeforeSec: 2, speech: '공격',
      templates: { [P]: [{ png: window.__templates.mua, width: 30, height: 30, digitRect: { x: 18, y: 14, w: 12, h: 16 }, readDigits: false }] } },
  }))
})
await page.reload()
await page.getByText('메이플 창 공유 시작').click()
await page.getByText('프로필').waitFor()
const row = () => page.locator('.row').filter({ hasText: '무아(공격 시 갱신 버프)' }).innerText()
const log = () => page.locator('.log').innerText()
await page.waitForTimeout(3000)
const attack = () => page.evaluate(() => window.__scene.attacks.push(Date.now()))

// 1) 3초마다 12초 동안 공격 → 알림 없어야 함
for (let i = 0; i < 5; i++) { await attack(); await page.waitForTimeout(3000) }
console.log('[공격 중]', (await row()).split('\n').slice(0, 5).join(' | '))
const quiet = !(await log()).includes('공격')
// 2) 마지막 공격(3초 전) 이후 5초에 무아가 사라지고 그 2초 뒤 알림 → 6초 더 기다리면 울렸어야 함
await page.waitForTimeout(6000)
console.log('[멈춤 9초 뒤]', (await row()).split('\n').slice(0, 5).join(' | '))
const l = await log()
console.log('log:\n' + l)
await browser.close()
const alerts = (l.match(/공격/g) ?? []).length
const ok = quiet && alerts === 1
console.log(ok ? 'COMBAT OK' : `COMBAT FAIL (조용함 ${quiet}, 알림 ${alerts}번)`)
if (!ok) process.exit(1)
