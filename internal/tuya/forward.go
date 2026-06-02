package tuya

import (
	"io"
	"net/http"
	"net/url"
)

// ForwardRequest proxies an HTTP request to the upstream IPC Terminal origin.
func (c *Client) ForwardRequest(w http.ResponseWriter, r *http.Request) {
	upstream, err := url.Parse(c.baseURL)
	if err != nil {
		http.Error(w, "upstream invalid", http.StatusInternalServerError)
		return
	}

	target := *upstream
	target.Path = r.URL.Path
	target.RawQuery = r.URL.RawQuery

	outReq, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	outReq.Header = r.Header.Clone()
	outReq.Header.Del("Cookie")
	outReq.Host = upstream.Host

	for _, ck := range c.httpClient.Jar.Cookies(upstream) {
		outReq.AddCookie(ck)
	}

	resp, err := c.httpClient.Do(outReq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
