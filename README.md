# Mira Cameras

Proxy web para login QR e listagem de câmeras na **nova plataforma IPC Terminal** (Tuya `security-wisdom`).

Hospedagem: **https://cameras.mira-dev.tech**

## Plataforma upstream

| Região | Host |
|--------|------|
| US (default) | `https://protect-us.ismartlife.me` |
| EU | `https://protect-eu.ismartlife.me` |

Substitui o portal legado `ipc-*.ismartlife.me` (descontinua em 30/06/2026).

### Fluxo de login

1. `POST /api/login/security/QCtoken`
2. `POST /api/login/exchange` com `tuyaSmart--qrLogin?token=…`
3. Poll `POST /api/login/poll` a cada 3 s até o app confirmar
4. Sessão upstream via cookies `uid` + `clientId`

## API local

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/healthz` | Health check |
| GET | `/api/regions` | Regiões disponíveis |
| POST | `/api/login/start` | Gera QR (`{"region":"us"}`) |
| GET | `/api/login/status` | Estado da sessão |
| POST | `/api/logout` | Encerra sessão |
| GET | `/api/homes` | Lista casas (requer login) |
| GET | `/api/devices?gid=…&cameras=1` | Dispositivos da casa |

Cookie de sessão: `mira_cam_sid` (HttpOnly).

## Desenvolvimento local

```bash
go run .
# http://localhost:8080
```

## Deploy (komputera01)

```bash
chmod +x scripts/deploy-ovh.sh
./scripts/deploy-ovh.sh 1.0.0
```

## DNS

Criar registo **A** `cameras.mira-dev.tech` → `144.217.79.138` na Cloudflare (proxied).

TLS via cert-manager (`letsencrypt-prod`).

## Limitações v1

- Sessões em memória (reinício do pod = novo login)
- Nomes das câmeras vêm via MQTT no portal original; aqui listamos `bizId` + `bizType`
- Streaming de vídeo não implementado

## Repositório

Infra Kuberts: [`cluster-kuberts`](https://github.com/mira-dev/cluster-kuberts) — este repo é independente.
