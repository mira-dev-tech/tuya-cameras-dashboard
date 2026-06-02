const wallGrid = document.getElementById('wallGrid')
const wallLoading = document.getElementById('wallLoading')
const enginesRoot = document.getElementById('engines')
const loadSteps = [
  document.getElementById('loadStep1'),
  document.getElementById('loadStep2'),
  document.getElementById('loadStep3'),
  document.getElementById('loadStep4'),
]
const totalStat = document.getElementById('totalStat')
const liveStat = document.getElementById('liveStat')
const rotateStat = document.getElementById('rotateStat')
const colsRange = document.getElementById('colsRange')
const refreshBtn = document.getElementById('refreshBtn')
const logoutBtn = document.getElementById('logoutBtn')

const STAGGER_MS = 2500
const PORTAL_BOOT_MS = 9000

/** @type {Map<string, TileState>} */
const tiles = new Map()

colsRange.addEventListener('input', () => {
  document.documentElement.style.setProperty('--tile-min', `${colsRange.value}px`)
})
refreshBtn.addEventListener('click', () => bootstrap(true))
logoutBtn?.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' })
  location.href = '/'
})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function setLoadingStep(idx) {
  loadSteps.forEach((el, i) => {
    if (!el) return
    el.classList.remove('active', 'done')
    if (i < idx) el.classList.add('done')
    else if (i === idx) el.classList.add('active')
  })
}

function hideLoading() {
  wallLoading?.classList.add('hidden')
}

function showLoading() {
  wallLoading?.classList.remove('hidden')
}

function updateProgress(live, total) {
  const el = loadSteps[3]
  if (el) el.textContent = `${live} / ${total} com imagem`
}

function engineDoc(engine) {
  try {
    return engine.contentDocument
  } catch (_) {
    return null
  }
}

function expandTree(doc) {
  if (!doc) return
  doc.querySelectorAll('.ant-tree-switcher_close').forEach((el) => el.click())
}

function selectHome(doc, homeName) {
  if (!doc || !homeName) return false
  const nodes = [...doc.querySelectorAll('[class*="home_name"], [class*="homelist"] span, [class*="homelist"] div')]
  const match = nodes.find((el) => {
    const t = (el.textContent || '').trim()
    return t === homeName && el.children.length === 0
  })
  if (match) {
    match.click()
    return true
  }
  return false
}

function clickCamera(doc, deviceName) {
  if (!doc || !deviceName) return false
  const title = [...doc.querySelectorAll('.ant-tree-title')].find((el) => (el.textContent || '').trim() === deviceName)
  if (!title) return false
  title.click()
  return true
}

function findVideo(doc, devId, deviceName) {
  if (!doc) return null
  const videos = [...doc.querySelectorAll('video')].filter((v) => v.videoWidth > 0 && v.readyState >= 2)
  if (!videos.length) return null
  for (const video of videos) {
    let el = video
    for (let d = 0; d < 14; d += 1) {
      el = el.parentElement
      if (!el) break
      const html = el.outerHTML || ''
      const text = el.textContent || ''
      if ((devId && html.includes(devId)) || (deviceName && text.includes(deviceName))) return video
    }
  }
  return videos[0]
}

async function waitPortal(engine, timeoutMs = 35000) {
  await new Promise((resolve) => {
    engine.addEventListener('load', resolve, { once: true })
    setTimeout(resolve, timeoutMs)
  })
  for (let i = 0; i < 40; i += 1) {
    const doc = engineDoc(engine)
    if (doc?.readyState === 'complete' && (doc.body?.innerText || '').includes('SmartLife')) return true
    await sleep(400)
  }
  return false
}

async function waitVideo(doc, devId, name, timeoutMs = 35000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (findVideo(doc, devId, name)) return true
    await sleep(500)
  }
  return false
}

function startMirror(tile, sourceVideo) {
  stopMirror(tile)
  tile.sourceVideo = sourceVideo
  tile.canvas.style.display = 'block'
  const draw = () => {
    const v = tile.sourceVideo
    if (v && v.readyState >= 2 && v.videoWidth > 0) {
      if (tile.canvas.width !== v.videoWidth) {
        tile.canvas.width = v.videoWidth
        tile.canvas.height = v.videoHeight
      }
      tile.canvas.getContext('2d')?.drawImage(v, 0, 0)
      if (tile.mode !== 'live') {
        setTileMode(tile, 'live')
        updateLiveStat()
      }
    }
    tile.mirrorRAF = requestAnimationFrame(draw)
  }
  draw()
}

function stopMirror(tile) {
  if (tile.mirrorRAF) cancelAnimationFrame(tile.mirrorRAF)
  tile.mirrorRAF = 0
  tile.sourceVideo = undefined
}

function createTile(cam) {
  const root = document.createElement('article')
  root.className = 'tile'
  root.dataset.devId = cam.devId

  const spinner = document.createElement('div')
  spinner.className = 'tile-spinner'
  spinner.innerHTML = '<div class="spinner-border spinner-border-sm text-secondary"></div><span>Conectando…</span>'

  const canvas = document.createElement('canvas')
  const badge = document.createElement('span')
  badge.className = 'tile-badge wait'
  badge.textContent = '…'

  const meta = document.createElement('div')
  meta.className = 'tile-meta'
  meta.innerHTML = `<div class="home">${cam.homeName}</div><div class="dev">${cam.name || cam.devId}</div>`

  root.append(spinner, canvas, badge, meta)
  wallGrid.appendChild(root)

  const state = {
    devId: cam.devId,
    name: cam.name || cam.devId,
    homeName: cam.homeName,
    root,
    canvas,
    badge,
    spinner,
    mode: 'wait',
    engine: null,
    mirrorRAF: 0,
    sourceVideo: undefined,
  }
  tiles.set(cam.devId, state)
  return state
}

function setTileMode(tile, mode) {
  tile.mode = mode
  tile.root.classList.toggle('live', mode === 'live')
  tile.badge.className = `tile-badge ${mode === 'live' ? 'live' : mode === 'err' ? 'err' : 'wait'}`
  tile.badge.textContent = mode === 'live' ? 'ao vivo' : mode === 'err' ? 'sem sinal' : '…'
  tile.spinner.style.display = mode === 'wait' ? 'flex' : 'none'
}

function updateLiveStat() {
  const live = [...tiles.values()].filter((t) => t.mode === 'live').length
  liveStat.textContent = `${live} ao vivo`
  return live
}

async function connectCamera(cam, tile) {
  const engine = document.createElement('iframe')
  engine.title = `engine-${cam.devId}`
  engine.setAttribute('allow', 'autoplay; camera; microphone')
  enginesRoot.appendChild(engine)
  tile.engine = engine

  engine.src = `/portal/playback?_=${Date.now()}`
  const ready = await waitPortal(engine)
  if (!ready) {
    setTileMode(tile, 'err')
    return false
  }

  await sleep(PORTAL_BOOT_MS)
  let doc = engineDoc(engine)
  if (cam.homeName) {
    selectHome(doc, cam.homeName)
    await sleep(3000)
    doc = engineDoc(engine)
  }

  for (let i = 0; i < 4; i += 1) {
    expandTree(doc)
    await sleep(700)
    doc = engineDoc(engine)
  }

  if (!clickCamera(doc, cam.name)) {
    setTileMode(tile, 'err')
    return false
  }

  let ok = await waitVideo(doc, cam.devId, cam.name, 30000)
  if (!ok) {
    clickCamera(engineDoc(engine), cam.name)
    ok = await waitVideo(engineDoc(engine), cam.devId, cam.name, 15000)
  }

  const video = findVideo(engineDoc(engine), cam.devId, cam.name)
  if (!video) {
    setTileMode(tile, 'err')
    return false
  }

  startMirror(tile, video)
  return true
}

async function bootstrap(force = false) {
  showLoading()
  setLoadingStep(0)

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
  setLoadingStep(1)

  if (force) {
    for (const tile of tiles.values()) {
      stopMirror(tile)
      tile.engine?.remove()
    }
    enginesRoot.innerHTML = ''
    tiles.clear()
  }

  const res = await fetch('/api/cameras/all')
  const data = await res.json()
  if (!res.ok) {
    hideLoading()
    wallGrid.innerHTML = `<p class="p-3 text-warning">${data.message || 'Erro'}</p>`
    return
  }

  const cameras = data.cameras || []
  if (!cameras.length) {
    hideLoading()
    wallGrid.innerHTML = '<p class="p-3 text-secondary">Nenhuma câmera online.</p>'
    totalStat.textContent = '0 online'
    return
  }

  setLoadingStep(2)
  totalStat.textContent = `${cameras.length} online`
  rotateStat.textContent = 'WebRTC exige player no nível do mural (não iframe aninhado)'

  if (!tiles.size) {
    wallGrid.innerHTML = ''
    for (const cam of cameras) createTile(cam)
  }

  setLoadingStep(3)
  let live = 0
  const PARALLEL = 2
  for (let i = 0; i < cameras.length; i += PARALLEL) {
    const chunk = cameras.slice(i, i + PARALLEL)
    const results = await Promise.all(chunk.map(async (cam) => {
      const tile = tiles.get(cam.devId)
      if (!tile) return false
      setTileMode(tile, 'wait')
      return connectCamera(cam, tile)
    }))
    live += results.filter(Boolean).length
    updateProgress(live, cameras.length)
    updateLiveStat()
    if (i + PARALLEL < cameras.length) await sleep(STAGGER_MS)
  }

  loadSteps.forEach((el) => el?.classList.add('done'))
  hideLoading()
  rotateStat.textContent = `${live}/${cameras.length} streams activos · ~${Math.ceil((cameras.length * STAGGER_MS) / 1000)}s entre lotes`
}

bootstrap()

window.addEventListener('beforeunload', () => {
  for (const tile of tiles.values()) {
    stopMirror(tile)
    tile.engine?.remove()
  }
})
