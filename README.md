# Tuya Cameras Dashboard

**Live camera wall for the Tuya SmartLife IPC Terminal (security-wisdom platform).**

[![Live demo](https://img.shields.io/badge/demo-cameras.mira--dev.tech-orange?style=for-the-badge)](https://cameras.mira-dev.tech)

> **Try it:** [https://cameras.mira-dev.tech](https://cameras.mira-dev.tech) — scan the QR code with the SmartLife / Tuya Smart app (same account as your cameras).

Tuya Cameras Dashboard is a self-hosted web app that authenticates against Tuya's **new IPC Terminal** (`protect-*.ismartlife.me`), lists your homes and cameras, and exposes a **multi-camera live wall** through a same-origin proxy to Tuya's WebRTC player.

Built by **[Mirá Dev](https://mira-dev.tech)** · Source: [github.com/mira-dev-tech/tuya-cameras-dashboard](https://github.com/mira-dev-tech/tuya-cameras-dashboard)

---

## Any Tuya account

This dashboard is **account-agnostic**. Nothing in the repository hardcodes home names, device IDs, or camera counts:

| Data | Source |
|------|--------|
| Homes / groups | Tuya `homeList` API for the logged-in account |
| Cameras (wall) | Tuya `roomList` per home — online devices with category **`sp`** (security IPC) |
| Cameras (browser) | Tuya `device/sort/list` — entries with **`bizType 6`** |
| UI labels | Device `name`, `devId`, and `homeName` from API responses at runtime |

After QR login with SmartLife / Tuya Smart, the app lists **all** homes linked to that account and builds the wall dynamically. Session files under `.data/` (gitignored) are per-operator runtime state, not part of the source code.

The loading screen estimates wait time from the **actual camera count** returned by `GET /api/cameras/all`, not a fixed number.

---

## Features

| Feature | Description |
|---------|-------------|
| **QR login** | No password stored — authenticate once via SmartLife/Tuya Smart mobile app |
| **Multi-home** | Lists cameras across all homes linked to your account |
| **Online filter** | Wall shows **online** cameras by default (`roomList` API) |
| **Live wall** | Grid UI with per-tile status, loading steps, and stream mirroring |
| **IPC proxy** | Same-origin `/portal/*` proxy so the official Tuya player runs under your domain |
| **Session persistence** | Cookie `mira_cam_sid` + optional disk store (`MIRA_CAMERAS_DATA`) |
| **Logout** | Clears local session via `POST /api/logout` |

## Screenshots & pages

| URL | Purpose |
|-----|---------|
| `/` | QR login + device browser |
| `/wall.html` | Multi-camera live wall (primary UI) |
| `/live.html` | Single IPC player with sidebar and auto-reconnect |

## Architecture

```text
Browser
  ├── Static UI (embedded `web/`)
  ├── REST API (`/api/*`)     → Go server → Tuya IPC Terminal API
  └── Portal proxy (`/portal/*`) → upstream protect-{us|eu}.ismartlife.me
        └── WebRTC player (Tuya OS_IPC_WEB + WASM) — proprietary stack
```

Login flow (mirrors the official portal):

1. `POST /api/login/security/QCtoken`
2. `POST /api/login/exchange` with `tuyaSmart--qrLogin?token=…`
3. Poll `POST /api/login/poll` every ~3s until the mobile app confirms
4. Upstream session cookies (`uid`, `clientId`) are stored server-side only

## Upstream platform

| Region | Host | Default |
|--------|------|---------|
| US | `https://protect-us.ismartlife.me` | yes |
| EU | `https://protect-eu.ismartlife.me` | |

The legacy `ipc-*.ismartlife.me` portal is being retired (Tuya migration to security-wisdom).

## Quick start (local)

**Requirements:** Go 1.22+

```bash
git clone https://github.com/mira-dev-tech/tuya-cameras-dashboard.git
cd tuya-cameras-dashboard

go run .
# open http://localhost:8080
```

Custom listen address and data directory:

```bash
LISTEN_ADDR=":8787" MIRA_CAMERAS_DATA=".data" go run .
```

### Docker

```bash
docker build -t tuya-cameras-dashboard .
docker run --rm -p 8080:8080 -v tuya-cameras-data:/app/.data tuya-cameras-dashboard
```

## API reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/healthz` | no | Health check |
| `GET` | `/api/regions` | no | Available data centers |
| `POST` | `/api/login/start` | no | Start QR login (`{"region":"us"}`) |
| `GET` | `/api/login/status` | cookie | Session state |
| `POST` | `/api/logout` | cookie | End session |
| `GET` | `/api/homes` | yes | List homes |
| `GET` | `/api/cameras/all` | yes | Online cameras (all homes) |
| `GET` | `/api/cameras/all?all=1` | yes | Include offline devices |
| `GET` | `/portal/*` | yes | Authenticated reverse proxy to IPC Terminal |

Session cookie: **`mira_cam_sid`** (HttpOnly, 30-day max-age; actual validity depends on Tuya upstream).

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LISTEN_ADDR` | `:8080` | HTTP listen address |
| `MIRA_CAMERAS_DATA` | `.data` | Directory for persisted sessions (`sessions.json`) |

## Security & privacy

This project is designed for **public source release**:

- **No secrets in git** — `.data/`, `.env`, and session files are gitignored
- **No credentials in the UI** — login is QR-only; upstream cookies never reach the browser
- **Self-hosted** — you control where session data is stored
- **Do not commit** `sessions.json`, API keys, or private deployment credentials

Report security issues via [GitHub Security Advisories](https://github.com/mira-dev-tech/tuya-cameras-dashboard/security/advisories/new) (see [SECURITY.md](SECURITY.md)).

## Known limitations

- **Tuya WebRTC is proprietary** — live video uses the official portal player via proxy, not a custom RTSP/HLS pipeline
- **Official portal grid** — Tuya's UI shows up to **4 simultaneous feeds per home** (2×2)
- **Multi-camera wall** — experimental; spawning many portal instances is CPU/network intensive
- **Session lifetime** — server restart clears sessions unless `MIRA_CAMERAS_DATA` points to persistent storage
- **Not affiliated with Tuya** — unofficial integration; subject to upstream API changes

## Contributing

We welcome improvements, but **all changes must be reviewed and approved by maintainers before merge**.

1. Read [CONTRIBUTING.md](CONTRIBUTING.md)
2. Open an issue to discuss larger changes
3. Fork → branch → pull request
4. Wait for maintainer review — do not merge your own PR

Direct pushes to `main` are reserved for maintainers.

## License

Copyright © [Mirá Dev](https://mira-dev.tech). All rights reserved unless a license file is added by the maintainers.

---

**Suggested GitHub repository description:**

```text
Live multi-camera wall for Tuya SmartLife IPC Terminal (QR login, WebRTC proxy). Demo: https://cameras.mira-dev.tech
```
