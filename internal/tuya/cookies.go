package tuya

import (
	"net/http"
	"net/url"
)

// StoredCookie is a serializable upstream session cookie.
type StoredCookie struct {
	Name  string `json:"name"`
	Value string `json:"value"`
	Path  string `json:"path,omitempty"`
}

// ExportCookies returns session cookies from the upstream jar.
func (c *Client) ExportCookies() []StoredCookie {
	u, err := url.Parse(c.baseURL)
	if err != nil {
		return nil
	}
	out := make([]StoredCookie, 0)
	for _, ck := range c.httpClient.Jar.Cookies(u) {
		if ck.Value == "" {
			continue
		}
		out = append(out, StoredCookie{
			Name:  ck.Name,
			Value: ck.Value,
			Path:  ck.Path,
		})
	}
	return out
}

// RestoreCookies applies persisted cookies to the client jar.
func (c *Client) RestoreCookies(cookies []StoredCookie) {
	if len(cookies) == 0 {
		return
	}
	u, err := url.Parse(c.baseURL)
	if err != nil {
		return
	}
	httpCookies := make([]*http.Cookie, 0, len(cookies))
	for _, sc := range cookies {
		path := sc.Path
		if path == "" {
			path = "/"
		}
		httpCookies = append(httpCookies, &http.Cookie{
			Name:  sc.Name,
			Value: sc.Value,
			Path:  path,
		})
	}
	c.httpClient.Jar.SetCookies(u, httpCookies)
}

// NewClientWithCookies creates a client and restores upstream auth cookies.
func NewClientWithCookies(region string, cookies []StoredCookie) (*Client, error) {
	client, err := NewClient(region)
	if err != nil {
		return nil, err
	}
	client.RestoreCookies(cookies)
	return client, nil
}
