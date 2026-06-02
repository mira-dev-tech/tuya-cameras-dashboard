package tuya

import (
	"strings"
	"testing"
)

func TestPatchPortalHTMLPlayback(t *testing.T) {
	body := `<head></head><script id="__NEXT_DATA__" type="application/json">{"page":"","nextContext":{"nextConfig":{"routerPrefix":"","assetPrefix":"https://cdn.example"}}}</script>`
	out := patchPortalHTML(body, "/playback")
	if !strings.Contains(out, `"page":"/playback"`) {
		t.Fatalf("expected page playback, got: %s", out)
	}
	if !strings.Contains(out, `"routerPrefix":"/portal"`) {
		t.Fatalf("expected routerPrefix /portal, got: %s", out)
	}
	if !strings.Contains(out, `<base href="/portal/">`) {
		t.Fatalf("expected base href, got: %s", out)
	}
}

func TestPatchPortalHTMLSpacedJSON(t *testing.T) {
	body := `<head></head><script id="__NEXT_DATA__">{"page": "", "nextContext":{"nextConfig":{"routerPrefix": ""}}}</script>`
	out := patchPortalHTML(body, "/playback")
	if !strings.Contains(out, `"page":"/playback"`) {
		t.Fatalf("expected spaced page patch, got: %s", out)
	}
}
