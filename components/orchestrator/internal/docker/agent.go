package docker

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	containerTypes "github.com/docker/docker/api/types/container"
	volumeTypes "github.com/docker/docker/api/types/volume"
	"github.com/docker/go-connections/nat"
	"openvelo/orchestrator/internal/config"
)

type AgentSpawnResult struct {
	ContainerID string `json:"containerId"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	VncHostPort int    `json:"vncHostPort,omitempty"`
}

func (m *Manager) CreateVolumeIfNotExists(ctx context.Context, volumeName string) error {
	if m.useDockerCli {
		inspectCmd := exec.Command("docker", "volume", "inspect", volumeName)
		if err := inspectCmd.Run(); err != nil {
			fmt.Printf("[docker] Volume %s not found, creating it...\n", volumeName)
			createCmd := exec.Command("docker", "volume", "create", volumeName)
			if err := createCmd.Run(); err != nil {
				return fmt.Errorf("failed to create Docker volume %s via CLI: %w", volumeName, err)
			}
		}
		return nil
	}

	if m.cli == nil {
		return fmt.Errorf("Docker client is nil, cannot create volume %s", volumeName)
	}

	_, err := m.cli.VolumeInspect(ctx, volumeName)
	if err != nil {
		fmt.Printf("[docker] Volume %s not found, creating it...\n", volumeName)
		_, err = m.cli.VolumeCreate(ctx, volumeTypes.CreateOptions{Name: volumeName})
		return err
	}
	return nil
}

func (m *Manager) SpawnAgent(ctx context.Context, jobID int64, kind string, image string) (*AgentSpawnResult, error) {
	cfg := config.Instance.GetSnapshot()
	agentHostPort, err := m.FindFreePort()
	if err != nil {
		return nil, fmt.Errorf("failed to find free port: %w", err)
	}
	if kind == "" {
		kind = "agent"
	}
	// Agents listen on a fixed in-container port (3001). Testers listen
	// on whatever port we publish — give them the same number inside the
	// container as outside, so the orchestrator's WS dial target matches
	// the port the tester was told to bind via TESTER_PORT.
	agentInternalPort := 3001
	portEnvVar := "AGENT_PORT"
	if kind == "tester" {
		agentInternalPort = agentHostPort
		portEnvVar = "TESTER_PORT"
	}
	// Tester-only: also publish the x11vnc view-only port so an operator
	// can watch what the GUI under test is doing. We pick a free host
	// port and tell the tester daemon (via PORT_VNC) to bind the same
	// number inside the container — the host:container mapping is
	// therefore a same-number pass-through, which keeps the published
	// URL predictable ("vnc://localhost:<hostPort>").
	var vncHostPort int
	if kind == "tester" {
		vncHostPort, err = m.FindFreePort()
		if err != nil {
			return nil, fmt.Errorf("failed to find free VNC port: %w", err)
		}
	}
	containerName := fmt.Sprintf("openvelo-%s-%d-%d", kind, jobID, time.Now().UnixMilli())

	homeDir := os.Getenv("OPENVELO_HOST_HOME")
	if homeDir == "" {
		homeDir, _ = os.UserHomeDir()
	}
	if homeDir == "" {
		if runtime.GOOS == "windows" {
			homeDir = os.Getenv("USERPROFILE")
		} else {
			homeDir = os.Getenv("HOME")
		}
	}
	if homeDir == "" {
		homeDir = "/root"
	}

	imageOs := m.DetectImageOs(ctx, image)
	isWindowsContainer := imageOs == "windows"

	containerPath := func(linuxPath, winPath string) string {
		if isWindowsContainer {
			return winPath
		}
		return linuxPath
	}

	var binds []string

	kiloAuthSource := filepath.Join(homeDir, ".local", "share", "kilo", "auth.json")
	kiloAuthTarget := containerPath("/root/.local/share/kilo/auth.json", "C:/Users/ContainerAdministrator/.local/share/kilo/auth.json")
	kiloAuthCheck := kiloAuthTarget
	if !cfg.ContainerMode {
		kiloAuthCheck = kiloAuthSource
	}
	if _, err := os.Stat(kiloAuthCheck); err == nil {
		binds = append(binds, fmt.Sprintf("%s:%s:rw", toDockerPath(kiloAuthSource), kiloAuthTarget))
	}

	kiloConfigSource := filepath.Join(homeDir, ".config", "kilo")
	kiloConfigTarget := containerPath("/root/.config/kilo", "C:/Users/ContainerAdministrator/.config/kilo")
	kiloConfigCheck := kiloConfigTarget
	if !cfg.ContainerMode {
		kiloConfigCheck = kiloConfigSource
	}
	if _, err := os.Stat(kiloConfigCheck); err == nil {
		binds = append(binds, fmt.Sprintf("%s:%s:rw", toDockerPath(kiloConfigSource), kiloConfigTarget))
	}

	// Skip the host /SKILLS bind for the tester: its image already bakes the
	// tester's own skills into /SKILLS (see components/tester/Dockerfile).
	// Mounting the shared data/SKILLS here would overwrite them.
	if kind != "tester" && cfg.SkillsHostPath != "" {
		skillsTarget := containerPath("/SKILLS", "C:/SKILLS")
		binds = append(binds, fmt.Sprintf("%s:%s:rw", toDockerPath(cfg.SkillsHostPath), skillsTarget))
	}

	// Mount project named volume
	if cfg.ProjectID != nil {
		volumeName := fmt.Sprintf("project-%d", *cfg.ProjectID)
		if err := m.CreateVolumeIfNotExists(ctx, volumeName); err != nil {
			fmt.Printf("[docker] Warning: failed to ensure project volume %s: %v\n", volumeName, err)
		} else {
			targetPath := containerPath("/data", "C:/data")
			binds = append(binds, fmt.Sprintf("%s:%s:rw", volumeName, targetPath))
			fmt.Printf("[docker] Mounted project volume %s to %s\n", volumeName, targetPath)
		}

		if cfg.TempDataHostPath != "" {
			sharedRepoSource := sharedRepoHostPath(cfg.TempDataHostPath, *cfg.ProjectID)
			if err := os.MkdirAll(sharedRepoSource, 0755); err != nil {
				return nil, fmt.Errorf("failed to prepare shared repository directory %s: %w", sharedRepoSource, err)
			}
			sharedRepoTarget := sharedRepoContainerTarget(isWindowsContainer)
			binds = append(binds, fmt.Sprintf("%s:%s:rw", toDockerPath(sharedRepoSource), sharedRepoTarget))
			fmt.Printf("[docker] Mounted shared repository %s to %s\n", sharedRepoSource, sharedRepoTarget)
		}
	}

	networkMode := m.ResolveNetworkMode(ctx)

	fmt.Printf("[docker] Creating agent container: image=%s, networkMode=%s, name=%s\n", image, networkMode, containerName)

	if m.useDockerCli {
		args := []string{"run", "-d", "--name", containerName}
		args = append(args, "-e", fmt.Sprintf("%s=%d", portEnvVar, agentInternalPort))
		args = append(args, "-e", fmt.Sprintf("JOB_ID=%d", jobID))
		args = append(args, "-e", fmt.Sprintf("JOB_KIND=%s", kind))
		args = append(args, "-e", fmt.Sprintf("AGENT_MAX_RETRIES=%d", cfg.AgentMaxRetries))
		args = append(args, "-e", fmt.Sprintf("AGENT_MAX_TIMEOUT=%d", cfg.AgentMaxTimeout))
		args = append(args, "-p", fmt.Sprintf("%d:%d", agentHostPort, agentInternalPort))
		if !isWindowsContainer {
			// FUSE provisioning for `gbfs mount` inside the spawned
			// container (see fuseProvisioning for rationale).
			args = append(args, "--device", "/dev/fuse:/dev/fuse:rwm")
			args = append(args, "--cap-add", "SYS_ADMIN")
			args = append(args, "--security-opt", "apparmor:unconfined")
		}
		if kind == "tester" && vncHostPort > 0 {
			// Pin the container-side VNC port to the host port we just
			// picked so x11vnc binds on it (and `nc -z localhost`
			// probes from inside the container — used by tests — keep
			// working without a separate mapping).
			args = append(args, "-e", fmt.Sprintf("PORT_VNC=%d", vncHostPort))
			args = append(args, "-p", fmt.Sprintf("%d:%d", vncHostPort, vncHostPort))
		}
		for _, b := range binds {
			args = append(args, "-v", b)
		}
		if networkMode != "" {
			args = append(args, "--network", networkMode)
		}
		args = append(args, image)

		cmd := exec.Command("docker", args...)
		out, err := cmd.Output()
		if err != nil {
			return nil, fmt.Errorf("docker CLI run agent failed: %w", err)
		}
		cid := string(out)
		if len(cid) > 12 {
			cid = cid[:12]
		}
		useInternal := networkMode != ""
		host := "localhost"
		port := agentHostPort
		if useInternal {
			host = containerName
			port = agentInternalPort
		}
		return &AgentSpawnResult{ContainerID: cid, Host: host, Port: port, VncHostPort: vncHostPort}, nil
	}

	portProtocol := nat.Port(fmt.Sprintf("%d/tcp", agentInternalPort))
	containerCfg := &containerTypes.Config{
		Image: image,
		Env: []string{
			fmt.Sprintf("%s=%d", portEnvVar, agentInternalPort),
			fmt.Sprintf("JOB_ID=%d", jobID),
			fmt.Sprintf("JOB_KIND=%s", kind),
			fmt.Sprintf("AGENT_MAX_RETRIES=%d", cfg.AgentMaxRetries),
			fmt.Sprintf("AGENT_MAX_TIMEOUT=%d", cfg.AgentMaxTimeout),
		},
		ExposedPorts: nat.PortSet{
			portProtocol: struct{}{},
		},
	}
	vncProtocol := nat.Port("")
	if kind == "tester" && vncHostPort > 0 {
		vncProtocol = nat.Port(fmt.Sprintf("%d/tcp", vncHostPort))
		containerCfg.Env = append(containerCfg.Env, fmt.Sprintf("PORT_VNC=%d", vncHostPort))
		containerCfg.ExposedPorts[vncProtocol] = struct{}{}
	}

	hostCfg := &containerTypes.HostConfig{
		AutoRemove: false,
		Binds:      binds,
		PortBindings: nat.PortMap{
			portProtocol: []nat.PortBinding{
				{HostPort: strconv.Itoa(agentHostPort)},
			},
		},
	}
	if vncProtocol != "" {
		hostCfg.PortBindings[vncProtocol] = []nat.PortBinding{
			{HostPort: strconv.Itoa(vncHostPort)},
		}
	}

	// Required so the spawned agent/tester can run `gbfs mount`
	// (libfuse3 / FUSE) inside the container. Mirrors the web-ui
	// orchestrator container's setup (docker-manager.ts:218-227) and
	// docker-compose.yml:62-72. Without these the FUSE ioctl from
	// gbfs fails with "Transport endpoint not connected" / ENXIO.
	// Windows containers don't expose /dev/fuse; skip on Windows.
	devices, capAdd, securityOpt := fuseProvisioning(isWindowsContainer)
	hostCfg.Devices = devices
	hostCfg.CapAdd = capAdd
	hostCfg.SecurityOpt = securityOpt

	if !isWindowsContainer {
		hostCfg.ExtraHosts = []string{"host.docker.internal:host-gateway"}
	}
	if networkMode != "" {
		hostCfg.NetworkMode = containerTypes.NetworkMode(networkMode)
	}

	created, err := m.cli.ContainerCreate(ctx, containerCfg, hostCfg, nil, nil, containerName)
	if err != nil {
		return nil, fmt.Errorf("error creating agent container: %w", err)
	}

	if err := m.cli.ContainerStart(ctx, created.ID, containerTypes.StartOptions{}); err != nil {
		return nil, fmt.Errorf("error starting agent container: %w", err)
	}

	fmt.Printf("[docker] Agent container created and started: %s\n", created.ID)

	useInternal := networkMode != ""
	host := "localhost"
	port := agentHostPort
	if useInternal {
		host = containerName
		port = agentInternalPort
	}

	return &AgentSpawnResult{
		ContainerID: created.ID,
		Host:        host,
		Port:        port,
		VncHostPort: vncHostPort,
	}, nil
}

func (m *Manager) StopAgent(ctx context.Context, containerID string) error {
	if m.useDockerCli {
		cmd := exec.Command("docker", "stop", "-t", "2", containerID)
		return cmd.Run()
	}
	if m.cli == nil {
		return nil
	}
	timeoutSec := 2
	stopOpts := containerTypes.StopOptions{Timeout: &timeoutSec}
	return m.cli.ContainerStop(ctx, containerID, stopOpts)
}

func (m *Manager) RemoveAgent(ctx context.Context, containerID string) error {
	if m.useDockerCli {
		cmd := exec.Command("docker", "rm", "-f", containerID)
		return cmd.Run()
	}
	if m.cli == nil {
		return nil
	}
	removeOpts := containerTypes.RemoveOptions{Force: true}
	err := m.cli.ContainerRemove(ctx, containerID, removeOpts)
	if err == nil {
		fmt.Printf("[docker] Removed container %s\n", containerID)
	}
	return err
}

// sharedRepoHostPath returns the host-side path to the project's shared
// clone that the orchestrator bind-mounts into every spawned agent/
// tester container at /shared_repo (or C:/shared_repo for Windows
// containers). Pulled out of SpawnAgent so the path layout is
// unit-testable without a dockerode mock.
func sharedRepoHostPath(tempDataHostPath string, projectID int64) string {
	return filepath.Join(tempDataHostPath, "shared_repos", strconv.FormatInt(projectID, 10), "repository")
}

// sharedRepoContainerTarget returns the in-container mount point for
// the shared_repo bind. Linux/Wine containers use /shared_repo; native
// Windows containers use C:/shared_repo.
func sharedRepoContainerTarget(isWindowsContainer bool) string {
	if isWindowsContainer {
		return "C:/shared_repo"
	}
	return "/shared_repo"
}

// fuseProvisioning returns the Devices/CapAdd/SecurityOpt triple
// required for the spawned container to run `gbfs mount` (libfuse3).
// Mirrors docker-manager.ts:218-227 and docker-compose.yml:62-72.
// No-op for Windows containers (no /dev/fuse).
func fuseProvisioning(isWindowsContainer bool) (devices []containerTypes.DeviceMapping, capAdd []string, securityOpt []string) {
	if isWindowsContainer {
		return nil, nil, nil
	}
	devices = []containerTypes.DeviceMapping{
		{PathOnHost: "/dev/fuse", PathInContainer: "/dev/fuse", CgroupPermissions: "rwm"},
	}
	capAdd = []string{"SYS_ADMIN"}
	securityOpt = []string{"apparmor:unconfined"}
	return devices, capAdd, securityOpt
}
