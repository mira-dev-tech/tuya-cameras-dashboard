package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/mira-dev-tech/mira-cameras/internal/tuya"
)

func main() {
	raw, err := os.ReadFile(".data/sessions.json")
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	var file struct {
		Sessions []struct {
			Region  string              `json:"region"`
			Cookies []tuya.StoredCookie `json:"cookies"`
		} `json:"sessions"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		panic(err)
	}
	c, err := tuya.NewClientWithCookies(file.Sessions[0].Region, file.Sessions[0].Cookies)
	if err != nil {
		panic(err)
	}
	cams, err := c.AllOnlineCameras()
	if err != nil {
		panic(err)
	}
	fmt.Printf("online cameras: %d\n", len(cams))
	for _, cam := range cams[:5] {
		fmt.Printf("  %s %s (%s)\n", cam.HomeName, cam.Name, cam.DevID)
	}
}
