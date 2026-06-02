package store

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/mira-dev-tech/tuya-cameras-dashboard/internal/tuya"
)

type persistedFile struct {
	Version  int                `json:"version"`
	Sessions []persistedSession `json:"sessions"`
}

type persistedSession struct {
	ID        string            `json:"id"`
	Region    string            `json:"region"`
	State     LoginState        `json:"state"`
	Error     string            `json:"error,omitempty"`
	User      map[string]any    `json:"user,omitempty"`
	QRToken   string            `json:"qrToken,omitempty"`
	QRImage   string            `json:"qrImage,omitempty"`
	Cookies   []tuya.StoredCookie `json:"cookies,omitempty"`
	CreatedAt time.Time         `json:"createdAt"`
	UpdatedAt time.Time         `json:"updatedAt"`
}

// FileStore keeps sessions in memory and persists them to disk.
type FileStore struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	path     string
}

// NewFileStore loads sessions from disk (creates data dir if needed).
func NewFileStore(dataDir string) (*FileStore, error) {
	if dataDir == "" {
		dataDir = ".data"
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("mkdir data dir: %w", err)
	}
	s := &FileStore{
		sessions: make(map[string]*Session),
		path:     filepath.Join(dataDir, "sessions.json"),
	}
	if err := s.loadFromDisk(); err != nil {
		return nil, err
	}
	go s.cleanupLoop()
	return s, nil
}

func (s *FileStore) Put(sess *Session) {
	s.mu.Lock()
	sess.UpdatedAt = time.Now()
	s.sessions[sess.ID] = sess
	s.mu.Unlock()
	if err := s.saveToDisk(); err != nil {
		log.Printf("persist session %s: %v", sess.ID, err)
	}
}

func (s *FileStore) Get(id string) (*Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess, ok := s.sessions[id]
	return sess, ok
}

func (s *FileStore) Delete(id string) {
	s.mu.Lock()
	delete(s.sessions, id)
	s.mu.Unlock()
	if err := s.saveToDisk(); err != nil {
		log.Printf("persist delete %s: %v", id, err)
	}
}

func (s *FileStore) loadFromDisk() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var file persistedFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return fmt.Errorf("decode sessions: %w", err)
	}
	for _, ps := range file.Sessions {
		if ps.State != StateReady && ps.State != StatePending {
			continue
		}
		client, err := tuya.NewClientWithCookies(ps.Region, ps.Cookies)
		if err != nil {
			log.Printf("skip session %s: %v", ps.ID, err)
			continue
		}
		if ps.State == StateReady {
			if !client.HasAuthCookies() {
				continue
			}
			if _, err := client.UserInfo(); err != nil {
				log.Printf("skip expired session %s: %v", ps.ID, err)
				continue
			}
		}
		s.sessions[ps.ID] = &Session{
			ID:            ps.ID,
			Region:        ps.Region,
			Client:        client,
			QRToken:       ps.QRToken,
			QRImage:       ps.QRImage,
			State:         ps.State,
			Error:         ps.Error,
			User:          ps.User,
			CreatedAt:     ps.CreatedAt,
			UpdatedAt:     ps.UpdatedAt,
			AuthCheckedAt: time.Now(),
		}
	}
	if len(s.sessions) > 0 {
		log.Printf("restored %d session(s) from %s", len(s.sessions), s.path)
	}
	return nil
}

func (s *FileStore) saveToDisk() error {
	s.mu.RLock()
	records := make([]persistedSession, 0, len(s.sessions))
	for _, sess := range s.sessions {
		var cookies []tuya.StoredCookie
		if sess.Client != nil {
			cookies = sess.Client.ExportCookies()
		}
		records = append(records, persistedSession{
			ID:        sess.ID,
			Region:    sess.Region,
			State:     sess.State,
			Error:     sess.Error,
			User:      sess.User,
			QRToken:   sess.QRToken,
			QRImage:   sess.QRImage,
			Cookies:   cookies,
			CreatedAt: sess.CreatedAt,
			UpdatedAt: sess.UpdatedAt,
		})
	}
	s.mu.RUnlock()

	payload, err := json.MarshalIndent(persistedFile{
		Version:  1,
		Sessions: records,
	}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *FileStore) cleanupLoop() {
	ticker := time.NewTicker(15 * time.Minute)
	for range ticker.C {
		now := time.Now()
		s.mu.Lock()
		for id, sess := range s.sessions {
			switch sess.State {
			case StatePending:
				if now.Sub(sess.UpdatedAt) > 30*time.Minute {
					delete(s.sessions, id)
				}
			case StateExpired, StateError:
				if now.Sub(sess.UpdatedAt) > 24*time.Hour {
					delete(s.sessions, id)
				}
			}
		}
		s.mu.Unlock()
		_ = s.saveToDisk()
	}
}
