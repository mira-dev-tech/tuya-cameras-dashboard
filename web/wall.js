const wallGrid = document.getElementById('wallGrid')
const wallWrap = document.getElementById('wallWrap')
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
const layoutBtns = document.querySelectorAll('[data-layout]')
const refreshBtn = document.getElementById('refreshBtn')
const logoutBtn = document.getElementById('logoutBtn')
const loadBarFill = document.getElementById('loadBarFill')
const loadConnecting = document.getElementById('loadConnecting')
const loadTip = document.getElementById('loadTip')
const loadSlotsContainer = document.getElementById('loadSlots')
const loadEtaEl = document.getElementById('loadEta')
/** @type {NodeListOf<Element>} */
let loadSlotEls = document.querySelectorAll('.load-slot')

const t = (k, v) => MiraI18n.t(k, v)

let tipTimer = null
let tipIndex = 0
let connectCurrent = 0
let connectTotal = 0

const STAGGER_MS = 3000
const TV_STAGGER_MS = 1500
const PORTAL_BOOT_MS = 10000
const PARALLEL = 1
const PAGE_ROTATE_MS = 30000
const TV_PAGE_ROTATE_MS = 20000
const WATCH_MS = 8000
const STALE_MS = 60000
const ERR_RETRY_MS = 30000
const MAX_RECONNECT_ATTEMPTS = 8
const LAYOUT_STORAGE_KEY = 'mira_wall_layout'
const VALID_PRESETS = new Set(['2', '4', '8', '16', 'all'])
const TV_UA = /Web0S|webOS|Tizen|SMART-TV|SmartTV|GoogleTV|Android TV|CrKey|HbbTV/i
const TV_BACK_KEYS = new Set([461, 10009])

function isTvContext() {
  const params = new URLSearchParams(location.search)
  if (params.get('tv') === '0') return false
  if (params.get('tv') === '1') return true
  if (TV_UA.test(navigator.userAgent || '')) return true
  const wide = window.innerWidth >= 1280
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches
  return wide && coarse
}

const lazyEngines = isTvContext()

function getStaggerMs() {
  return lazyEngines ? TV_STAGGER_MS : STAGGER_MS
}

function getPageRotateMs() {
  return lazyEngines ? TV_PAGE_ROTATE_MS : PAGE_ROTATE_MS
}

function getRotateSeconds() {
  return Math.round(getPageRotateMs() / 1000)
}

function initTvMode() {
  if (!isTvContext()) return
  document.documentElement.classList.add('tv-mode')
  document.body.classList.add('tv-mode')
}

initTvMode()

function syncViewport() {
  const vv = window.visualViewport
  const h = Math.round(vv?.height ?? window.innerHeight)
  const w = Math.round(vv?.width ?? window.innerWidth)
  document.documentElement.style.setProperty('--app-vh', `${h}px`)
  document.documentElement.style.setProperty('--app-vw', `${w}px`)
  const bar = document.querySelector('.wall-bar')
  if (bar) {
    document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`)
  }
  if (cameraOrder.length || tiles.size) recalcLayout()
}

syncViewport()
window.addEventListener('resize', syncViewport)
window.visualViewport?.addEventListener('resize', syncViewport)
window.visualViewport?.addEventListener('scroll', syncViewport)

/** @type {Map<string, TileState>} */
const tiles = new Map()
/** @type {string[]} devIds in API order */
let cameraOrder = []
let layoutPreset = loadLayoutPreset()
let pageIndex = 0
let pageSize = 9
let totalPages = 1
let pageRotateTimer = null
let gridCols = 3
let gridRows = 3
/** @type {Map<string, object>} */
const cameraMeta = new Map()
let watchTimer = null
let reconnectBusy = false
/** @type {Set<string>} */
const reconnectPending = new Set()

function loadLayoutPreset() {
  const params = new URLSearchParams(location.search)
  const urlLayout = params.get('layout')
  if (urlLayout && VALID_PRESETS.has(urlLayout)) return urlLayout
  if (isTvContext()) {
    const vw = window.innerWidth || 1280
    return vw > 1920 ? '8' : '4'
  }
  const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
  return saved && VALID_PRESETS.has(saved) ? saved : 'all'
}

function saveLayoutPreset(preset) {
  localStorage.setItem(LAYOUT_STORAGE_KEY, preset)
}

layoutBtns.forEach((btn) => {
  btn.classList.toggle('active', btn.dataset.layout === layoutPreset)
  btn.addEventListener('click', () => {
    const preset = btn.dataset.layout
    if (!preset || !VALID_PRESETS.has(preset) || preset === layoutPreset) return
    layoutPreset = preset
    saveLayoutPreset(preset)
    layoutBtns.forEach((b) => b.classList.toggle('active', b.dataset.layout === preset))
    pageIndex = 0
    recalcLayout({ restartRotation: true })
  })
})

refreshBtn.addEventListener('click', () => bootstrap(true))
logoutBtn?.addEventListener('click', async () => {
  stopPageRotate()
  await fetch('/api/logout', { method: 'POST' })
  location.href = '/'
})

if (wallWrap && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    syncViewport()
    recalcLayout()
  }).observe(wallWrap)
} else {
  window.addEventListener('resize', () => {
    syncViewport()
    recalcLayout()
  })
}

const wallBar = document.querySelector('.wall-bar')
if (wallBar && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => syncViewport()).observe(wallBar)
}

function applyWallStrings() {
  MiraI18n.apply(document)
  if (connectTotal > 0) updateLoadEta(connectTotal)
  updateLiveStat()
  updateReconnectStat()
  for (const tile of tiles.values()) setTileMode(tile, tile.mode)
}

MiraI18n.initLangSelect()
MiraI18n.onChange(() => applyWallStrings())
MiraI18n.apply(document)

function startLoadMotion() {
  stopLoadMotion()
  tipIndex = 0
  rotateLoadTip()
  tipTimer = setInterval(rotateLoadTip, 4500)
}

function stopLoadMotion() {
  if (tipTimer) {
    clearInterval(tipTimer)
    tipTimer = null
  }
}

function rotateLoadTip() {
  if (!loadTip) return
  loadTip.classList.add('fade')
  setTimeout(() => {
    const keys = MiraI18n.tipKeys
    loadTip.textContent = t(keys[tipIndex % keys.length])
    loadTip.classList.remove('fade')
    tipIndex += 1
  }, 220)
}

function highlightLoadSlot(index) {
  if (!loadSlotEls.length) return
  loadSlotEls.forEach((el, i) => {
    el.classList.toggle('active', i === index % loadSlotEls.length)
  })
}

function computeLoadEtaMinutes(n) {
  const secPerCam = (PORTAL_BOOT_MS + 12000) / 1000 + getStaggerMs() / 1000
  const totalSec = n * secPerCam
  const minMin = Math.max(1, Math.floor(totalSec * 0.9 / 60))
  const maxMin = Math.max(minMin + 1, Math.ceil(totalSec * 1.2 / 60))
  return { n, min: minMin, max: maxMin }
}

function buildLoadSlots(n) {
  if (!loadSlotsContainer) return
  loadSlotsContainer.innerHTML = ''
  const slotCount = Math.min(16, Math.max(4, Math.ceil(Math.sqrt(Math.max(1, n)))))
  const cols = Math.ceil(Math.sqrt(slotCount))
  loadSlotsContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`
  for (let i = 0; i < slotCount; i += 1) {
    const el = document.createElement('div')
    el.className = 'load-slot'
    el.style.setProperty('--slot-delay', `${i * 0.2}s`)
    loadSlotsContainer.appendChild(el)
  }
  loadSlotEls = loadSlotsContainer.querySelectorAll('.load-slot')
}

function updateLoadEta(n) {
  buildLoadSlots(n)
  if (!loadEtaEl) return
  if (n <= 0) {
    loadEtaEl.style.display = 'none'
    return
  }
  loadEtaEl.style.display = ''
  const { min, max } = computeLoadEtaMinutes(n)
  loadEtaEl.textContent = t('loadEta', { n, min, max })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(url, options = {}, timeoutMs = 120000) {
  let timer = null
  let ctrl = null
  if (typeof AbortController !== 'undefined') {
    ctrl = new AbortController()
    timer = setTimeout(() => ctrl.abort(), timeoutMs)
  }
  try {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      signal: ctrl ? ctrl.signal : undefined,
    })
    let data = {}
    try {
      data = await res.json()
    } catch (_) {
      data = {}
    }
    return { res, data }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function showWallError(message) {
  hideLoading()
  if (wallGrid) {
    wallGrid.innerHTML = `<p class="p-3 text-warning wall-error" role="alert">${message}</p>`
  }
}

function setLoadingStep(idx) {
  loadSteps.forEach((el, i) => {
    if (!el) return
    el.classList.remove('active', 'done')
    if (i < idx) el.classList.add('done')
    else if (i === idx) el.classList.add('active')
  })
}

function showLoading() {
  wallLoading?.classList.remove('hidden')
  if (loadBarFill) loadBarFill.style.width = '0%'
  startLoadMotion()
}

function hideLoading() {
  stopLoadMotion()
  wallLoading?.classList.add('hidden')
}

function updateProgress(live, total) {
  const el = loadSteps[3]
  if (el) el.textContent = t('loadProgress', { live, total })
  if (loadBarFill && total > 0) {
    loadBarFill.style.width = `${Math.min(100, Math.round((live / total) * 100))}%`
  }
  if (loadConnecting && connectTotal > 0) {
    loadConnecting.textContent = t('loadConnecting', { current: connectCurrent, total: connectTotal })
    highlightLoadSlot(Math.max(0, connectCurrent - 1))
  }
}

function engineDoc(engine) {
  try {
    return engine.contentDocument
  } catch (_) {
    return null
  }
}

function mutePortalVideos(doc) {
  if (!doc) return
  doc.querySelectorAll('video').forEach((v) => {
    v.muted = true
    v.volume = 0
  })
  const muteBtn = [...doc.querySelectorAll('button, span, div')].find((el) => {
    const cls = el.className || ''
    return typeof cls === 'string' && /mute|volume|sound/i.test(cls) && !/unmute|volumeUp/i.test(cls)
  })
  muteBtn?.click()
}

function getHomeTree(doc, homeName) {
  if (!doc || !homeName) return null
  const trees = [...doc.querySelectorAll('[class*="home_infoTree"]')]
  return trees.find((t) => (t.textContent || '').trim().startsWith(homeName)) || null
}

function expandHomeSection(homeTree) {
  if (!homeTree) return false
  const titles = [...homeTree.querySelectorAll('.ant-tree-title')]
  if (titles.length > 0) return true
  homeTree.scrollIntoView({ block: 'center', behavior: 'instant' })
  const icon = homeTree.querySelector('[class*="home_rightIcon"], [class*="rightIcon"]')
  if (icon) {
    icon.click()
    return true
  }
  homeTree.querySelector('[class*="home_home"]')?.click()
  return false
}

function selectHomeInPortal(doc, homeName) {
  const tree = getHomeTree(doc, homeName)
  if (!tree) return false
  expandHomeSection(tree)
  return true
}

async function waitHomeTreeLoaded(doc, homeName, timeoutMs = 18000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const tree = getHomeTree(doc, homeName)
    if (tree) expandHomeSection(tree)
    const titles = tree ? [...tree.querySelectorAll('.ant-tree-title')].map((t) => (t.textContent || '').trim()) : []
    if (titles.length > 0) return { tree, titles }
    await sleep(700)
  }
  const tree = getHomeTree(doc, homeName)
  const titles = tree ? [...tree.querySelectorAll('.ant-tree-title')].map((t) => (t.textContent || '').trim()) : []
  return { tree, titles }
}

function expandTree(root) {
  if (!root) return 0
  const closed = root.querySelectorAll('.ant-tree-switcher_close')
  closed.forEach((el) => el.click())
  return closed.length
}

async function ensureDeviceVisible(homeTree, deviceName, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (let i = 0; i < 3; i += 1) expandTree(homeTree)
    const titles = [...homeTree.querySelectorAll('.ant-tree-title')].map((t) => (t.textContent || '').trim())
    if (titles.includes(deviceName)) return true
    await sleep(600)
  }
  return false
}

function clickCameraInTree(homeTree, deviceName) {
  if (!homeTree || !deviceName) return false
  const nodes = [...homeTree.querySelectorAll('.ant-tree-treenode')].filter((n) => {
    const title = n.querySelector('.ant-tree-title')
    return title && (title.textContent || '').trim() === deviceName
  })
  const node = nodes.find((n) => n.querySelector('[class*="device_online"]')) || nodes[0]
  if (!node) return false
  homeTree.scrollIntoView({ block: 'center', behavior: 'instant' })
  node.scrollIntoView({ block: 'center', behavior: 'instant' })
  const online = node.querySelector('[class*="device_online"]')
  const wrap = node.querySelector('.ant-tree-node-content-wrapper')
  if (online) online.click()
  if (wrap) wrap.click()
  node.click()
  return true
}

function listActiveVideos(doc) {
  if (!doc) return []
  return [...doc.querySelectorAll('video')].filter((v) => v.videoWidth > 0 && v.readyState >= 2)
}

function findVideo(doc, devId, deviceName) {
  const videos = listActiveVideos(doc)
  if (!videos.length) return null
  for (const video of videos) {
    let el = video
    for (let d = 0; d < 16; d += 1) {
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

function modePriority(mode) {
  if (mode === 'live') return 0
  if (mode === 'wait') return 1
  return 2
}

function orderedTiles() {
  const byId = tiles
  const list = cameraOrder.map((id) => byId.get(id)).filter(Boolean)
  return list.sort((a, b) => {
    const pd = modePriority(a.mode) - modePriority(b.mode)
    if (pd !== 0) return pd
    return cameraOrder.indexOf(a.devId) - cameraOrder.indexOf(b.devId)
  })
}

function optimalGridForViewport(n, vw, vh) {
  if (n <= 0) return { cols: 1, rows: 1 }
  let bestCols = 1
  let bestRows = n
  let bestSize = 0
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols)
    const cellSize = Math.min(vw / cols, vh / rows)
    if (cellSize > bestSize) {
      bestSize = cellSize
      bestCols = cols
      bestRows = rows
    }
  }
  return { cols: bestCols, rows: bestRows }
}

function getGridDimensions(preset, n, vw, vh) {
  const landscape = vw >= vh
  if (preset === '2') {
    return landscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 }
  }
  if (preset === '4') return { cols: 2, rows: 2 }
  if (preset === '8') {
    return landscape ? { cols: 4, rows: 2 } : { cols: 2, rows: 4 }
  }
  if (preset === '16') return { cols: 4, rows: 4 }
  return optimalGridForViewport(n, vw, vh)
}

function updateRotateStat() {
  updateReconnectStat()
}

function updateReconnectStat() {
  if (!rotateStat || !cameraOrder.length) return
  const live = [...tiles.values()].filter((t) => t.mode === 'live').length
  const err = [...tiles.values()].filter((t) => t.mode === 'err').length
  const pending = reconnectPending.size + (reconnectBusy ? 1 : 0)
  const rotSec = getRotateSeconds()
  const base = totalPages <= 1
    ? t('statusGrid', { cols: gridCols, rows: gridRows, n: cameraOrder.length })
    : t('statusPage', { page: pageIndex + 1, pages: totalPages, visible: pageSize, seconds: rotSec })
  if (err > 0 || pending > 0) {
    rotateStat.textContent = `${base} · ${t('statusLiveErr', { live, err })}${pending ? ` · ${t('statusReconnecting', { n: pending })}` : ''}`
  } else if (needsPageRotation() && pageRotateTimer) {
    rotateStat.textContent = `${base} · ${t('statusRotation', { seconds: rotSec })}`
  } else {
    rotateStat.textContent = base
  }
}

function applyPageVisibility() {
  const list = orderedTiles()
  list.forEach((tile, i) => {
    const page = Math.floor(i / pageSize)
    tile.root.classList.toggle('hidden-page', page !== pageIndex)
  })
}

function visibleCameraDevIds() {
  const list = orderedTiles()
  const start = pageIndex * pageSize
  return list.slice(start, start + pageSize).map((tile) => tile.devId)
}

function isTileOnVisiblePage(tile) {
  if (!lazyEngines) return true
  const list = orderedTiles()
  const i = list.findIndex((t) => t.devId === tile.devId)
  if (i < 0) return false
  return Math.floor(i / pageSize) === pageIndex
}

function tearDownTileEngine(tile) {
  stopMirror(tile)
  if (tile.engine) {
    tile.engine.remove()
    tile.engine = null
  }
  tile.connectGen = (tile.connectGen || 0) + 1
  reconnectPending.delete(tile.devId)
  if (tile.mode === 'live') {
    setTileMode(tile, 'wait')
  }
}

let syncEnginesBusy = false
let syncEnginesQueued = false

async function syncVisibleEngines() {
  if (!lazyEngines) return
  if (syncEnginesBusy) {
    syncEnginesQueued = true
    return
  }
  syncEnginesBusy = true
  try {
    const visibleIds = new Set(visibleCameraDevIds())
    for (const tile of tiles.values()) {
      if (!visibleIds.has(tile.devId) && !tile.reconnecting) {
        tearDownTileEngine(tile)
      }
    }

    for (const devId of visibleIds) {
      const tile = tiles.get(devId)
      const cam = cameraMeta.get(devId)
      if (!tile || !cam) continue
      if (tile.engine || tile.reconnecting) continue
      if (tile.mode === 'live' && isStreamHealthy(tile)) continue

      setTileMode(tile, 'wait')
      await connectCamera(cam, tile, nextEngineIndex())
      if (visibleIds.size > 1) await sleep(getStaggerMs())
    }

    updateLiveStat()
    updateReconnectStat()
  } finally {
    syncEnginesBusy = false
    if (syncEnginesQueued) {
      syncEnginesQueued = false
      void syncVisibleEngines()
    }
  }
}

function recalcLayout(options = {}) {
  const n = cameraOrder.length || tiles.size
  if (!n) return

  const vw = wallWrap?.clientWidth || parseInt(getComputedStyle(document.documentElement).getPropertyValue('--app-vw'), 10) || window.innerWidth
  const vh = wallWrap?.clientHeight || Math.max(0, (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--app-vh'), 10) || window.innerHeight) - (wallBar?.offsetHeight || 40))
  const { cols, rows } = getGridDimensions(layoutPreset, n, vw, vh)
  gridCols = cols
  gridRows = rows
  pageSize = cols * rows
  totalPages = Math.max(1, Math.ceil(n / pageSize))
  if (pageIndex >= totalPages) pageIndex = 0

  document.documentElement.style.setProperty('--wall-cols', String(cols))
  document.documentElement.style.setProperty('--wall-rows', String(rows))

  syncPageRotation(options.restartRotation === true)

  if (lazyEngines && cameraOrder.length && wallLoading?.classList.contains('hidden')) {
    void syncVisibleEngines()
  }
}

function needsPageRotation() {
  const n = cameraOrder.length || tiles.size
  return n > pageSize
}

function syncPageRotation(forceRestart = false) {
  applyPageVisibility()
  updateRotateStat()

  if (wallLoading && !wallLoading.classList.contains('hidden')) {
    return
  }

  if (!needsPageRotation()) {
    stopPageRotate()
    pageIndex = 0
    applyPageVisibility()
    updateRotateStat()
    return
  }

  if (forceRestart || !pageRotateTimer) startPageRotate()
}

function startPageRotate() {
  stopPageRotate()
  pageRotateTimer = setInterval(() => {
    pageIndex = (pageIndex + 1) % totalPages
    applyPageVisibility()
    updateRotateStat()
    if (lazyEngines) void syncVisibleEngines()
  }, getPageRotateMs())
}

function stopPageRotate() {
  if (pageRotateTimer) {
    clearInterval(pageRotateTimer)
    pageRotateTimer = null
  }
}

function startMirror(tile, sourceVideo) {
  stopMirror(tile)
  tile.sourceVideo = sourceVideo
  tile.canvas.style.display = 'block'
  mutePortalVideos(sourceVideo.ownerDocument)
  if (tile.engine) mutePortalVideos(engineDoc(tile.engine))

  let muteTick = 0
  let frameTick = 0
  const frameSkip = lazyEngines ? 3 : 1
  const draw = () => {
    const v = tile.sourceVideo
    if (v && v.readyState >= 2 && v.videoWidth > 0) {
      if (tile.canvas.width !== v.videoWidth) {
        tile.canvas.width = v.videoWidth
        tile.canvas.height = v.videoHeight
      }
      if (frameTick++ % frameSkip === 0) {
        tile.canvas.getContext('2d')?.drawImage(v, 0, 0)
      }
      tile.lastFrameAt = Date.now()
      if (tile.mode !== 'live') {
        setTileMode(tile, 'live')
        updateLiveStat()
        recalcLayout()
      }
      if (muteTick++ % 30 === 0) {
        mutePortalVideos(v.ownerDocument)
        if (tile.engine) mutePortalVideos(engineDoc(tile.engine))
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

function removeTile(devId) {
  const tile = tiles.get(devId)
  if (!tile) return
  stopMirror(tile)
  tile.engine?.remove()
  tile.root.remove()
  tiles.delete(devId)
}

function updateTileMeta(tile, cam) {
  tile.cam = cam
  tile.name = cam.name || cam.devId
  tile.homeName = cam.homeName
  const homeEl = tile.root.querySelector('.tile-meta .home')
  const devEl = tile.root.querySelector('.tile-meta .dev')
  if (homeEl) homeEl.textContent = cam.homeName
  if (devEl) devEl.textContent = cam.name || cam.devId
}

function syncTiles(cameras) {
  const ids = new Set(cameras.map((c) => c.devId))
  for (const devId of [...tiles.keys()]) {
    if (!ids.has(devId)) removeTile(devId)
  }
  cameras.forEach((cam, i) => {
    const existing = tiles.get(cam.devId)
    if (existing) updateTileMeta(existing, cam)
    else createTile(cam, i)
  })
}

function createTile(cam, sortIndex) {
  const root = document.createElement('article')
  root.className = 'tile'
  root.dataset.devId = cam.devId

  const spinner = document.createElement('div')
  spinner.className = 'tile-spinner'
  spinner.innerHTML = `<div class="spinner-border spinner-border-sm text-secondary"></div><span>${t('tileConnecting')}</span>`

  const canvas = document.createElement('canvas')
  const badge = document.createElement('span')
  badge.className = 'tile-badge wait'
  badge.textContent = t('badgeWait')

  const meta = document.createElement('div')
  meta.className = 'tile-meta'
  meta.innerHTML = `<div class="home">${cam.homeName}</div><div class="dev">${cam.name || cam.devId}</div>`

  root.append(spinner, canvas, badge, meta)
  wallGrid.appendChild(root)

  const state = {
    devId: cam.devId,
    name: cam.name || cam.devId,
    homeName: cam.homeName,
    cam,
    sortIndex,
    root,
    canvas,
    badge,
    spinner,
    mode: 'wait',
    engine: null,
    mirrorRAF: 0,
    sourceVideo: undefined,
    lastFrameAt: 0,
    lastRetryAt: 0,
    reconnectAttempts: 0,
    reconnecting: false,
    connectGen: 0,
  }
  tiles.set(cam.devId, state)
  return state
}

function failTile(tile) {
  if (!tile.lastRetryAt) tile.lastRetryAt = Date.now()
  setTileMode(tile, 'err')
}

function setTileMode(tile, mode) {
  tile.mode = mode
  tile.root.classList.toggle('live', mode === 'live')
  tile.badge.className = `tile-badge ${mode === 'live' ? 'live' : mode === 'err' ? 'err' : 'wait'}`
  if (mode === 'live') {
    tile.badge.textContent = t('badgeLive')
  } else if (mode === 'err') {
    tile.badge.textContent = t('badgeNoSignal')
  } else {
    tile.badge.textContent = t('badgeWait')
  }
  tile.spinner.style.display = mode === 'wait' ? 'flex' : 'none'
  if (mode === 'wait' && tile.spinner.querySelector('span')) {
    tile.spinner.querySelector('span').textContent = tile.reconnectAttempts > 0 ? t('tileReconnecting') : t('tileConnecting')
  }
}

function updateLiveStat() {
  const live = [...tiles.values()].filter((tile) => tile.mode === 'live').length
  liveStat.textContent = t('liveCount', { n: live })
  return live
}

async function connectCamera(cam, tile, engineIndex) {
  const connectGen = (tile.connectGen || 0) + 1
  tile.connectGen = connectGen

  function connectAborted() {
    return lazyEngines && (tile.connectGen !== connectGen || !isTileOnVisiblePage(tile))
  }

  if (tile.engine) {
    stopMirror(tile)
    tile.engine.remove()
    tile.engine = null
  }

  const engine = document.createElement('iframe')
  engine.title = `engine-${cam.devId}`
  engine.style.position = 'absolute'
  engine.style.top = `${engineIndex * 720}px`
  engine.style.left = '0'
  engine.setAttribute('allow', 'autoplay; camera')
  enginesRoot.appendChild(engine)
  tile.engine = engine

  engine.src = `/portal/playback?_=${Date.now()}`
  const ready = await waitPortal(engine)
  if (connectAborted()) {
    tearDownTileEngine(tile)
    return false
  }
  if (!ready) {
    failTile(tile)
    return false
  }

  await sleep(PORTAL_BOOT_MS)
  if (connectAborted()) {
    tearDownTileEngine(tile)
    return false
  }

  let doc = engineDoc(engine)
  selectHomeInPortal(doc, cam.homeName)
  await sleep(1200)
  if (connectAborted()) {
    tearDownTileEngine(tile)
    return false
  }

  const loaded = await waitHomeTreeLoaded(doc, cam.homeName)
  const homeTree = loaded.tree

  if (!homeTree || loaded.titles.length === 0) {
    failTile(tile)
    return false
  }

  homeTree.scrollIntoView({ block: 'center', behavior: 'instant' })
  await sleep(1000)
  if (connectAborted()) {
    tearDownTileEngine(tile)
    return false
  }

  const visible = await ensureDeviceVisible(homeTree, cam.name)

  if (!visible) {
    failTile(tile)
    return false
  }

  const clicked = clickCameraInTree(homeTree, cam.name)

  if (!clicked) {
    failTile(tile)
    return false
  }

  doc = engineDoc(engine)
  let ok = await waitVideo(doc, cam.devId, cam.name, 35000)
  if (connectAborted()) {
    tearDownTileEngine(tile)
    return false
  }
  if (!ok) {
    clickCameraInTree(homeTree, cam.name)
    ok = await waitVideo(engineDoc(engine), cam.devId, cam.name, 15000)
  }

  if (connectAborted()) {
    tearDownTileEngine(tile)
    return false
  }

  doc = engineDoc(engine)
  mutePortalVideos(doc)
  const video = findVideo(doc, cam.devId, cam.name)

  if (!video) {
    failTile(tile)
    return false
  }

  mutePortalVideos(doc)
  startMirror(tile, video)
  tile.lastFrameAt = Date.now()
  tile.reconnectAttempts = 0
  return true
}

function isStreamHealthy(tile) {
  const v = tile.sourceVideo
  if (!v) return false
  return v.readyState >= 2 && v.videoWidth > 0
}

function nextEngineIndex() {
  let max = 0
  for (const tile of tiles.values()) {
    if (tile.engine) max += 1
  }
  return max
}

function enqueueReconnect(devId) {
  const tile = tiles.get(devId)
  if (!tile || tile.reconnecting || reconnectPending.has(devId)) return
  if (tile.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return
  if (lazyEngines && !isTileOnVisiblePage(tile)) return
  reconnectPending.add(devId)
  void processReconnectQueue()
}

async function processReconnectQueue() {
  if (reconnectBusy) return
  const devId = reconnectPending.values().next().value
  if (!devId) return

  reconnectPending.delete(devId)
  reconnectBusy = true
  try {
    await reconnectTile(devId)
  } finally {
    reconnectBusy = false
    if (reconnectPending.size) void processReconnectQueue()
  }
}

async function reconnectTile(devId) {
  const tile = tiles.get(devId)
  const cam = cameraMeta.get(devId) || tile?.cam
  if (!tile || !cam) return false
  if (tile.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    failTile(tile)
    return false
  }

  tile.reconnecting = true
  tile.reconnectAttempts += 1
  tile.lastRetryAt = Date.now()
  setTileMode(tile, 'wait')

  const ok = await connectCamera(cam, tile, nextEngineIndex())
  tile.reconnecting = false

  if (!ok) {
    failTile(tile)
    updateLiveStat()
    recalcLayout()
    if (tile.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      setTimeout(() => enqueueReconnect(devId), ERR_RETRY_MS)
    }
  } else {
    updateLiveStat()
    recalcLayout()
  }
  return ok
}

function watchTiles() {
  const now = Date.now()
  for (const tile of tiles.values()) {
    if (tile.reconnecting) continue
    if (lazyEngines && !isTileOnVisiblePage(tile)) continue

    if (tile.mode === 'live') {
      const noFrames = tile.lastFrameAt > 0 && now - tile.lastFrameAt > STALE_MS
      const unhealthy = !isStreamHealthy(tile)
      if (noFrames || unhealthy) enqueueReconnect(tile.devId)
      continue
    }

    if (tile.mode === 'err' && tile.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const sinceRetry = now - (tile.lastRetryAt || 0)
      if (sinceRetry >= ERR_RETRY_MS) enqueueReconnect(tile.devId)
    }
  }
  updateReconnectStat()
}

function startHealthWatch() {
  stopHealthWatch()
  watchTimer = setInterval(watchTiles, WATCH_MS)
}

function stopHealthWatch() {
  if (watchTimer) {
    clearInterval(watchTimer)
    watchTimer = null
  }
  reconnectPending.clear()
  reconnectBusy = false
}

async function bootstrap(force = false) {
  try {
    await bootstrapInner(force)
  } catch (err) {
    const msg = err && err.name === 'AbortError'
      ? t('loadFetchError', { msg: 'timeout' })
      : t('loadFetchError', { msg: (err && err.message) || String(err) })
    showWallError(msg)
  }
}

async function connectCamerasBatch(devIds) {
  let live = 0
  let idx = 0
  for (const devId of devIds) {
    const cam = cameraMeta.get(devId)
    const tile = tiles.get(devId)
    if (!cam || !tile) continue
    connectCurrent = idx + 1
    connectTotal = devIds.length
    updateProgress(live, devIds.length)
    setTileMode(tile, 'wait')
    const ok = await connectCamera(cam, tile, nextEngineIndex())
    if (ok) live += 1
    updateProgress(live, devIds.length)
    updateLiveStat()
    idx += 1
    if (idx < devIds.length) await sleep(getStaggerMs())
  }
  return live
}

function initTvRemote() {
  if (!lazyEngines) return

  refreshBtn?.setAttribute('tabindex', '0')
  totalStat?.setAttribute('tabindex', '0')
  liveStat?.setAttribute('tabindex', '0')
  rotateStat?.setAttribute('tabindex', '0')

  document.addEventListener('keydown', (e) => {
    const code = e.keyCode || e.which
    if (TV_BACK_KEYS.has(code)) {
      e.preventDefault()
      if (rotateStat) {
        const prev = rotateStat.textContent
        rotateStat.textContent = t('tvBackHint')
        setTimeout(() => {
          if (rotateStat.textContent === t('tvBackHint')) updateReconnectStat()
        }, 2500)
      }
      return
    }
    if (e.key === 'Enter' && document.activeElement === refreshBtn) {
      e.preventDefault()
      bootstrap(true)
    }
  })

  setTimeout(() => refreshBtn?.focus(), 300)
}

function initTvPlatform() {
  if (!lazyEngines || !window.MiraTvPlatform) return
  void window.MiraTvPlatform.keepScreenAwake()
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (lazyEngines) {
      for (const tile of tiles.values()) {
        if (!isTileOnVisiblePage(tile)) tearDownTileEngine(tile)
      }
    }
    return
  }
  if (lazyEngines) void syncVisibleEngines()
  initTvPlatform()
})

async function bootstrapInner(force = false) {
  showLoading()
  setLoadingStep(0)

  const { res: statusRes, data: status } = await fetchJson('/api/login/status', {}, 30000)
  if (!statusRes.ok) {
    location.href = '/'
    return
  }
  if (status.state !== 'ready') {
    location.href = '/'
    return
  }
  setLoadingStep(1)

  if (force) {
    stopPageRotate()
    stopHealthWatch()
    for (const tile of tiles.values()) {
      stopMirror(tile)
      tile.engine?.remove()
    }
    enginesRoot.innerHTML = ''
    tiles.clear()
    cameraOrder = []
    cameraMeta.clear()
    pageIndex = 0
  }

  setLoadingStep(2)
  if (loadConnecting) loadConnecting.textContent = t('loadStillListing')

  let listingTimer = null
  if (loadTip) {
    listingTimer = setInterval(() => {
      if (loadConnecting) loadConnecting.textContent = t('loadStillListing')
    }, 8000)
  }

  let camerasRes
  let camerasData
  try {
    const out = await fetchJson('/api/cameras/all', {}, 120000)
    camerasRes = out.res
    camerasData = out.data
  } finally {
    if (listingTimer) clearInterval(listingTimer)
  }

  if (!camerasRes.ok) {
    showWallError(camerasData.message || t('loadFetchError', { msg: camerasRes.status }))
    return
  }

  const cameras = camerasData.cameras || []
  if (!cameras.length) {
    hideLoading()
    wallGrid.innerHTML = `<p class="p-3 text-secondary">${t('noCameras')}</p>`
    totalStat.textContent = t('onlineCount', { n: 0 })
    liveStat.textContent = t('liveCount', { n: 0 })
    return
  }

  cameraOrder = cameras.map((c) => c.devId)
  cameras.forEach((c) => cameraMeta.set(c.devId, c))

  totalStat.textContent = t('onlineCount', { n: cameras.length })
  connectCurrent = 0
  if (loadConnecting) loadConnecting.textContent = ''

  syncTiles(cameras)
  recalcLayout()

  const visibleIds = lazyEngines ? visibleCameraDevIds() : cameras.map((c) => c.devId)
  connectTotal = visibleIds.length
  updateLoadEta(connectTotal)

  setLoadingStep(3)
  let live = 0

  if (lazyEngines) {
    live = await connectCamerasBatch(visibleIds)
  } else {
    let engineIdx = 0
    for (let i = 0; i < cameras.length; i += PARALLEL) {
      const chunk = cameras.slice(i, i + PARALLEL)
      const results = await Promise.all(chunk.map(async (cam) => {
        const tile = tiles.get(cam.devId)
        if (!tile) return false
        connectCurrent = engineIdx + 1
        updateProgress(live, cameras.length)
        setTileMode(tile, 'wait')
        const idx = engineIdx
        engineIdx += 1
        return connectCamera(cam, tile, idx)
      }))
      live += results.filter(Boolean).length
      updateProgress(live, cameras.length)
      updateLiveStat()
      if (i + PARALLEL < cameras.length) await sleep(getStaggerMs())
    }
  }

  loadSteps.forEach((el) => el?.classList.add('done'))
  hideLoading()
  recalcLayout()
  startHealthWatch()
  initTvRemote()
  initTvPlatform()

  for (const tile of tiles.values()) {
    if (tile.mode === 'err' && isTileOnVisiblePage(tile)) enqueueReconnect(tile.devId)
  }
}

bootstrap()

window.addEventListener('beforeunload', () => {
  stopPageRotate()
  stopHealthWatch()
  window.MiraTvPlatform?.releaseScreenAwake()
  for (const tile of tiles.values()) {
    stopMirror(tile)
    tile.engine?.remove()
  }
})
