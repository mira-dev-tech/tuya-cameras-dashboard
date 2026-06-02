package tuya

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

// APIResponse is the common envelope from Tuya IPC Terminal APIs.
type APIResponse struct {
	Success   bool            `json:"success"`
	Status    string          `json:"status"`
	Result    json.RawMessage `json:"result"`
	ErrorCode string          `json:"errorCode"`
	ErrorMsg  string          `json:"errorMsg"`
}

// Client talks to protect-*.ismartlife.me with a cookie jar per session.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates an upstream client for the given region.
func NewClient(region string) (*Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, fmt.Errorf("cookie jar: %w", err)
	}
	return &Client{
		baseURL: BaseURL(region),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
			Jar:     jar,
		},
	}, nil
}

// Base returns the configured upstream origin.
func (c *Client) Base() string {
	return c.baseURL
}

// Warmup loads the login page so tracking cookies are set.
func (c *Client) Warmup() error {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/login", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("warmup status %d", resp.StatusCode)
	}
	return nil
}

// QRToken requests a temporary token for QR login.
func (c *Client) QRToken() (string, error) {
	var out APIResponse
	if err := c.postJSON("/api/login/security/QCtoken", map[string]any{}, &out); err != nil {
		return "", err
	}
	if !out.Success {
		return "", apiError(out)
	}
	var token string
	if err := json.Unmarshal(out.Result, &token); err != nil {
		return "", fmt.Errorf("parse token: %w", err)
	}
	if token == "" {
		return "", fmt.Errorf("empty qr token")
	}
	return token, nil
}

// QRExchange returns a data-URL PNG for the QR code.
func (c *Client) QRExchange(token string) (string, error) {
	body := map[string]string{
		"url": "tuyaSmart--qrLogin?token=" + token,
	}
	var out APIResponse
	if err := c.postJSON("/api/login/exchange", body, &out); err != nil {
		return "", err
	}
	if !out.Success {
		return "", apiError(out)
	}
	var img string
	if err := json.Unmarshal(out.Result, &img); err != nil {
		return "", fmt.Errorf("parse qr image: %w", err)
	}
	return img, nil
}

// PollSession is returned when the mobile app confirms QR login.
type PollSession struct {
	SID      string `json:"sid"`
	UID      string `json:"uid"`
	ClientID string `json:"clientId"`
	Nickname string `json:"nickname"`
	Username string `json:"username"`
}

// PollLogin checks whether the mobile app confirmed the QR scan.
// Pending polls return (nil, nil). Confirmed login sets upstream session cookies.
func (c *Client) PollLogin(token string) (*PollSession, error) {
	body := map[string]string{"token": token}
	var out APIResponse
	if err := c.postJSON("/api/login/poll", body, &out); err != nil {
		return nil, err
	}
	if !out.Success {
		if out.ErrorCode != "" && strings.Contains(strings.ToUpper(out.ErrorCode), "EXPIRE") {
			return nil, fmt.Errorf("%s: %s", out.ErrorCode, out.ErrorMsg)
		}
		return nil, nil
	}
	if len(out.Result) == 0 {
		return nil, nil
	}

	var pending bool
	if err := json.Unmarshal(out.Result, &pending); err == nil {
		return nil, nil
	}

	var sess PollSession
	if err := json.Unmarshal(out.Result, &sess); err != nil {
		return nil, nil
	}
	if sess.SID == "" || sess.UID == "" {
		return nil, nil
	}

	c.setSessionCookies(sess.UID, sess.ClientID)
	return &sess, nil
}

func (c *Client) setSessionCookies(uid, clientID string) {
	u, err := url.Parse(c.baseURL)
	if err != nil {
		return
	}
	c.httpClient.Jar.SetCookies(u, []*http.Cookie{
		{Name: "uid", Value: uid, Path: "/"},
		{Name: "clientId", Value: clientID, Path: "/"},
	})
}

func (c *Client) HasAuthCookies() bool {
	u, err := url.Parse(c.baseURL)
	if err != nil {
		return false
	}
	hasUID := false
	for _, ck := range c.httpClient.Jar.Cookies(u) {
		if ck.Name == "uid" && ck.Value != "" {
			hasUID = true
		}
	}
	return hasUID
}

// UserInfo returns the logged-in user profile.
func (c *Client) UserInfo() (map[string]any, error) {
	var out APIResponse
	if err := c.postJSON("/api/common/user/info", map[string]any{}, &out); err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, apiError(out)
	}
	var user map[string]any
	if err := json.Unmarshal(out.Result, &user); err != nil {
		return nil, err
	}
	return user, nil
}

// Home represents a Tuya home/group.
type Home struct {
	GID  int64  `json:"gid"`
	Name string `json:"name"`
}

// HomeList returns homes linked to the account.
func (c *Client) HomeList() ([]Home, error) {
	var out APIResponse
	if err := c.postJSON("/api/new/common/homeList", map[string]any{}, &out); err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, apiError(out)
	}
	var raw []struct {
		GID      int64  `json:"gid"`
		GroupID  int64  `json:"groupId"`
		Name     string `json:"name"`
		OwnerID  string `json:"ownerId"`
	}
	if err := json.Unmarshal(out.Result, &raw); err != nil {
		return nil, err
	}
	homes := make([]Home, 0, len(raw))
	for _, h := range raw {
		gid := h.GID
		if gid == 0 {
			gid = h.GroupID
		}
		homes = append(homes, Home{GID: gid, Name: h.Name})
	}
	return homes, nil
}

// Device is a sorted device entry (cameras use bizType 6 in this API).
type Device struct {
	BizID            string `json:"bizId"`
	BizType          int    `json:"bizType"`
	DisplayOrder     int    `json:"displayOrder"`
	HomeDisplayOrder int    `json:"homeDisplayOrder"`
	RoomID           string `json:"roomId"`
}

// DeviceList returns devices for a home gid.
func (c *Client) DeviceList(gid int64) ([]Device, error) {
	body := map[string]any{"gid": gid}
	var out APIResponse
	if err := c.postJSON("/api/device/sort/list", body, &out); err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, apiError(out)
	}
	var devices []Device
	if err := json.Unmarshal(out.Result, &devices); err != nil {
		return nil, err
	}
	return devices, nil
}

// CookieHeader serializes session cookies for debugging (uid/clientId).
func (c *Client) CookieHeader() string {
	u, err := url.Parse(c.baseURL)
	if err != nil {
		return ""
	}
	parts := make([]string, 0)
	for _, ck := range c.httpClient.Jar.Cookies(u) {
		parts = append(parts, ck.Name+"="+ck.Value)
	}
	return strings.Join(parts, "; ")
}

func (c *Client) postJSON(path string, body any, out *APIResponse) error {
	return c.PostJSON(path, body, out)
}

// PostJSON calls an upstream IPC Terminal API with session cookies.
func (c *Client) PostJSON(path string, body any, out *APIResponse) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("%s: http %d", path, resp.StatusCode)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode %s: %w", path, err)
	}
	return nil
}

func apiError(out APIResponse) error {
	if out.ErrorMsg != "" {
		return fmt.Errorf("%s: %s", out.ErrorCode, out.ErrorMsg)
	}
	return fmt.Errorf("upstream error: %s", out.ErrorCode)
}
