// 브라우저에 주입: 가짜 1920x1080 게임 화면과 getDisplayMedia 대체.
(() => {
  const W = 1920, H = 1080
  function makeIcon(size, hue) {
    const c = document.createElement('canvas'); c.width = c.height = size
    const g = c.getContext('2d')
    const grd = g.createLinearGradient(0, 0, size, size)
    grd.addColorStop(0, `hsl(${hue},80%,35%)`); grd.addColorStop(1, `hsl(${hue + 60},70%,20%)`)
    g.fillStyle = grd; g.fillRect(0, 0, size, size)
    g.fillStyle = `hsl(${hue + 180},90%,60%)`; g.beginPath(); g.arc(size / 2, size / 2.6, size / 3.2, 0, 7); g.fill()
    g.strokeStyle = '#dde'; g.lineWidth = 2; g.strokeRect(1, 1, size - 2, size - 2)
    return c
  }
  function makeDiamond() {
    const c = document.createElement('canvas'); c.width = c.height = 11
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 11, 11)
    g.fillStyle = '#c86bff'; g.beginPath(); g.moveTo(5.5, 0.5); g.lineTo(10.5, 5.5); g.lineTo(5.5, 10.5); g.lineTo(0.5, 5.5); g.closePath(); g.fill()
    g.fillStyle = '#fff'; g.fillRect(4, 4, 3, 3)
    return c
  }
  const janus = makeIcon(34, 260), buff = makeIcon(32, 30), rune = makeDiamond()
  const bg = document.createElement('canvas'); bg.width = W; bg.height = H
  { const g = bg.getContext('2d'); const img = g.createImageData(W, H); let s = 7
    for (let i = 0; i < W * H; i++) { s = (s * 1664525 + 1013904223) >>> 0; const v = s >>> 25; img.data[i*4] = v; img.data[i*4+1] = v * 0.6; img.data[i*4+2] = 40 + (v >> 1); img.data[i*4+3] = 255 }
    g.putImageData(img, 0, 0); g.fillStyle = '#000'; g.fillRect(20, 60, 300, 160) } // 미니맵
  // buffStyle: 'small' = 하단 m:ss, 'big' = 가운데 큰 ss (1분 미만), 'blink' = 숫자 없이 깜빡임 (5초 이하)
  const scene = { janusText: '1:23', buffText: '4:56', buffStyle: 'small', janusEnd: null, buffEnd: null, buffGoneAt: null, rune: false, janusPos: [1500, 900] }
  window.__scene = scene
  function drawText(g, text, x, y, big = false) {
    g.font = big ? 'bold 19px monospace' : 'bold 13px monospace'; g.textBaseline = 'top'; g.lineWidth = 3; g.strokeStyle = '#000'; g.fillStyle = '#fff'
    const step = big ? 13 : 9
    ;[...text].forEach((ch, i) => { g.strokeText(ch, x + i * step, y); g.fillText(ch, x + i * step, y) })
  }
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const g = canvas.getContext('2d')
  function draw() {
    g.drawImage(bg, 0, 0)
    const now = Date.now()
    if (scene.janusEnd) scene.janusText = fmt(scene.janusEnd - now)
    if (scene.buffEnd) {
      const left = scene.buffEnd - now
      // 서버 랙: 실제로 사라지는 순간은 0~1.5초 랜덤
      scene.buffGoneAt ??= scene.buffEnd + Math.random() * 1500
      if (now > scene.buffGoneAt) scene.buffText = null
      else if (left <= 5000) { scene.buffStyle = 'blink'; scene.buffText = '' }
      else if (left < 60000) { scene.buffStyle = 'big'; scene.buffText = String(Math.floor(left / 1000)) }
      else { scene.buffStyle = 'small'; scene.buffText = fmt(left) }
    }
    const [jx, jy] = scene.janusPos
    g.drawImage(janus, jx, jy); drawText(g, scene.janusText, jx + 1, jy + 19)
    const blinkOff = scene.buffStyle === 'blink' && Math.floor(now / 300) % 2 === 1
    if (scene.buffText !== null && !blinkOff) {
      g.drawImage(buff, 1800, 30)
      if (scene.buffStyle === 'small') drawText(g, scene.buffText, 1800, 47)
      else if (scene.buffStyle === 'big') drawText(g, scene.buffText, 1803, 37, true)
    }
    if (scene.rune) g.drawImage(rune, 140, 120)
  }
  setInterval(draw, 50); draw()
  window.__templates = {
    janus: janus.toDataURL(), buff: buff.toDataURL(), rune: rune.toDataURL(),
  }
  navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(15)
})()
