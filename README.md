# Mira Cameras

**Live camera wall for the Tuya SmartLife IPC Terminal (security-wisdom platform).**

[![Live demo](https://img.shields.io/badge/demo-cameras.mira--dev.tech-orange?style=for-the-badge)](https://cameras.mira-dev.tech)

> **Try it:** [https://cameras.mira-dev.tech](https://cameras.mira-dev.tech) — scan the QR code with the SmartLife / Tuya Smart app (same account as your cameras).

Mira Cameras is a self-hosted web app that authenticates against Tuya's **new IPC Terminal** (`protect-*.ismartlife.me`), lists your homes and cameras, and exposes a **multi-camera live wall** through a same-origin proxy to Tuya's WebRTC player.

Built by **[Mirá Dev](https://mira-dev.tech)** · Source: [github.com/mira-dev-tech/mira-cameras](https://github.com/mira-dev-tech/mira-cameras)

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
git clone https://github.com/mira-dev-tech/mira-cameras.git
cd mira-cameras

go run .
# open http://localhost:8080
```

Custom listen address and data directory:

```bash
LISTEN_ADDR=":8787" MIRA_CAMERAS_DATA=".data" go run .
```

### Docker

```bash
docker build -t mira-cameras .
docker run --rm -p 8080:8080 -v mira-cameras-data:/app/.data mira-cameras
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

## Kubernetes (optional)

Example manifests are in [`k8s/`](k8s/). Adjust `nodeSelector`, ingress host, and image tag for your cluster.

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

For a single-node workflow (build on the node + import to containerd), see [`scripts/deploy-ovh.sh`](scripts/deploy-ovh.sh). **Set `MIRA_CAMERAS_SSH_HOST`** to your build host — no internal hostnames are hard-coded.

## Security & privacy

This project is designed for **public source release**:

- **No secrets in git** — `.data/`, `.env`, and session files are gitignored
- **No credentials in the UI** — login is QR-only; upstream cookies never reach the browser
- **Self-hosted** — you control where session data is stored
- **Do not commit** `sessions.json`, API keys, or production kubeconfig files

Report security issues via [GitHub Security Advisories](https://github.com/mira-dev-tech/mira-cameras/security/advisories/new) (see [SECURITY.md](SECURITY.md)).

## Known limitations

- **Tuya WebRTC is proprietary** — live video uses the official portal player via proxy, not a custom RTSP/HLS pipeline
- **Official portal grid** — Tuya's UI shows up to **4 simultaneous feeds per home** (2×2)
- **Multi-camera wall** — experimental; spawning many portal instances is CPU/network intensive
- **Session lifetime** — pod restart clears in-memory state unless `MIRA_CAMERAS_DATA` is on a persistent volume
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

## Related projects

- [cluster-kuberts](https://github.com/mira-dev/cluster-kuberts) — Kubernetes infrastructure (separate repo)

---

**Suggested GitHub repository description:**

```text
Live multi-camera wall for Tuya SmartLife IPC Terminal (QR login, WebRTC proxy). Demo: https://cameras.mira-dev.tech
```
