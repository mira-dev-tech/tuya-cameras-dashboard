package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/mira-dev-tech/tuya-cameras-dashboard/internal/store"
	"github.com/mira-dev-tech/tuya-cameras-dashboard/internal/tuya"
)

const (
	sessionCookie   = "mira_cam_sid"
	sessionMaxAge   = 30 * 24 * 60 * 60 // 30 days — invalidação real vem do upstream Tuya
	authRecheckTTL  = 5 * time.Minute
)

// Server exposes REST endpoints and serves the UI.
type Server struct {
	store store.Store
}

// NewServer creates the HTTP API layer.
func NewServer(st store.Store) *Server {
	return &Server{store: st}
}

// Register attaches routes to mux.
func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /api/regions", s.handleRegions)
	mux.HandleFunc("POST /api/login/start", s.handleLoginStart)
	mux.HandleFunc("GET /api/login/status", s.handleLoginStatus)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	mux.HandleFunc("GET /api/homes", s.handleHomes)
	mux.HandleFunc("GET /api/devices", s.handleDevices)
	mux.HandleFunc("GET /api/cameras/all", s.handleAllCameras)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.Handle("/portal/", http.HandlerFunc(s.handlePortalProxy))
	mux.HandleFunc("GET /portal", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/portal/playback", http.StatusTemporaryRedirect)
	})
	mux.HandleFunc("/api/", s.handleUpstreamAPI)
	mux.HandleFunc("/global/", s.handleUpstreamGlobal)
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleRegions(w http.ResponseWriter, _ *http.Request) {
	type region struct {
		Code string `json:"code"`
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"regions": []region{
			{Code: "us", Name: "Western America", URL: tuya.BaseURL("us")},
			{Code: "eu", Name: "Europe", URL: tuya.BaseURL("eu")},
		},
		"default": tuya.DefaultRegion,
	})
}

func (s *Server) handleLoginStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Region string `json:"region"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	region := req.Region
	if region == "" {
		region = tuya.DefaultRegion
	}

	client, err := tuya.NewClient(region)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "client", err.Error())
		return
	}
	if err := client.Warmup(); err != nil {
		writeError(w, http.StatusBadGateway, "warmup", err.Error())
		return
	}

	token, err := client.QRToken()
	if err != nil {
		writeError(w, http.StatusBadGateway, "qr_token", err.Error())
		return
	}
	qrImage, err := client.QRExchange(token)
	if err != nil {
		writeError(w, http.StatusBadGateway, "qr_exchange", err.Error())
		return
	}

	sid := newSessionID()
	now := time.Now()
	sess := &store.Session{
		ID:        sid,
		Region:    region,
		Client:    client,
		QRToken:   token,
		QRImage:   qrImage,
		State:     store.StatePending,
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.store.Put(sess)

	go s.pollLogin(sess.ID)

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    sid,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   sessionMaxAge,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"sessionId": sid,
		"region":    region,
		"qrImage":   qrImage,
		"state":     sess.State,
	})
}

func (s *Server) handleLoginStatus(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.sessionFromRequest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "session", "sessão inválida ou expirada")
		return
	}
	if sess.State == store.StateReady && !s.ensureAuth(sess) {
		writeJSON(w, http.StatusOK, map[string]any{
			"state":  sess.State,
			"region": sess.Region,
			"error":  sess.Error,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"state":   sess.State,
		"region":  sess.Region,
		"error":   sess.Error,
		"user":    sess.User,
		"qrImage": sess.QRImage,
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if ck, err := r.Cookie(sessionCookie); err == nil {
		invalidatePortalProxy(ck.Value)
		s.store.Delete(ck.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]string{"status": "logged_out"})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.requireReady(w, r)
	if !ok {
		return
	}
	user, err := sess.Client.UserInfo()
	if err != nil {
		writeError(w, http.StatusBadGateway, "user_info", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) handleHomes(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.requireReady(w, r)
	if !ok {
		return
	}
	homes, err := sess.Client.HomeList()
	if err != nil {
		writeError(w, http.StatusBadGateway, "home_list", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"homes": homes})
}

func (s *Server) handleAllCameras(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.requireReady(w, r)
	if !ok {
		return
	}
	includeOffline := r.URL.Query().Get("all") == "1"
	var (
		cameras []tuya.CameraEntry
		err     error
	)
	if includeOffline {
		cameras, err = sess.Client.AllCameras()
	} else {
		cameras, err = sess.Client.AllOnlineCameras()
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "cameras_all", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"count":   len(cameras),
		"online":  !includeOffline,
		"cameras": cameras,
	})
}

func (s *Server) handleDevices(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.requireReady(w, r)
	if !ok {
		return
	}
	gidStr := r.URL.Query().Get("gid")
	if gidStr == "" {
		writeError(w, http.StatusBadRequest, "gid", "parâmetro gid obrigatório")
		return
	}
	gid, err := strconv.ParseInt(gidStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "gid", "gid inválido")
		return
	}
	devices, err := sess.Client.DeviceList(gid)
	if err != nil {
		writeError(w, http.StatusBadGateway, "device_list", err.Error())
		return
	}
	camerasOnly := r.URL.Query().Get("cameras") == "1"
	if camerasOnly {
		filtered := make([]tuya.Device, 0)
		for _, d := range devices {
			if d.BizType == 6 {
				filtered = append(filtered, d)
			}
		}
		devices = filtered
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"gid":     gid,
		"devices": devices,
	})
}

func (s *Server) requireReady(w http.ResponseWriter, r *http.Request) (*store.Session, bool) {
	sess, ok := s.sessionFromRequest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "session", "sessão inválida ou expirada")
		return nil, false
	}
	if sess.State != store.StateReady {
		writeError(w, http.StatusUnauthorized, "login", "faça login via QR code primeiro")
		return nil, false
	}
	if !s.ensureAuth(sess) {
		writeError(w, http.StatusUnauthorized, "login", sess.Error)
		return nil, false
	}
	return sess, true
}

func (s *Server) ensureAuth(sess *store.Session) bool {
	if sess.State != store.StateReady || sess.Client == nil {
		return false
	}
	if time.Since(sess.AuthCheckedAt) < authRecheckTTL {
		return true
	}
	user, err := sess.Client.UserInfo()
	if err != nil {
		sess.State = store.StateExpired
		if sess.Error == "" {
			sess.Error = "Sessão expirada — faça login novamente"
		}
		s.store.Put(sess)
		invalidatePortalProxy(sess.ID)
		return false
	}
	sess.User = user
	sess.AuthCheckedAt = time.Now()
	s.store.Put(sess)
	return true
}

func (s *Server) sessionFromRequest(r *http.Request) (*store.Session, bool) {
	ck, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil, false
	}
	sess, ok := s.store.Get(ck.Value)
	if !ok {
		return nil, false
	}
	return sess, true
}

func (s *Server) pollLogin(sessionID string) {
	deadline := time.Now().Add(5 * time.Minute)
	for time.Now().Before(deadline) {
		sess, ok := s.store.Get(sessionID)
		if !ok {
			return
		}
		poll, err := sess.Client.PollLogin(sess.QRToken)
		sess.UpdatedAt = time.Now()
		if err != nil {
			sess.State = store.StateError
			sess.Error = err.Error()
			s.store.Put(sess)
			return
		}
		if poll != nil {
			user, uerr := sess.Client.UserInfo()
			if uerr != nil {
				log.Printf("poll ok mas user info falhou: %v", uerr)
				s.store.Put(sess)
				time.Sleep(3 * time.Second)
				continue
			}
			sess.State = store.StateReady
			sess.User = user
			sess.AuthCheckedAt = time.Now()
			s.store.Put(sess)
			return
		}
		time.Sleep(3 * time.Second)
	}
	sess, ok := s.store.Get(sessionID)
	if !ok {
		return
	}
	sess.State = store.StateExpired
	sess.Error = "QR code expirou — clique em Atualizar"
	s.store.Put(sess)
}

func newSessionID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}
