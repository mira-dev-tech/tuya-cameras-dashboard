package tuya

import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"
)

// Placeholder home and device names — never real production data.
const (
	fakeHomeAlpha = "Home Alpha"
	fakeHomeBeta  = "Home Beta"
)

// TestAllOnlineCamerasAccountAgnostic verifies cameras are aggregated from every
// home returned by the API, filtered only by Tuya category "sp" and online flag.
func TestAllOnlineCamerasAccountAgnostic(t *testing.T) {
	t.Parallel()

	const (
		gidAlpha int64 = 1001
		gidBeta  int64 = 2002
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/new/common/homeList":
			_ = json.NewEncoder(w).Encode(APIResponse{
				Success: true,
				Result: json.RawMessage(`[
					{"gid":1001,"name":"Home Alpha"},
					{"gid":2002,"name":"Home Beta"}
				]`),
			})
		case "/api/new/common/roomList":
			var body struct {
				HomeID string `json:"homeId"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode roomList body: %v", err)
				http.Error(w, "bad body", http.StatusBadRequest)
				return
			}
			var rooms json.RawMessage
			switch body.HomeID {
			case "1001":
				rooms = json.RawMessage(`[{
					"name":"Living room",
					"deviceList":[
						{"category":"sp","deviceId":"cam-alpha-1","deviceName":"Alpha Cam 1","online":true},
						{"category":"sp","deviceId":"cam-alpha-2","deviceName":"Alpha Cam 2","online":true},
						{"category":"light","deviceId":"bulb-alpha","deviceName":"Bulb","online":true}
					]
				}]`)
			case "2002":
				rooms = json.RawMessage(`[{
					"name":"Garage",
					"deviceList":[
						{"category":"sp","deviceId":"cam-beta-1","deviceName":"Beta Cam 1","online":true},
						{"category":"sp","deviceId":"cam-beta-1","deviceName":"Beta Cam 1 dup","online":true},
						{"category":"sp","deviceId":"cam-beta-off","deviceName":"Beta Offline","online":false}
					]
				}]`)
			default:
				t.Errorf("unexpected homeId %q", body.HomeID)
				http.Error(w, "unknown home", http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(APIResponse{Success: true, Result: rooms})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	client := &Client{
		baseURL: srv.URL,
		httpClient: &http.Client{
			Jar: jar,
		},
	}

	cameras, err := client.AllOnlineCameras()
	if err != nil {
		t.Fatalf("AllOnlineCameras: %v", err)
	}

	if len(cameras) != 3 {
		t.Fatalf("expected 3 online cameras (2 alpha + 1 beta, deduped), got %d: %+v", len(cameras), cameras)
	}

	byID := make(map[string]CameraEntry)
	for _, c := range cameras {
		byID[c.DevID] = c
	}

	alpha1, ok := byID["cam-alpha-1"]
	if !ok {
		t.Fatal("missing cam-alpha-1")
	}
	if alpha1.HomeName != fakeHomeAlpha || alpha1.GID != gidAlpha {
		t.Fatalf("alpha1 context: got gid=%d home=%q", alpha1.GID, alpha1.HomeName)
	}

	beta1, ok := byID["cam-beta-1"]
	if !ok {
		t.Fatal("missing cam-beta-1")
	}
	if beta1.HomeName != fakeHomeBeta || beta1.GID != gidBeta {
		t.Fatalf("beta1 context: got gid=%d home=%q", beta1.GID, beta1.HomeName)
	}

	if _, ok := byID["bulb-alpha"]; ok {
		t.Fatal("non-camera device must not appear")
	}
	if _, ok := byID["cam-beta-off"]; ok {
		t.Fatal("offline camera must not appear")
	}
}

// TestAllCamerasIncludesOffline verifies AllCameras walks every home without name filtering.
func TestAllCamerasIncludesOffline(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/new/common/homeList":
			_ = json.NewEncoder(w).Encode(APIResponse{
				Success: true,
				Result: json.RawMessage(`[{"gid":42,"name":"Home Alpha"}]`),
			})
		case "/api/device/sort/list":
			_ = json.NewEncoder(w).Encode(APIResponse{
				Success: true,
				Result: json.RawMessage(`[
					{"bizId":"offline-cam","bizType":6,"roomId":"r1"},
					{"bizId":"switch-1","bizType":1,"roomId":"r1"}
				]`),
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	client := &Client{
		baseURL: srv.URL,
		httpClient: &http.Client{Jar: jar},
	}

	cameras, err := client.AllCameras()
	if err != nil {
		t.Fatalf("AllCameras: %v", err)
	}
	if len(cameras) != 1 {
		t.Fatalf("expected 1 camera (bizType 6), got %d", len(cameras))
	}
	if cameras[0].DevID != "offline-cam" || cameras[0].HomeName != fakeHomeAlpha {
		t.Fatalf("unexpected camera: %+v", cameras[0])
	}
}
