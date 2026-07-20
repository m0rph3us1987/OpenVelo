package docker

import (
	"context"
	"os/exec"
	"strings"
	"time"

	containerTypes "github.com/docker/docker/api/types/container"
	"github.com/docker/docker/pkg/stdcopy"
)

func (m *Manager) GetContainerStartedAt(ctx context.Context, containerID string) string {
	if m.useDockerCli {
		cmd := exec.Command("docker", "inspect", "--format={{.State.StartedAt}}", containerID)
		out, err := cmd.Output()
		if err != nil {
			return ""
		}
		startedAtStr := strings.TrimSpace(string(out))
		if startedAtStr == "" {
			return ""
		}
		t, err := time.Parse(time.RFC3339Nano, startedAtStr)
		if err != nil {
			return ""
		}
		return t.Format(time.RFC3339)
	}

	if m.cli == nil {
		return ""
	}
	info, err := m.cli.ContainerInspect(ctx, containerID)
	if err != nil || info.State == nil || info.State.StartedAt == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339Nano, info.State.StartedAt)
	if err != nil {
		return ""
	}
	return t.Format(time.RFC3339)
}

func (m *Manager) GetContainerLogs(ctx context.Context, containerID string) string {
	if m.useDockerCli {
		cmd := exec.Command("docker", "logs", containerID)
		out, err := cmd.Output()
		if err != nil {
			return "No logs available"
		}
		res := strings.TrimSpace(string(out))
		if res == "" {
			return "No logs available"
		}
		return res
	}

	if m.cli == nil {
		return "No logs available"
	}

	options := containerTypes.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Timestamps: false,
	}
	out, err := m.cli.ContainerLogs(ctx, containerID, options)
	if err != nil {
		return "No logs available"
	}
	defer out.Close()

	var stdout, stderr strings.Builder
	_, err = stdcopy.StdCopy(&stdout, &stderr, out)
	if err != nil {
		return "No logs available"
	}

	res := strings.TrimSpace(stdout.String() + "\n" + stderr.String())
	if res == "" {
		return "No logs available"
	}
	return res
}
