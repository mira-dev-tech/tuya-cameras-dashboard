/**
 * Smart TV platform helpers — wake lock, screensaver APIs, NoSleep fallback.
 * Loaded only in TV context; safe no-op elsewhere.
 */
(function () {
  'use strict'

  /** @type {WakeLockSentinel|null} */
  let wakeLock = null
  /** @type {HTMLVideoElement|null} */
  let nosleepVideo = null
  /** @type {string|null} */
  let webosReqId = null
  let active = false

  function tryWakeLock() {
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
      return Promise.resolve(false)
    }
    return navigator.wakeLock.request('screen').then((wl) => {
      wakeLock = wl
      wl.addEventListener('release', () => {
        wakeLock = null
      })
      return true
    }).catch(() => false)
  }

  function tryWebOSScreenSaver() {
    try {
      if (typeof window.WebOSServiceBridge === 'undefined') return false
      const bridge = window.WebOSServiceBridge
      webosReqId = 'mira-cameras-' + String(Date.now())
      bridge.call(
        'luna://com.webos.service.tvpower',
        JSON.stringify({
          id: webosReqId,
          subscribe: false,
          method: 'registerScreenSaverRequest',
          parameters: { keepAlive: true },
        }),
        function () {},
        function () {},
      )
      return true
    } catch (_) {
      return false
    }
  }

  function unregisterWebOSScreenSaver() {
    if (!webosReqId || typeof window.WebOSServiceBridge === 'undefined') return
    try {
      window.WebOSServiceBridge.call(
        'luna://com.webos.service.tvpower',
        JSON.stringify({
          id: webosReqId + '-off',
          subscribe: false,
          method: 'unregisterScreenSaverRequest',
          parameters: { clientId: webosReqId },
        }),
        function () {},
        function () {},
      )
    } catch (_) {
      /* ignore */
    }
    webosReqId = null
  }

  function tryTizenScreenSaver() {
    try {
      const apis = window.webapis
      if (!apis || !apis.appcommon || typeof apis.appcommon.setScreenSaver !== 'function') {
        return false
      }
      apis.appcommon.setScreenSaver(0)
      return true
    } catch (_) {
      return false
    }
  }

  function fallbackNoSleepVideo() {
    if (nosleepVideo) {
      return nosleepVideo.play().then(() => true).catch(() => false)
    }
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    const ctx = canvas.getContext('2d')
    let tick = 0
    const animate = () => {
      if (!ctx) return
      ctx.fillStyle = tick++ % 2 ? '#000000' : '#000001'
      ctx.fillRect(0, 0, 2, 2)
      requestAnimationFrame(animate)
    }
    animate()

    let stream = null
    if (typeof canvas.captureStream === 'function') {
      stream = canvas.captureStream(1)
    }

    const video = document.createElement('video')
    video.setAttribute('playsinline', '')
    video.setAttribute('muted', '')
    video.muted = true
    video.loop = true
    video.style.cssText = 'position:fixed;width:2px;height:2px;left:0;top:0;opacity:0.01;pointer-events:none;z-index:9999'
    if (stream) {
      video.srcObject = stream
    }
    document.body.appendChild(video)
    nosleepVideo = video
    return video.play().then(() => true).catch(() => false)
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {})
      wakeLock = null
    }
  }

  function stopNoSleep() {
    if (nosleepVideo) {
      nosleepVideo.pause()
      nosleepVideo.remove()
      nosleepVideo = null
    }
  }

  async function keepScreenAwake() {
    if (active) return
    active = true
    await tryWakeLock()
    tryWebOSScreenSaver()
    tryTizenScreenSaver()
    await fallbackNoSleepVideo()
  }

  function releaseScreenAwake() {
    active = false
    releaseWakeLock()
    unregisterWebOSScreenSaver()
    stopNoSleep()
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && active) {
      void tryWakeLock()
    }
  })

  window.addEventListener('beforeunload', releaseScreenAwake)

  window.MiraTvPlatform = {
    keepScreenAwake,
    releaseScreenAwake,
  }
})()
