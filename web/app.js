const loginPanel = document.getElementById('loginPanel')
const dashboardPanel = document.getElementById('dashboardPanel')
const qrContainer = document.getElementById('qrContainer')
const loginStatus = document.getElementById('loginStatus')
const regionSelect = document.getElementById('regionSelect')
const regionBadge = document.getElementById('regionBadge')
const refreshBtn = document.getElementById('refreshBtn')
const logoutBtn = document.getElementById('logoutBtn')
const homeList = document.getElementById('homeList')
const deviceList = document.getElementById('deviceList')
const userName = document.getElementById('userName')
const camerasOnly = document.getElementById('camerasOnly')

let pollTimer = null
let selectedGid = null

const handleRefresh = () => startLogin()
const handleLogout = async () => {
  stopPoll()
  await fetch('/api/logout', { method: 'POST' })
  showLogin()
  startLogin()
}
const handleCamerasToggle = () => {
  if (selectedGid) loadDevices(selectedGid)
}

refreshBtn.addEventListener('click', handleRefresh)
logoutBtn.addEventListener('click', handleLogout)
camerasOnly.addEventListener('change', handleCamerasToggle)

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function showLogin() {
  loginPanel.classList.remove('d-none')
  dashboardPanel.classList.add('d-none')
}

function showDashboard(user) {
  loginPanel.classList.add('d-none')
  dashboardPanel.classList.remove('d-none')
  userName.textContent = user?.nickname || user?.userName || 'usuário'
}

async function startLogin() {
  stopPoll()
  loginStatus.textContent = 'Gerando QR code…'
  qrContainer.innerHTML = '<div class="spinner-border text-secondary" role="status"></div>'

  const region = regionSelect.value
  regionBadge.textContent = region.toUpperCase()

  const res = await fetch('/api/login/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ region }),
  })
  const data = await res.json()
  if (!res.ok) {
    loginStatus.textContent = data.message || 'Erro ao gerar QR'
    return
  }

  qrContainer.innerHTML = `<img src="${data.qrImage}" alt="QR code login">`
  loginStatus.textContent = 'Escaneie o QR no app SmartLife…'

  pollTimer = setInterval(() => pollStatus(), 2500)
}

async function pollStatus() {
  const res = await fetch('/api/login/status')
  const data = await res.json()
  if (!res.ok) return

  if (data.state === 'ready') {
    stopPoll()
    showDashboard(data.user)
    await loadHomes()
    return
  }
  if (data.state === 'expired' || data.state === 'error') {
    stopPoll()
    loginStatus.textContent = data.error || 'QR expirou — clique em Atualizar'
  }
}

async function loadHomes() {
  homeList.innerHTML = '<div class="p-3 small muted">Carregando…</div>'
  const res = await fetch('/api/homes')
  const data = await res.json()
  if (!res.ok) {
    homeList.innerHTML = `<div class="p-3 text-danger small">${data.message}</div>`
    return
  }

  homeList.innerHTML = ''
  data.homes.forEach((home) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'list-group-item list-group-item-action bg-dark text-light border-secondary'
    btn.textContent = home.name
    btn.addEventListener('click', () => selectHome(home.gid, btn))
    homeList.appendChild(btn)
  })

  if (data.homes.length > 0) {
    homeList.firstChild?.click()
  }
}

function selectHome(gid, btn) {
  selectedGid = gid
  homeList.querySelectorAll('button').forEach((el) => {
    el.classList.remove('active')
  })
  btn.classList.add('active')
  loadDevices(gid)
}

async function loadDevices(gid) {
  deviceList.innerHTML = '<p class="p-3 muted small mb-0">Carregando…</p>'
  const cameras = camerasOnly.checked ? '1' : '0'
  const res = await fetch(`/api/devices?gid=${gid}&cameras=${cameras}`)
  const data = await res.json()
  if (!res.ok) {
    deviceList.innerHTML = `<p class="p-3 text-danger small">${data.message}</p>`
    return
  }

  if (!data.devices.length) {
    deviceList.innerHTML = '<p class="p-3 muted small mb-0">Nenhum dispositivo nesta casa</p>'
    return
  }

  deviceList.innerHTML = data.devices.map((d) => `
    <div class="device-row p-3">
      <div class="fw-semibold">${d.bizId}</div>
      <div class="small muted">bizType ${d.bizType} · room ${d.roomId}</div>
    </div>
  `).join('')
}

async function bootstrap() {
  const statusRes = await fetch('/api/login/status')
  if (statusRes.ok) {
    const status = await statusRes.json()
    if (status.state === 'ready') {
      showDashboard(status.user)
      await loadHomes()
      return
    }
  }
  showLogin()
  startLogin()
}

bootstrap()
