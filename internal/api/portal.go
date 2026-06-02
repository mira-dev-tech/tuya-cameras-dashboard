package api

import (
	"net/http"
	"strings"
	"sync"

	"github.com/mira-dev-tech/mira-cameras/internal/store"
	"github.com/mira-dev-tech/mira-cameras/internal/tuya"
)

var portalProxyCache sync.Map

var internalAPIPaths = map[string]struct{}{
	"/api/regions":      {},
	"/api/login/start":  {},
	"/api/login/status": {},
	"/api/logout":       {},
	"/api/homes":        {},
	"/api/devices":      {},
	"/api/cameras/all":  {},
	"/api/me":           {},
}

func (s *Server) handlePortalProxy(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.requireReady(w, r)
	if !ok {
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/portal") {
		http.NotFound(w, r)
		return
	}
	proxy := portalProxyFor(sess)
	proxy.ServeHTTP(w, r)
}

func (s *Server) handleUpstreamAPI(w http.ResponseWriter, r *http.Request) {
	if _, internal := internalAPIPaths[r.URL.Path]; internal {
		http.NotFound(w, r)
		return
	}
	sess, ok := s.requireReady(w, r)
	if !ok {
		return
	}
	sess.Client.ForwardRequest(w, r)
}

func (s *Server) handleUpstreamGlobal(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.requireReady(w, r)
	if !ok {
		return
	}
	sess.Client.ForwardRequest(w, r)
}

func portalProxyFor(sess *store.Session) http.Handler {
	if cached, ok := portalProxyCache.Load(sess.ID); ok {
		return cached.(http.Handler)
	}
	proxy := tuya.PortalProxy(sess.Client)
	portalProxyCache.Store(sess.ID, proxy)
	return proxy
}

func invalidatePortalProxy(sessionID string) {
	portalProxyCache.Delete(sessionID)
}
