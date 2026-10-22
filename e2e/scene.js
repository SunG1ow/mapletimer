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
  const scene = { janusText: '1:23', buffText: '4:56', janusEnd: null, buffEnd: null, rune: false, janusPos: [1500, 900] }
  window.__scene = scene
  function drawText(g, text, x, y) {
    g.font = 'bold 13px monospace'; g.textBaseline = 'top'; g.lineWidth = 3; g.strokeStyle = '#000'; g.fillStyle = '#fff'
    ;[...text].forEach((ch, i) => { g.strokeText(ch, x + i * 9, y); g.fillText(ch, x + i * 9, y) })
  }
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const g = canvas.getContext('2d')
  function draw() {
    g.drawImage(bg, 0, 0)
    const now = Date.now()
    if (scene.janusEnd) scene.janusText = fmt(scene.janusEnd - now)
    if (scene.buffEnd) { if (now > scene.buffEnd) scene.buffText = null; else scene.buffText = fmt(scene.buffEnd - now) }
    const [jx, jy] = scene.janusPos
    g.drawImage(janus, jx, jy); drawText(g, scene.janusText, jx + 1, jy + 19)
    if (scene.buffText !== null) { g.drawImage(buff, 1800, 30); drawText(g, scene.buffText, 1800, 47) }
    if (scene.rune) g.drawImage(rune, 140, 120)
  }
  setInterval(draw, 50); draw()
  window.__templates = {
    janus: janus.toDataURL(), buff: buff.toDataURL(), rune: rune.toDataURL(),
  }
  navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(15)
})()
