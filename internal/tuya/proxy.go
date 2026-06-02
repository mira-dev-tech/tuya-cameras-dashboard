package tuya

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const portalPrefix = "/portal"

// PortalProxy forwards browser requests to the upstream IPC Terminal with session cookies.
func PortalProxy(client *Client) http.Handler {
	target, err := url.Parse(client.baseURL)
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "invalid upstream", http.StatusInternalServerError)
		})
	}

	rp := httputil.NewSingleHostReverseProxy(target)
	origDirector := rp.Director
	rp.Director = func(req *http.Request) {
		origDirector(req)
		path := strings.TrimPrefix(req.URL.Path, portalPrefix)
		if path == "" {
			path = "/"
		}
		req.URL.Path = path
		req.URL.RawPath = ""
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.Host = target.Host

		req.Header.Del("Cookie")
		// Plain text so patchPortalHTML can rewrite __NEXT_DATA__ (gzip breaks string replace).
		req.Header.Del("Accept-Encoding")
		for _, ck := range client.httpClient.Jar.Cookies(target) {
			req.AddCookie(ck)
		}
		req.Header.Set("X-Mira-Upstream-Path", path)
	}

	rp.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("X-Frame-Options")
		resp.Header.Del("Content-Security-Policy")
		resp.Header.Del("Content-Security-Policy-Report-Only")

		ctype := resp.Header.Get("Content-Type")
		if !shouldRewriteBody(ctype) {
			return nil
		}

		raw, err := readDecompressedBody(resp)
		if err != nil {
			return err
		}

		upstreamPath := resp.Request.Header.Get("X-Mira-Upstream-Path")
		if upstreamPath == "" && resp.Request != nil && resp.Request.URL != nil {
			upstreamPath = resp.Request.URL.Path
		}
		rewritten := patchPortalHTML(string(raw), upstreamPath)
		resp.Header.Del("Content-Encoding")
		resp.Body = io.NopCloser(bytes.NewReader([]byte(rewritten)))
		resp.ContentLength = int64(len(rewritten))
		resp.Header.Set("Content-Length", strconv.Itoa(len(rewritten)))
		return nil
	}

	return rp
}

func shouldRewriteBody(contentType string) bool {
	ct := strings.ToLower(contentType)
	return strings.Contains(ct, "text/html") ||
		strings.Contains(ct, "javascript") ||
		strings.Contains(ct, "json") ||
		strings.Contains(ct, "text/css")
}

var (
	reNextEmptyPage   = regexp.MustCompile(`"page"\s*:\s*""`)
	reNextRouterEmpty = regexp.MustCompile(`"routerPrefix"\s*:\s*""`)
)

func patchPortalHTML(body, upstreamPath string) string {
	body = rewritePortalPaths(body)

	page := nextPageForPath(upstreamPath)
	if page != "" {
		body = reNextEmptyPage.ReplaceAllString(body, `"page":"`+page+`"`)
	}
	body = reNextRouterEmpty.ReplaceAllString(body, `"routerPrefix":"/portal"`)

	if strings.Contains(body, "<head>") && !strings.Contains(body, `<base href="/portal/"`) {
		body = strings.Replace(body, "<head>", `<head><base href="/portal/">`, 1)
	}

	return body
}

func readDecompressedBody(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	if strings.EqualFold(resp.Header.Get("Content-Encoding"), "gzip") {
		gr, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, err
		}
		defer gr.Close()
		return io.ReadAll(gr)
	}
	return io.ReadAll(resp.Body)
}

func nextPageForPath(path string) string {
	switch {
	case strings.HasSuffix(path, "/playback"), path == "/playback":
		return "/playback"
	case strings.HasSuffix(path, "/login"), path == "/login":
		return "/login"
	case strings.HasSuffix(path, "/message"), path == "/message":
		return "/message"
	default:
		return ""
	}
}

func rewritePortalPaths(body string) string {
	replacements := []struct{ old, new string }{
		{`"/api/`, `"` + portalPrefix + `/api/`},
		{`'/api/`, `'` + portalPrefix + `/api/`},
		{`"/global/api/`, `"` + portalPrefix + `/global/api/`},
		{`'/global/api/`, `'` + portalPrefix + `/global/api/`},
		{`"/_next/`, `"` + portalPrefix + `/_next/`},
		{`'/_next/`, `'` + portalPrefix + `/_next/`},
		{`"/static/`, `"` + portalPrefix + `/static/`},
		{`'/static/`, `'` + portalPrefix + `/static/`},
		{`href="/`, `href="` + portalPrefix + `/`},
		{`src="/`, `src="` + portalPrefix + `/`},
		{`action="/`, `action="` + portalPrefix + `/`},
	}
	for _, r := range replacements {
		body = strings.ReplaceAll(body, r.old, r.new)
	}
	body = strings.ReplaceAll(body, portalPrefix+portalPrefix+`/`, portalPrefix+`/`)
	return body
}
