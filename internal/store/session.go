package store

import (
	"sync"
	"time"

	"github.com/Rbertolli/mira-cameras/internal/tuya"
)

// LoginState tracks QR login progress.
type LoginState string

const (
	StatePending   LoginState = "pending"
	StateReady     LoginState = "ready"
	StateExpired   LoginState = "expired"
	StateError     LoginState = "error"
)

// Session holds upstream Tuya client state for one browser user.
type Session struct {
	ID            string
	Region        string
	Client        *tuya.Client
	QRToken       string
	QRImage       string
	State         LoginState
	Error         string
	User          map[string]any
	CreatedAt     time.Time
	UpdatedAt     time.Time
	AuthCheckedAt time.Time
}

// Store persists authenticated Tuya sessions.
type Store interface {
	Put(sess *Session)
	Get(id string) (*Session, bool)
	Delete(id string)
}

// MemoryStore is an in-process session registry (tests / fallback).
type MemoryStore struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	ttl      time.Duration
}

// NewMemoryStore creates a session store with TTL cleanup.
func NewMemoryStore(ttl time.Duration) *MemoryStore {
	s := &MemoryStore{
		sessions: make(map[string]*Session),
		ttl:      ttl,
	}
	go s.cleanupLoop()
	return s
}

// Put stores or replaces a session.
func (s *MemoryStore) Put(sess *Session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[sess.ID] = sess
}

// Get returns a session by id.
func (s *MemoryStore) Get(id string) (*Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess, ok := s.sessions[id]
	return sess, ok
}

// Delete removes a session.
func (s *MemoryStore) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
}

func (s *MemoryStore) cleanupLoop() {
	ticker := time.NewTicker(10 * time.Minute)
	for range ticker.C {
		now := time.Now()
		s.mu.Lock()
		for id, sess := range s.sessions {
			if now.Sub(sess.UpdatedAt) > s.ttl {
				delete(s.sessions, id)
			}
		}
		s.mu.Unlock()
	}
}
