// 합성 화면으로 템플릿 등록 UI(드래그→확대→숫자 영역→학습→저장)를 끝까지 따라간다.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const dir = new URL('.', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
page.on('pageerror', (e) => console.log('pageerror:', e.message))
await page.addInitScript(fs.readFileSync(dir + 'scene.js', 'utf8'))
await page.goto(process.argv[2] ?? 'http://localhost:4173/')
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.getByText('메이플 창 공유 시작').click()
await page.getByText('프로필').waitFor()
await page.evaluate(() => (window.__scene.janusText = '2:43'))
await page.waitForTimeout(500)
await page.locator('.row .thumb').first().click()
const full = page.locator('canvas.full')
const fb = await full.boundingBox()
const k = fb.width / 1920
// 야누스 아이콘(1500,900, 34px) 주변 넉넉히
await page.mouse.move(fb.x + 1490 * k, fb.y + 890 * k); await page.mouse.down()
await page.mouse.move(fb.x + 1545 * k, fb.y + 945 * k, { steps: 5 }); await page.mouse.up()
const zoom = page.locator('canvas.zoom')
await zoom.waitFor()
const zb = await zoom.boundingBox()
const ax = 1486, ay = 886, Z = 6
const drag = async (x0, y0, x1, y1) => {
  await page.mouse.move(zb.x + (x0 - ax) * Z + 1, zb.y + (y0 - ay) * Z + 1); await page.mouse.down()
  await page.mouse.move(zb.x + (x1 - ax) * Z + 1, zb.y + (y1 - ay) * Z + 1, { steps: 5 }); await page.mouse.up()
}
await drag(1500, 900, 1534, 934)
await page.getByText('다음: 숫자 영역').click()
await drag(1500, 917, 1534, 934)
await page.locator('.learn-form input:not([type=range])').fill('2:43')
console.log(await page.locator('.learn-form small').last().innerText())
await page.locator('.modal-foot button:has-text("저장")').click()
await page.evaluate(() => (window.__scene.janusEnd = Date.now() + 75000))
await page.waitForTimeout(2500)
console.log(await page.locator('.row').first().innerText())
console.log(await page.getByText('학습된 글자').innerText())
await browser.close()
