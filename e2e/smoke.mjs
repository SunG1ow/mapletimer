// 합성 1920x1080 화면 스트림으로 감지→숫자 인식→알림까지 확인하는 스모크 테스트.
// 버프는 m:ss(하단) → 큰 ss(가운데) → 깜빡임 → 랜덤 소멸 순서를 흉내 내고, 모양 2개를 등록한다.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const dir = new URL('.', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()))
page.on('pageerror', (e) => console.log('pageerror:', e.message))
await page.addInitScript(fs.readFileSync(dir + 'scene.js', 'utf8'))
await page.goto(process.argv[2] ?? 'http://localhost:4173/')
await page.evaluate(() => {
  const t = window.__templates
  const P = '1920x1080'
  const s = {
    timed: [
      { id: 'janus', group: 'skill', name: '야누스', enabled: true, mode: 'ocr', durationSec: 60, alertBeforeSec: 10, alertOnExpire: false, colonUnit: 'ms', plainUnit: 's', speech: '',
        templates: { [P]: [{ png: t.janus, width: 34, height: 34, digitRect: { x: 0, y: 17, w: 34, h: 17 } }] } },
      { id: 'buff', group: 'buff', name: '도핑', enabled: true, mode: 'ocr', durationSec: 60, alertBeforeSec: 20, alertOnExpire: true, colonUnit: 'ms', plainUnit: 's', speech: '',
        templates: { [P]: [
          { png: t.buff, width: 32, height: 32, digitRect: { x: 0, y: 15, w: 32, h: 17 } }, // m:ss
          { png: t.buff, width: 32, height: 32, digitRect: { x: 1, y: 5, w: 30, h: 22 } }, // 큰 ss
        ] } },
    ],
    rune: { enabled: true, repeatSec: 0, checkSec: 1, matchRatio: 0.65, speech: '룬', templates: { [P]: [{ png: t.rune, width: 11, height: 11, digitRect: null, bgTolerance: 40 }] } },
  }
  localStorage.setItem('mapletimer.settings.v1', JSON.stringify(s))
})
await page.reload()
await page.getByText('메이플 창 공유 시작').click()
await page.getByText('프로필').waitFor()
await page.getByText('감지 ').first().waitFor({ timeout: 8000 })

async function teach(rowName, text, setup) {
  await page.evaluate(setup, text)
  await page.waitForTimeout(900)
  const row = page.locator('.row').filter({ has: page.locator(`input[value="${rowName}"]`) })
  await row.getByText('숫자 가르치기').click()
  await page.locator('.small-modal input').fill(text)
  const ok = await page.locator('.small-modal button:has-text("학습")').isEnabled()
  if (!ok) console.log('teach disabled for', text, await page.locator('.small-modal p').innerText())
  await page.locator(ok ? '.small-modal button:has-text("학습")' : '.small-modal button:has-text("취소")').click()
}
const small = (t) => (window.__scene.janusText = t)
const big = (t) => { window.__scene.buffStyle = 'big'; window.__scene.buffText = t }
for (const t of ['1:23', '4:56', '7:89', '0:00']) await teach('야누스', t, small)
for (const t of ['12', '34', '56', '78', '90']) await teach('도핑', t, big)
console.log(await page.getByText('학습된 글자').innerText())

const t0 = Date.now()
await page.evaluate(() => { const n = Date.now(); window.__scene.janusEnd = n + 15500; window.__scene.buffEnd = n + 63500 })
setTimeout(() => page.evaluate(() => (window.__scene.rune = true)), 3000)
setTimeout(() => page.evaluate(() => (window.__scene.janusPos = [400, 950])), 2000) // 즐겨찾기 아이콘 위치 이동
const sample = async (label) => {
  const rows = await page.locator('.row').allInnerTexts()
  console.log(`[${label} +${((Date.now() - t0) / 1000).toFixed(0)}s]`, rows.map((r) => r.split('\n').filter((l) => /감지|없음|읽음|^\d+:\d\d$|룬 있음/.test(l)).join(' | ')))
}
await page.waitForTimeout(4000); await sample('m:ss')
await page.waitForTimeout(8000); await sample('janus alert')
await page.waitForTimeout(13000); await sample('buff big ss')
await page.waitForTimeout(36000); await sample('buff blink')
await page.waitForTimeout(6000)
const log = await page.locator('.log').innerText()
console.log('log:\n' + log)
const expect = ['야누스 10초 전', '도핑 20초 전', '도핑 종료', '룬']
const missing = expect.filter((e) => !log.includes(e))
await page.screenshot({ path: dir + 'smoke.png', fullPage: true })
await browser.close()
if (missing.length) { console.log('MISSING:', missing); process.exit(1) }
console.log('SMOKE OK')
