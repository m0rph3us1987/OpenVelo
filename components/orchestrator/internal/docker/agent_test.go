package docker

import (
	"path/filepath"
	"reflect"
	"testing"

	containerTypes "github.com/docker/docker/api/types/container"
)

func TestSharedRepoHostPath(t *testing.T) {
	cases := []struct {
		name     string
		tempDir  string
		projID   int64
		expected string
	}{
		{"absolute path", "/var/openvelo/temp_data", 42, filepath.Join("/var/openvelo/temp_data", "shared_repos", "42", "repository")},
		{"relative path resolves through filepath.Join", "./temp_data", 7, filepath.Join("temp_data", "shared_repos", "7", "repository")},
		{"large project id", "/tmp/data", 9223372036854775807, filepath.Join("/tmp/data", "shared_repos", "9223372036854775807", "repository")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := sharedRepoHostPath(tc.tempDir, tc.projID)
			if got != tc.expected {
				t.Fatalf("got %q, want %q", got, tc.expected)
			}
		})
	}
}

func TestSharedRepoContainerTarget(t *testing.T) {
	if got := sharedRepoContainerTarget(false); got != "/shared_repo" {
		t.Errorf("Linux target = %q, want /shared_repo", got)
	}
	if got := sharedRepoContainerTarget(true); got != "C:/shared_repo" {
		t.Errorf("Windows target = %q, want C:/shared_repo", got)
	}
}

func TestFuseProvisioning_LinuxContainer(t *testing.T) {
	devices, capAdd, securityOpt := fuseProvisioning(false)

	wantDevices := []containerTypes.DeviceMapping{
		{PathOnHost: "/dev/fuse", PathInContainer: "/dev/fuse", CgroupPermissions: "rwm"},
	}
	if !reflect.DeepEqual(devices, wantDevices) {
		t.Errorf("devices mismatch: got %+v want %+v", devices, wantDevices)
	}
	wantCapAdd := []string{"SYS_ADMIN"}
	if !reflect.DeepEqual(capAdd, wantCapAdd) {
		t.Errorf("capAdd mismatch: got %+v want %+v", capAdd, wantCapAdd)
	}
	wantSecurityOpt := []string{"apparmor:unconfined"}
	if !reflect.DeepEqual(securityOpt, wantSecurityOpt) {
		t.Errorf("securityOpt mismatch: got %+v want %+v", securityOpt, wantSecurityOpt)
	}
}

func TestFuseProvisioning_WindowsContainer(t *testing.T) {
	// Windows containers have no /dev/fuse — provisioning must be empty
	// so we don't pass nonsensical flags to the Windows Docker engine.
	devices, capAdd, securityOpt := fuseProvisioning(true)
	if len(devices) != 0 || len(capAdd) != 0 || len(securityOpt) != 0 {
		t.Errorf("expected no-op for Windows container, got devices=%v capAdd=%v securityOpt=%v", devices, capAdd, securityOpt)
	}
}
