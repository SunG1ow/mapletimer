// 단일 파일 빌드 결과와 프리셋을 release/ 에 모은다. 사용자는 이 폴더만 받으면 된다.
import fs from 'node:fs'

fs.mkdirSync('release', { recursive: true })
fs.copyFileSync('dist-single/index.html', 'release/메이플타이머.html')
fs.copyFileSync('public/favicon.svg', 'release/favicon.svg') // 탭 아이콘(없으면 콘솔에 404)
for (const f of fs.readdirSync('presets')) fs.copyFileSync(`presets/${f}`, `release/${f}`)
console.log('release/', fs.readdirSync('release').join(', '))
