// 합성 1920x1080 화면 스트림으로 감지→숫자 인식→알림까지 확인하는 스모크 테스트.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const dir = new URL('.', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()))
page.on('pageerror', (e) => console.log('pageerror:', e.message))
await page.addInitScript(fs.readFileSync(dir + 'scene.js', 'utf8'))
await page.goto(process.argv[2] ?? 'http://localhost:4173/')
// 템플릿을 설정에 심는다 (아이콘 34x34, 숫자 영역은 아이콘 하단)
await page.evaluate(() => {
  const t = window.__templates
  const s = {
    timed: [
      { id: 'janus', group: 'skill', name: '야누스', enabled: true, mode: 'ocr', durationSec: 60, alertBeforeSec: 5, alertOnExpire: false, colonUnit: 'ms', plainUnit: 's', speech: '',
        templates: { '1920x1080': { png: t.janus, width: 34, height: 34, digitRect: { x: 0, y: 17, w: 34, h: 17 } } } },
      { id: 'buff', group: 'buff', name: '도핑', enabled: true, mode: 'ocr', durationSec: 60, alertBeforeSec: 4, alertOnExpire: true, colonUnit: 'ms', plainUnit: 's', speech: '',
        templates: { '1920x1080': { png: t.buff, width: 32, height: 32, digitRect: { x: 0, y: 15, w: 32, h: 17 } } } },
    ],
    rune: { enabled: true, repeatSec: 0, speech: '룬', templates: { '1920x1080': { png: t.rune, width: 11, height: 11, digitRect: null } } },
  }
  localStorage.setItem('mapletimer.settings.v1', JSON.stringify(s))
})
await page.reload()
await page.getByText('메이플 창 공유 시작').click()
await page.getByText('프로필').waitFor()
await page.getByText('감지 ').first().waitFor({ timeout: 8000 })
console.log('detected:', await page.locator('.row-sub').allInnerTexts())

// 숫자 가르치기: 화면 고정 문자열로 여러 번
async function teach(id, text) {
  await page.evaluate(([id, text]) => { if (id === 'janus') window.__scene.janusText = text; else window.__scene.buffText = text }, [id, text])
  await page.waitForTimeout(900)
  const row = page.locator('.row').filter({ has: page.locator(`input[value="${id === 'janus' ? '야누스' : '도핑'}"]`) })
  await row.getByText('숫자 가르치기').click()
  await page.locator('.small-modal input').fill(text)
  const ok = await page.locator('.small-modal button:has-text("학습")').isEnabled()
  if (!ok) console.log('teach disabled for', text, await page.locator('.small-modal p').innerText())
  await page.locator(ok ? '.small-modal button:has-text("학습")' : '.small-modal button:has-text("취소")').click()
}
for (const t of ['1:23', '4:56', '7:89', '0:00']) await teach('janus', t)
console.log(await page.getByText('학습된 글자').innerText())

// 카운트다운 시작
await page.evaluate(() => { const n = Date.now(); window.__scene.janusEnd = n + 9800; window.__scene.buffEnd = n + 8800 })
setTimeout(() => page.evaluate(() => (window.__scene.rune = true)), 3000)
setTimeout(() => page.evaluate(() => (window.__scene.janusPos = [400, 950])), 2000) // 즐겨찾기 아이콘 위치 이동
await page.waitForTimeout(3500)
console.log('mid:', await page.locator('.row-sub').allInnerTexts(), await page.locator('.cell strong').allInnerTexts())
await page.waitForTimeout(9000)
console.log('log:', await page.locator('.log').innerText())
await page.screenshot({ path: dir + 'smoke.png', fullPage: true })
await browser.close()
