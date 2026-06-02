package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/mira-dev-tech/mira-cameras/internal/api"
	"github.com/mira-dev-tech/mira-cameras/internal/store"
)

//go:embed web/*
var webFS embed.FS

func main() {
	dataDir := envOr("MIRA_CAMERAS_DATA", ".data")
	st, err := store.NewFileStore(dataDir)
	if err != nil {
		log.Fatalf("session store: %v", err)
	}
	srv := api.NewServer(st)

	mux := http.NewServeMux()
	srv.Register(mux)

	webRoot, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("web fs: %v", err)
	}
	fileServer := http.FileServer(http.FS(webRoot))
	mux.Handle("GET /{$}", fileServer)
	mux.Handle("GET /{file}", fileServer)

	addr := envOr("LISTEN_ADDR", ":8080")
	log.Printf("mira-cameras listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
