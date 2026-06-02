package tuya

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
	out := make([]CameraEntry, 0)
	for _, home := range homes {
		if onlineOnly {
			devices, err := c.OnlineCameraDevices(home.GID)
			if err != nil {
				return nil, err
			}
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
			continue
		}
		devices, err := c.DeviceList(home.GID)
		if err != nil {
			return nil, err
		}
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
	}
	return out, nil
}
