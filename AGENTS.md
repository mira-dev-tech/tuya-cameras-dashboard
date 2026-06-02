# AGENTS.md — Tuya Cameras Dashboard

Guia para agentes de IA e operadores que trabalham no repositório público **`tuya-cameras-dashboard`** ([github.com/mira-dev-tech/tuya-cameras-dashboard](https://github.com/mira-dev-tech/tuya-cameras-dashboard)).

Demo público: **https://cameras.mira-dev.tech**

---

## Deploy — regra obrigatória

**Nunca fazer deploy em produção sem aprovação explícita do operador.**

| Acção | Permitido sem pedido? |
|-------|------------------------|
| Editar código, docs, testes locais | **Sim** |
| `go run .` / Docker local (`localhost`) | **Sim** |
| Commit ou push para GitHub | **Só se o operador pedir** |
| SSH no cluster, `kubectl apply`, rollout, build no nó OVH | **Não** |
| Alterar DNS, ingress, secrets ou imagem em produção | **Não** |
| Executar qualquer script de deploy (mesmo que exista localmente) | **Não** |

Quando o operador pedir deploy, confirmar **tag/versão** e **ambiente** antes de executar.

> Configuração de infraestructure (Kubernetes, scripts OVH, hostnames internos) **não pertence** a este repo público — mantém-se em repositórios privados da Mirá Dev.

---

## Escopo do repositório

Este repo contém apenas:

- API Go (`internal/`)
- Frontend embarcado (`web/`)
- `Dockerfile` genérico para self-hosting
- Documentação pública (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`)

**Não incluir** no git público: IPs, hostnames de cluster, kubeconfig, scripts SSH, manifests K8s de produção, secrets ou dados de sessão (`.data/`).

---

## Desenvolvimento local

```bash
cd tuya-cameras-dashboard   # ou mira-cameras (clone local)
LISTEN_ADDR=":8787" go run .
# http://127.0.0.1:8787/
```

Sessões locais em `.data/sessions.json` (gitignored).

---

## Contribuições

- PRs exigem aprovação de maintainer ([`CODEOWNERS`](.github/CODEOWNERS))
- Ver [`CONTRIBUTING.md`](CONTRIBUTING.md)

---

## O que agentes NÃO devem fazer

- Deploy automático ou “só validar em prod” sem o operador pedir
- Commitar `.data/`, `.env`, cookies ou credenciais Tuya
- Reintroduzir referências ao cluster Kuberts neste repo público
- Editar repos vizinhos (`Connect/`, `cluster-kuberts/`) a partir deste workspace — cada um tem o seu `AGENTS.md`
