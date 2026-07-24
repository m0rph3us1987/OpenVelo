package workflow

import (
	"context"
	"fmt"
	"time"

	"openvelo/orchestrator/internal/agentws"
	"openvelo/orchestrator/internal/config"
	"openvelo/orchestrator/internal/docker"
	"openvelo/orchestrator/internal/status"
	"openvelo/orchestrator/internal/wsclient"
)

func ProcessSingleJob(ctx context.Context, job wsclient.JobPayload) {
	if DefaultEngine.IsPaused() || DefaultEngine.IsShuttingDown() {
		fmt.Printf("[JOB %d] Orchestrator is paused/shutting down — ignoring assign_job.\n", job.ID)
		return
	}

	DefaultEngine.mu.Lock()
	if DefaultEngine.jobsInProgress[job.ID] {
		DefaultEngine.mu.Unlock()
		fmt.Printf("[JOB %d] Job is already being processed — ignoring duplicate.\n", job.ID)
		return
	}
	DefaultEngine.jobsInProgress[job.ID] = true
	DefaultEngine.activeJobCount++
	DefaultEngine.mu.Unlock()

	defer func() {
		DefaultEngine.mu.Lock()
		delete(DefaultEngine.activeContainers, job.ID)
		delete(DefaultEngine.jobsInProgress, job.ID)
		DefaultEngine.activeJobCount--
		DefaultEngine.mu.Unlock()

		status.DefaultTracker.ClearJobStatus(job.ID)
		if !DefaultEngine.IsPaused() && !DefaultEngine.IsShuttingDown() {
			wsclient.GetClient().Send(map[string]interface{}{"type": "ready"})
		}
	}()

	fmt.Printf("[JOB %d] Starting job for story\n", job.ID)
	cfg := config.Instance.GetSnapshot()

	retryCount := 0
	if job.RetryCount != nil {
		retryCount = *job.RetryCount
	}

	wsclient.GetClient().Send(map[string]interface{}{
		"type":        "job_update",
		"jobId":       job.ID,
		"status":      "RUNNING",
		"attempt":     retryCount + 1,
		"maxAttempts": cfg.MaxRetries,
		"timestamp":   time.Now().Format(time.RFC3339),
	})

	jobContent := FormatJobMarkdownFromJob(job)

	jobKind := "agent"
	if job.Type != nil && *job.Type == "test" {
		jobKind = "tester"
	}

	spawnImage := cfg.DockerImage
	if job.DockerImage != nil && *job.DockerImage != "" {
		spawnImage = *job.DockerImage
	} else if jobKind == "tester" && cfg.DockerImageTester != "" {
		spawnImage = cfg.DockerImageTester
	}

	spawnRes, err := docker.GetManager().SpawnAgent(ctx, job.ID, jobKind, spawnImage)
	if err != nil {
		fmt.Printf("[JOB %d] Failed to spawn %s container: %v\n", job.ID, jobKind, err)
		wsclient.GetClient().Send(map[string]interface{}{
			"type":        "job_update",
			"jobId":       job.ID,
			"status":      "PENDING",
			"containerId": nil,
			"timestamp":   time.Now().Format(time.RFC3339),
		})
		return
	}
	if spawnRes.VncHostPort > 0 {
		fmt.Printf("[JOB %d] Tester VNC view-only available at vnc://localhost:%d\n", job.ID, spawnRes.VncHostPort)
	}

	DefaultEngine.mu.Lock()
	DefaultEngine.activeContainers[job.ID] = spawnRes.ContainerID
	DefaultEngine.mu.Unlock()

	startedAt := time.Now().Format(time.RFC3339)
	jobUpdatePayload := map[string]interface{}{
		"type":        "job_update",
		"jobId":       job.ID,
		"status":      "RUNNING",
		"containerId": spawnRes.ContainerID,
		"startedAt":   startedAt,
		"attempt":     retryCount + 1,
		"maxAttempts": cfg.MaxRetries,
		"timestamp":   time.Now().Format(time.RFC3339),
	}
	if spawnRes.VncHostPort > 0 {
		jobUpdatePayload["vncHostPort"] = spawnRes.VncHostPort
	}
	wsclient.GetClient().Send(jobUpdatePayload)

	title := "No Title"
	if job.Title != nil {
		title = *job.Title
	}

	var connectErr error
	if jobKind == "tester" {
		passedTests := ""
		if job.PassedTests != nil {
			passedTests = *job.PassedTests
		}
		connectErr = agentws.ConnectToTester(ctx, job.ID, spawnRes.ContainerID, spawnRes.Host, spawnRes.Port, title, jobContent, retryCount, passedTests)
	} else {
		connectErr = agentws.ConnectToAgent(ctx, job.ID, spawnRes.ContainerID, spawnRes.Host, spawnRes.Port, title, jobContent, retryCount)
	}
	if connectErr != nil {
		fmt.Printf("[JOB %d] %s connection failed: %v\n", job.ID, jobKind, connectErr)
		wsclient.GetClient().Send(map[string]interface{}{
			"type":      "job_update",
			"jobId":     job.ID,
			"status":    "FAILED",
			"error":     connectErr.Error(),
			"timestamp": time.Now().Format(time.RFC3339),
		})

		st := status.DefaultTracker.GetJobStatus(job.ID)
		maxReached := false
		if st != nil {
			maxReached = st.Attempt >= st.MaxAttempts
		}
		if !maxReached {
			status.DefaultTracker.IncrementJobStatusRetry(job.ID)
			wsclient.GetClient().Send(map[string]interface{}{
				"type":  "job_retry",
				"jobId": job.ID,
			})
		}
	}
}

func FormatJobMarkdownFromJob(job wsclient.JobPayload) string {
	title := "No Title"
	if job.Title != nil {
		title = *job.Title
	}
	desc := "No description provided."
	if job.Description != nil {
		desc = *job.Description
	}
	return fmt.Sprintf("# Job %d: %s\n\n## Description\n%s\n", job.ID, title, desc)
}
