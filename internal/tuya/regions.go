package tuya

// Region hosts the IPC Terminal (nova plataforma security-wisdom).
var RegionBases = map[string]string{
	"us": "https://protect-us.ismartlife.me",
	"eu": "https://protect-eu.ismartlife.me",
}

// DefaultRegion is used when none is specified.
const DefaultRegion = "us"

// BaseURL resolves a region code to the upstream origin.
func BaseURL(region string) string {
	if base, ok := RegionBases[region]; ok {
		return base
	}
	return RegionBases[DefaultRegion]
}
