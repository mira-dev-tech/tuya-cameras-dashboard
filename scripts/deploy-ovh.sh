#!/usr/bin/env bash
# Build mira-cameras no nó OVH + import CRI + apply manifests + rollout.
#
# Uso:
#   ./scripts/deploy-ovh.sh
#   ./scripts/deploy-ovh.sh 1.0.1
#
set -euo pipefail

die() { echo "Erro: $*" >&2; exit 1; }
info() { echo ">> $*"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_HOST="${MIRA_CAMERAS_SSH_HOST:-komputera01}"
TAG="${1:-1.0.0}"
IMAGE="mira-cameras:${TAG}"
REMOTE_DIR="/home/ubuntu/mira-cameras-build"
K='sudo /var/lib/rancher/rke2/bin/kubectl --kubeconfig=/etc/rancher/rke2/rke2.yaml'
CTR='sudo /var/lib/rancher/rke2/bin/ctr -a /run/k3s/containerd/containerd.sock -n k8s.io'

run_remote() {
  ssh "$SSH_HOST" "$@"
}

info "Sincronizar mira-cameras → ${SSH_HOST}:${REMOTE_DIR}…"
ssh "$SSH_HOST" "mkdir -p ${REMOTE_DIR}"
rsync -az --delete \
  --exclude .git \
  "${ROOT}/" "${SSH_HOST}:${REMOTE_DIR}/"

info "Build Docker ${IMAGE} no nó…"
ssh "$SSH_HOST" bash <<REMOTE
set -euo pipefail
cd ${REMOTE_DIR}
sudo docker build -t ${IMAGE} .
sudo docker save ${IMAGE} | ${CTR} images import -
REMOTE

info "Aplicar manifests K8s…"
for f in namespace.yaml deployment.yaml service.yaml ingress.yaml; do
  run_remote "${K} apply -f -" < "${ROOT}/k8s/${f}"
done

info "Rollout deployment mira-cameras…"
run_remote bash <<REMOTE
set -euo pipefail
K='sudo /var/lib/rancher/rke2/bin/kubectl --kubeconfig=/etc/rancher/rke2/rke2.yaml'
\${K} set image deployment/mira-cameras -n mira-cameras mira-cameras=${IMAGE}
\${K} patch deployment mira-cameras -n mira-cameras -p '{"spec":{"template":{"spec":{"containers":[{"name":"mira-cameras","imagePullPolicy":"IfNotPresent"}]}}}}'
\${K} rollout status deployment/mira-cameras -n mira-cameras --timeout=120s
REMOTE

info "Concluído: ${IMAGE}"
echo ""
echo "  DNS: cameras.mira-dev.tech → A 144.217.79.138 (Cloudflare proxied OK)"
echo "  curl -sS https://cameras.mira-dev.tech/healthz"
