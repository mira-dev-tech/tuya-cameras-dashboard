package tuya

import "sync"

// CameraEntry is a camera device with home context.
type CameraEntry struct {
	DevID    string `json:"devId"`
	Name     string `json:"name,omitempty"`
	GID      int64  `json:"gid"`
	HomeName string `json:"homeName"`
	RoomID   string `json:"roomId,omitempty"`
	BizType  int    `json:"bizType"`
	Online   bool   `json:"online"`
}

// IsCamera reports whether a sorted device entry is a camera (bizType 6).
func IsCamera(d Device) bool {
	return d.BizType == 6
}

// AllCameras lists cameras across every home on the account.
func (c *Client) AllCameras() ([]CameraEntry, error) {
	return c.allCameras(false)
}

// AllOnlineCameras lists only online security cameras (category sp, online=true).
func (c *Client) AllOnlineCameras() ([]CameraEntry, error) {
	return c.allCameras(true)
}

func (c *Client) allCameras(onlineOnly bool) ([]CameraEntry, error) {
	homes, err := c.HomeList()
	if err != nil {
		return nil, err
	}
	if len(homes) == 0 {
		return nil, nil
	}

	type homeBatch struct {
		entries []CameraEntry
		err     error
	}
	batches := make([]homeBatch, len(homes))
	var wg sync.WaitGroup
	for i, home := range homes {
		wg.Add(1)
		go func(idx int, h Home) {
			defer wg.Done()
			batches[idx].entries, batches[idx].err = c.camerasForHome(h, onlineOnly)
		}(i, home)
	}
	wg.Wait()

	out := make([]CameraEntry, 0)
	for _, batch := range batches {
		if batch.err != nil {
			return nil, batch.err
		}
		out = append(out, batch.entries...)
	}
	return out, nil
}

func (c *Client) camerasForHome(home Home, onlineOnly bool) ([]CameraEntry, error) {
	if onlineOnly {
		devices, err := c.OnlineCameraDevices(home.GID)
		if err != nil {
			return nil, err
		}
		out := make([]CameraEntry, 0, len(devices))
		for _, d := range devices {
			out = append(out, CameraEntry{
				DevID:    d.DeviceID,
				Name:     d.DeviceName,
				GID:      home.GID,
				HomeName: home.Name,
				BizType:  6,
				Online:   true,
			})
		}
		return out, nil
	}
	devices, err := c.DeviceList(home.GID)
	if err != nil {
		return nil, err
	}
	out := make([]CameraEntry, 0)
	for _, d := range devices {
		if !IsCamera(d) {
			continue
		}
		out = append(out, CameraEntry{
			DevID:    d.BizID,
			GID:      home.GID,
			HomeName: home.Name,
			RoomID:   d.RoomID,
			BizType:  d.BizType,
		})
	}
	return out, nil
}
