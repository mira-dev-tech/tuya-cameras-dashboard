package tuya

import (
	"encoding/json"
	"fmt"
	"strconv"
)

const cameraCategory = "sp"

// RoomDevice is a device entry from roomList (includes online status).
type RoomDevice struct {
	Category   string `json:"category"`
	DeviceID   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
	Online     bool   `json:"online"`
	P2PType    int    `json:"p2pType"`
	ProductID  string `json:"productId"`
}

// RoomGroup is a room/area from roomList.
type RoomGroup struct {
	DeviceCount int          `json:"deviceCount"`
	DeviceList  []RoomDevice `json:"deviceList"`
	Name        string       `json:"name"`
	RoomID      string       `json:"roomId"`
}

// RoomList returns devices grouped by room for a home, including online flags.
func (c *Client) RoomList(homeID int64) ([]RoomGroup, error) {
	body := map[string]any{"homeId": strconv.FormatInt(homeID, 10)}
	var out APIResponse
	if err := c.postJSON("/api/new/common/roomList", body, &out); err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, apiError(out)
	}
	var rooms []RoomGroup
	if err := json.Unmarshal(out.Result, &rooms); err != nil {
		return nil, fmt.Errorf("parse roomList: %w", err)
	}
	return rooms, nil
}

// OnlineCameraDevices returns online security cameras (category sp) for one home.
func (c *Client) OnlineCameraDevices(homeID int64) ([]RoomDevice, error) {
	rooms, err := c.RoomList(homeID)
	if err != nil {
		return nil, err
	}
	out := make([]RoomDevice, 0)
	seen := make(map[string]struct{})
	for _, room := range rooms {
		for _, d := range room.DeviceList {
			if d.Category != cameraCategory || !d.Online || d.DeviceID == "" {
				continue
			}
			if _, ok := seen[d.DeviceID]; ok {
				continue
			}
			seen[d.DeviceID] = struct{}{}
			out = append(out, d)
		}
	}
	return out, nil
}
