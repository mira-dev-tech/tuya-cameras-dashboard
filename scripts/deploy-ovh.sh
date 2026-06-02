#!/usr/bin/env bash
# Build tuya-cameras-dashboard on OVH node + CRI import + apply manifests + rollout.
#
# Uso:
#   ./scripts/deploy-ovh.sh
#   ./scripts/deploy-ovh.sh 1.0.1
#
set -euo pipefail

die() { echo "Erro: $*" >&2; exit 1; }
info() { echo ">> $*"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_HOST="${MIRA_CAMERAS_SSH_HOST:?Set MIRA_CAMERAS_SSH_HOST to your Kubernetes build node (SSH alias or user@host)}"
TAG="${1:-1.0.0}"
IMAGE="tuya-cameras-dashboard:${TAG}"
REMOTE_DIR="/home/ubuntu/tuya-cameras-dashboard-build"
K='sudo /var/lib/rancher/rke2/bin/kubectl --kubeconfig=/etc/rancher/rke2/rke2.yaml'
CTR='sudo /var/lib/rancher/rke2/bin/ctr -a /run/k3s/containerd/containerd.sock -n k8s.io'

run_remote() {
  ssh "$SSH_HOST" "$@"
}

info "Sync tuya-cameras-dashboard → ${SSH_HOST}:${REMOTE_DIR}…"
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

info "Rollout deployment mira-cameras (image ${IMAGE})…"
run_remote bash <<REMOTE
set -euo pipefail
K='sudo /var/lib/rancher/rke2/bin/kubectl --kubeconfig=/etc/rancher/rke2/rke2.yaml'
\${K} set image deployment/mira-cameras -n mira-cameras mira-cameras=${IMAGE}
\${K} patch deployment mira-cameras -n mira-cameras -p '{"spec":{"template":{"spec":{"containers":[{"name":"mira-cameras","imagePullPolicy":"IfNotPresent"}]}}}}'
\${K} rollout status deployment/mira-cameras -n mira-cameras --timeout=120s
REMOTE

info "Concluído: ${IMAGE}"
echo ""
echo "  Demo: https://cameras.mira-dev.tech"
echo "  curl -sS https://cameras.mira-dev.tech/healthz"
