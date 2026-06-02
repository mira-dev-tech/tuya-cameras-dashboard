const params = new URLSearchParams(location.search)
const homeName = params.get('home') || ''
const deviceName = params.get('name') || ''
const devId = params.get('devId') || ''

const waitEl = document.getElementById('wait')
const statusEl = document.getElementById('status')
const canvas = document.getElementById('out')
const engine = document.getElementById('engine')
const ctx = canvas.getContext('2d')

const t = (k, v) => MiraI18n.t(k, v)

let hasFrame = false
let attempts = 0

MiraI18n.initLangSelect()
MiraI18n.onChange(() => {
  MiraI18n.apply(document)
  if (statusEl && statusEl.textContent) {
    /* keep dynamic status during connect */
  }
})
MiraI18n.apply(document)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text
}

function engineDoc() {
  try {
    return engine.contentDocument
  } catch (_) {
    return null
  }
}

function expandDeviceTree(doc) {
  doc.querySelectorAll('.ant-tree-switcher_close').forEach((el) => el.click())
}

function selectHome(doc, name) {
  if (!name) return false
  const items = [...doc.querySelectorAll('[class*="homelist"] span, [class*="homelist"] div, [class*="home_name"]')]
  const match = items.find((el) => {
    const txt = (el.textContent || '').trim()
    return txt === name && el.children.length === 0
  })
  if (match) {
    match.click()
    return true
  }
  return clickExactText(doc, name)
}

function clickExactText(doc, text) {
  const nodes = [...doc.querySelectorAll('.ant-tree-title, span, div')]
  const match = nodes.find((el) => {
    const txt = (el.textContent || '').trim()
    return txt === text && el.children.length === 0
  })
  if (match) {
    match.click()
    return true
  }
  return false
}

function clickCameraInTree(doc, name) {
  if (!name) return false
  const titles = [...doc.querySelectorAll('.ant-tree-title')]
  const match = titles.find((el) => (el.textContent || '').trim() === name)
  if (!match) return false
  match.click()
  return true
}

function findVideo(doc) {
  if (!doc) return null
  const videos = [...doc.querySelectorAll('video')].filter((v) => v.videoWidth > 0 && v.readyState >= 2)
  if (!videos.length) return null

  for (const video of videos) {
    let el = video
    for (let depth = 0; depth < 14; depth += 1) {
      el = el.parentElement
      if (!el) break
      const html = el.outerHTML || ''
      const text = el.textContent || ''
      if ((devId && html.includes(devId)) || (deviceName && text.includes(deviceName))) {
        return video
      }
    }
  }
  return videos[0]
}

function portalReady() {
  const doc = engineDoc()
  if (!doc) return false
  const text = doc.body?.innerText || ''
  if (/does not exist|deleted|404/i.test(text)) return false
  return doc.readyState === 'complete' && text.includes('SmartLife')
}

async function waitPortal(timeoutMs = 30000) {
  await new Promise((resolve) => {
    engine.addEventListener('load', resolve, { once: true })
    setTimeout(resolve, timeoutMs)
  })
  for (let i = 0; i < 50; i += 1) {
    if (portalReady()) return true
    await sleep(400)
  }
  return portalReady()
}

function drawLoop() {
  const doc = engineDoc()
  const video = findVideo(doc)
  if (video) {
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
    }
    try {
      ctx.drawImage(video, 0, 0)
      if (!hasFrame) {
        hasFrame = true
        waitEl.style.display = 'none'
        setStatus('')
      }
    } catch (_) {
      /* tainted ou frame vazio */
    }
  }
  requestAnimationFrame(drawLoop)
}

async function waitForVideo(doc, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (findVideo(doc)) return true
    await sleep(500)
  }
  return false
}

async function connect() {
  if (!devId) {
    setStatus(t('camNoDevId'))
    return
  }

  setStatus(t('camLoadingPlayer'))
  engine.src = `/portal/playback?_=${Date.now()}`
  const ok = await waitPortal()
  if (!ok) {
    setStatus(t('camPlayerUnavailable'))
    return
  }

  setStatus(t('camPreparingTree'))
  await sleep(8000)

  const doc = engineDoc()
  if (!doc) {
    setStatus(t('camPlayerError'))
    return
  }

  if (homeName) {
    setStatus(t('camHomeStatus', { name: homeName }))
    selectHome(doc, homeName)
    await sleep(3500)
    expandDeviceTree(engineDoc())
    await sleep(1200)
  } else {
    expandDeviceTree(doc)
    await sleep(1200)
  }

  setStatus(t('camOpening', { name: deviceName || devId }))
  if (!clickCameraInTree(engineDoc(), deviceName)) {
    expandDeviceTree(engineDoc())
    await sleep(800)
    if (!clickCameraInTree(engineDoc(), deviceName)) {
      setStatus(t('camNotFound'))
      return
    }
  }

  drawLoop()

  let gotVideo = await waitForVideo(engineDoc(), 25000)
  while (!gotVideo && attempts < 4) {
    attempts += 1
    setStatus(t('camReconnecting', { current: attempts, max: 4 }))
    clickCameraInTree(engineDoc(), deviceName)
    await sleep(6000)
    gotVideo = await waitForVideo(engineDoc(), 12000)
  }

  if (!gotVideo) {
    setStatus(t('camNoImage'))
    waitEl.style.display = 'flex'
  }
}

connect()
