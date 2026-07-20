package docker

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"

	"github.com/docker/docker/client"
)

type Manager struct {
	cli                 *client.Client
	useDockerCli        bool
	resolvedNetworkMode string
	netModeOnce         sync.Once
	imageOsCache        map[string]string
	cacheMu             sync.RWMutex
}

var DefaultManager *Manager
var initOnce sync.Once

func GetManager() *Manager {
	initOnce.Do(func() {
		DefaultManager = NewManager()
	})
	return DefaultManager
}

func NewManager() *Manager {
	useCli := runtime.GOOS == "windows" && os.Getenv("OPENVELO_CONTAINER_MODE") == "true"
	m := &Manager{
		useDockerCli: useCli,
		imageOsCache: make(map[string]string),
	}

	if useCli {
		return m
	}

	var opts []client.Opt
	dockerHost := os.Getenv("DOCKER_HOST")
	if dockerHost != "" {
		opts = append(opts, client.WithHost(dockerHost))
	} else if runtime.GOOS == "windows" {
		opts = append(opts, client.WithHost("npipe:////./pipe/docker_engine"))
	} else {
		user := os.Getenv("USER")
		if user == "" {
			user = os.Getenv("LOGNAME")
		}
		if user == "" {
			user = "root"
		}
		desktopSocket := fmt.Sprintf("/home/%s/.docker/desktop/docker.sock", user)
		if _, err := os.Stat(desktopSocket); err == nil {
			opts = append(opts, client.WithHost("unix://"+desktopSocket))
		} else {
			opts = append(opts, client.WithHost("unix:///var/run/docker.sock"))
		}
	}
	opts = append(opts, client.WithAPIVersionNegotiation())

	cli, err := client.NewClientWithOpts(opts...)
	if err != nil {
		fmt.Printf("[docker] Warning initializing docker client: %v\n", err)
	}
	m.cli = cli
	return m
}

func (m *Manager) FindFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}
	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func (m *Manager) ResolveNetworkMode(ctx context.Context) string {
	m.netModeOnce.Do(func() {
		if os.Getenv("OPENVELO_CONTAINER_MODE") != "true" {
			return
		}
		if m.useDockerCli {
			m.resolvedNetworkMode = m.resolveCliNetworkMode()
			return
		}
		hostname := os.Getenv("HOSTNAME")
		if hostname == "" || m.cli == nil {
			return
		}
		info, err := m.cli.ContainerInspect(ctx, hostname)
		if err != nil {
			fmt.Printf("[docker] Failed to resolve orchestrator network: %v\n", err)
			return
		}
		if info.NetworkSettings != nil && len(info.NetworkSettings.Networks) > 0 {
			for k := range info.NetworkSettings.Networks {
				m.resolvedNetworkMode = k
				fmt.Printf("[docker] Resolved orchestrator network: %s\n", k)
				break
			}
		}
	})
	return m.resolvedNetworkMode
}

func (m *Manager) resolveCliNetworkMode() string {
	cmd := exec.Command("hostname")
	out, err := cmd.Output()
	hostname := strings.TrimSpace(string(out))
	if err != nil || hostname == "" {
		hostname = strings.ToLower(os.Getenv("COMPUTERNAME"))
	}
	if hostname == "" {
		return ""
	}
	inspectCmd := exec.Command("docker", "inspect", "--format={{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{break}}{{end}}", hostname)
	inspOut, err := inspectCmd.Output()
	if err == nil {
		res := strings.TrimSpace(string(inspOut))
		if res != "" {
			fmt.Printf("[docker] Resolved CLI orchestrator network: %s\n", res)
			return res
		}
	}
	return ""
}

func (m *Manager) DetectImageOs(ctx context.Context, imageName string) string {
	m.cacheMu.RLock()
	if cached, ok := m.imageOsCache[imageName]; ok {
		m.cacheMu.RUnlock()
		return cached
	}
	m.cacheMu.RUnlock()

	var detected string
	if m.useDockerCli {
		cmd := exec.Command("docker", "inspect", "--format={{.Os}}", imageName)
		out, err := cmd.Output()
		if err == nil {
			detected = strings.TrimSpace(string(out))
		}
	} else if m.cli != nil {
		img, _, err := m.cli.ImageInspectWithRaw(ctx, imageName)
		if err == nil && img.Os != "" {
			detected = img.Os
		}
	}
	if detected == "" {
		detected = "linux"
	}

	m.cacheMu.Lock()
	m.imageOsCache[imageName] = detected
	m.cacheMu.Unlock()

	return detected
}

func toDockerPath(p string) string {
	if runtime.GOOS == "windows" {
		return strings.ReplaceAll(p, "\\", "/")
	}
	return p
}
