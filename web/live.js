const portalFrame = document.getElementById('portalFrame')
const cameraTree = document.getElementById('cameraTree')
const camCount = document.getElementById('camCount')
const watchStatus = document.getElementById('watchStatus')
const activityLog = document.getElementById('activityLog')
const autoRotate = document.getElementById('autoRotate')
const reconnectBtn = document.getElementById('reconnectBtn')
const fullscreenBtn = document.getElementById('fullscreenBtn')
const logoutBtn = document.getElementById('logoutBtn')

const ROTATE_MS = 45000
const WATCH_MS = 8000
const STALE_MS = 90000
const MAX_AUTO_RELOADS = 2

let cameras = []
let homes = []
let rotateTimer = null
let watchTimer = null
let rotateIndex = 0
let lastVideoActivity = Date.now()
let selectedHome = null
let portalBlocked = false
let autoReloadCount = 0
let logLines = []

const handleReconnect = () => {
  portalBlocked = false
  autoReloadCount = 0
  appendLog('Reconexão manual solicitada')
  loadPortal(true)
}
const handleFullscreen = () => {
  const el = portalFrame.parentElement
  if (el.requestFullscreen) el.requestFullscreen()
}

reconnectBtn.addEventListener('click', handleReconnect)
fullscreenBtn.addEventListener('click', handleFullscreen)
logoutBtn?.addEventListener('click', async () => {
  stopWatch()
  stopRotate()
  await fetch('/api/logout', { method: 'POST' })
  location.href = '/'
})
autoRotate.addEventListener('change', () => {
  if (autoRotate.checked) startRotate()
  else stopRotate()
})

function appendLog(message) {
  const ts = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  logLines.unshift(`[${ts}] ${message}`)
  if (logLines.length > 40) logLines.length = 40
  if (activityLog) {
    activityLog.innerHTML = logLines.map((line) => `<div>${line}</div>`).join('')
  }
}

function setStatus(text, level = 'live') {
  watchStatus.textContent = text
  watchStatus.className = `small me-auto ${level === 'warn' ? 'text-warning' : level === 'off' ? 'text-secondary' : level === 'err' ? 'text-danger' : 'text-success'}`
}

function loadPortal(force = false) {
  const url = '/portal/playback'
  const full = location.origin + url
  if (force || portalFrame.src !== full) {
    setStatus('Carregando player IPC…', 'warn')
    appendLog('Carregando /portal/playback')
    portalFrame.src = url
    lastVideoActivity = Date.now()
  }
}

function groupByHome(items) {
  const map = new Map()
  for (const cam of items) {
    const key = String(cam.gid)
    if (!map.has(key)) {
      map.set(key, { gid: cam.gid, homeName: cam.homeName, cameras: [] })
    }
    map.get(key).cameras.push(cam)
  }
  return [...map.values()]
}

function renderTree(groups) {
  cameraTree.innerHTML = ''
  for (const group of groups) {
    const block = document.createElement('div')
    block.className = 'home-group mb-2 pb-2'
    block.innerHTML = `<div class="fw-semibold mb-1">${group.homeName} <span class="muted">(${group.cameras.length})</span></div>`
    for (const cam of group.cameras) {
      const row = document.createElement('div')
      row.className = 'cam-item py-1 px-2 rounded small'
      row.dataset.gid = String(group.gid)
      row.innerHTML = `<span class="status-dot status-off me-2"></span>${cam.devId}`
      row.title = `Casa: ${group.homeName}`
      row.addEventListener('click', () => selectHome(group, row))
      block.appendChild(row)
    }
    cameraTree.appendChild(block)
  }
}

function selectHome(group, rowEl) {
  selectedHome = group
  cameraTree.querySelectorAll('.cam-item').forEach((el) => el.classList.remove('active'))
  if (rowEl) rowEl.classList.add('active')
  rotateIndex = homes.findIndex((h) => h.gid === group.gid)
  if (rotateIndex < 0) rotateIndex = 0
  appendLog(`Casa selecionada: ${group.homeName}`)
  clickHomeInPortal(group.homeName)
}

function clickHomeInPortal(homeName) {
  try {
    const doc = portalFrame.contentDocument
    if (!doc) return false
    const candidates = [...doc.querySelectorAll('div,span,li,button,a')]
    const match = candidates.find((el) => {
      const t = (el.textContent || '').trim()
      return t === homeName || t.startsWith(homeName)
    })
    if (match) {
      match.click()
      setStatus(`Casa: ${homeName}`, 'live')
      appendLog(`Player: casa «${homeName}» activada`)
      return true
    }
  } catch (_) {
    /* cross-origin or not ready */
  }
  return false
}

function clickRetryInPortal() {
  try {
    const doc = portalFrame.contentDocument
    if (!doc) return false
    const labels = [/retry|repetir|reconnect|atualizar|refresh/i]
    const buttons = [...doc.querySelectorAll('button,a,span,div')]
    const btn = buttons.find((el) => labels.some((re) => re.test(el.textContent || '')))
    if (btn) {
      btn.click()
      appendLog('Player: botão de retry clicado')
      return true
    }
  } catch (_) {
    /* ignore */
  }
  return false
}

function readPortalText() {
  try {
    return portalFrame.contentDocument?.body?.innerText || ''
  } catch (_) {
    return ''
  }
}

function detectNotFound() {
  const text = readPortalText()
  return /access page has been deleted|does not exist|página não existe|404/i.test(text)
}

function detectVideoActivity() {
  try {
    const doc = portalFrame.contentDocument
    if (!doc) return false
    const videos = doc.querySelectorAll('video')
    if (!videos.length) return false
    for (const v of videos) {
      if (!v.paused && v.readyState >= 2 && v.videoWidth > 0) {
        return true
      }
    }
  } catch (_) {
    /* ignore */
  }
  return false
}

function detectErrorState() {
  const text = readPortalText()
  return /failed|offline|tunnel error|stream error|falha|desconectado|building channel/i.test(text)
}

function watchPlayer() {
  if (portalBlocked) {
    setStatus('Player parado — clique em Reconectar', 'err')
    return
  }

  if (detectNotFound()) {
    portalBlocked = true
    setStatus('Portal IPC em 404 — reconexão automática desligada', 'err')
    appendLog('Erro 404 no iframe — auto-reload desactivado (evita travamento)')
    return
  }

  if (detectVideoActivity()) {
    lastVideoActivity = Date.now()
    autoReloadCount = 0
    setStatus('Ao vivo', 'live')
    return
  }

  if (detectErrorState()) {
    setStatus('Erro de stream — tentando recuperar…', 'warn')
    appendLog('Erro de stream detectado no player')
    if (!clickRetryInPortal() && autoReloadCount < MAX_AUTO_RELOADS) {
      autoReloadCount += 1
      appendLog(`Recarregando player (${autoReloadCount}/${MAX_AUTO_RELOADS})`)
      loadPortal(true)
    } else if (autoReloadCount >= MAX_AUTO_RELOADS) {
      portalBlocked = true
      setStatus('Muitas falhas — clique em Reconectar', 'err')
      appendLog('Limite de recargas automáticas atingido')
    }
    return
  }

  if (Date.now() - lastVideoActivity > STALE_MS) {
    if (autoReloadCount >= MAX_AUTO_RELOADS) {
      portalBlocked = true
      setStatus('Sem vídeo — use Reconectar', 'err')
      appendLog('Sem vídeo prolongado; auto-reload parado')
      return
    }
    autoReloadCount += 1
    setStatus(`Sem vídeo — recarregando (${autoReloadCount}/${MAX_AUTO_RELOADS})…`, 'warn')
    appendLog(`Sem vídeo activo; recarga ${autoReloadCount}/${MAX_AUTO_RELOADS}`)
    loadPortal(true)
    lastVideoActivity = Date.now()
  }
}

function startWatch() {
  stopWatch()
  watchTimer = setInterval(watchPlayer, WATCH_MS)
}

function stopWatch() {
  if (watchTimer) clearInterval(watchTimer)
  watchTimer = null
}

function startRotate() {
  stopRotate()
  if (homes.length <= 1) return
  rotateTimer = setInterval(() => {
    if (!autoRotate.checked || portalBlocked) return
    rotateIndex = (rotateIndex + 1) % homes.length
    const home = homes[rotateIndex]
    if (home) clickHomeInPortal(home.homeName)
  }, ROTATE_MS)
}

function stopRotate() {
  if (rotateTimer) clearInterval(rotateTimer)
  rotateTimer = null
}

async function bootstrap() {
  appendLog('Iniciando painel ao vivo')
  const statusRes = await fetch('/api/login/status')
  if (!statusRes.ok) {
    location.href = '/'
    return
  }
  const status = await statusRes.json()
  if (status.state !== 'ready') {
    location.href = '/'
    return
  }

  const res = await fetch('/api/cameras/all')
  const data = await res.json()
  if (!res.ok) {
    cameraTree.textContent = data.message || 'Erro ao listar câmeras'
    appendLog('Falha ao listar câmeras')
    return
  }

  cameras = data.cameras || []
  homes = groupByHome(cameras)
  camCount.textContent = `${cameras.length} câmera${cameras.length === 1 ? '' : 's'}`
  renderTree(homes)
  appendLog(`${cameras.length} câmeras em ${homes.length} casa(s)`)

  loadPortal(true)
  portalFrame.addEventListener('load', () => {
    lastVideoActivity = Date.now()
    appendLog('Iframe do portal carregado')
    if (detectNotFound()) {
      portalBlocked = true
      setStatus('Portal IPC em 404 — clique em Reconectar', 'err')
      appendLog('Iframe carregou página 404 do Next.js')
      return
    }
    if (selectedHome) clickHomeInPortal(selectedHome.homeName)
    else if (homes[0]) clickHomeInPortal(homes[0].homeName)
  })

  startWatch()
  startRotate()
}

bootstrap()

window.addEventListener('beforeunload', () => {
  stopWatch()
  stopRotate()
})
