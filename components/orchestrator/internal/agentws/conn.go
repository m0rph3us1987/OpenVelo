package agentws

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"openvelo/orchestrator/internal/config"
	"openvelo/orchestrator/internal/docker"
	"openvelo/orchestrator/internal/status"
	"openvelo/orchestrator/internal/wsclient"
)

func ConnectToAgent(ctx context.Context, jobID int64, containerID, host string, port int, jobTitle, story string, retryCount int) error {
	cfg := config.Instance.GetSnapshot()
	js := status.DefaultTracker.InitJobStatus(jobID, time.Now().Format(time.RFC3339), cfg.MaxRetries, &retryCount)
	broadcastInitialStage(jobID, js)

	handshake := AgentHandshakeMessage{
		Type:  "handshake",
		JobID: jobID,
		Config: AgentHandshakeConfig{
			RepoURL:            cfg.RepoURL,
			RepoHost:           cfg.RepoHost,
			RepoPAT:            cfg.RepoPAT,
			Backend:            cfg.Backend,
			ExecutionModel:     cfg.BackendModel,
			BlueprintModel:     cfg.BackendBlueprintModel,
			ReviewModel:        cfg.BackendReviewModel,
			DocumentationModel: cfg.BackendDocumentationModel,
			BuildCmd:           cfg.BuildCmd,
			TestCmd:            cfg.TestCmd,
			StagingBranch:      cfg.StagingBranch,
			JobTitle:           jobTitle,
			Story:              story,
			AgentMaxTimeout:    cfg.AgentMaxTimeout,
		},
	}
	return runJobWebSocket(ctx, jobID, containerID, host, port, "agent", handshake, retryCount)
}

// ConnectToTester mirrors ConnectToAgent but sends the tester-flavoured
// handshake (with repo_branch and test_plan) to a spawned tester container.
// The tester's WS server is exposed on the same port that was published
// from the container.
func ConnectToTester(ctx context.Context, jobID int64, containerID, host string, port int, jobTitle, story string, retryCount int, passedTests string) error {
	cfg := config.Instance.GetSnapshot()
	js := status.DefaultTracker.InitJobStatus(jobID, time.Now().Format(time.RFC3339), cfg.MaxRetries, &retryCount)
	broadcastInitialStage(jobID, js)

	// The tester treats the job's `story` (description) as the test plan
	// — that's the natural source for "what to test" in this iteration.
	testPlan := story
	if cfg.TestPlan != "" {
		testPlan = cfg.TestPlan
	}

	handshake := TesterHandshakeMessage{
		Type:  "handshake",
		JobID: jobID,
		Config: TesterHandshakeConfig{
			RepoURL:         cfg.RepoURL,
			RepoHost:        cfg.RepoHost,
			RepoPAT:         cfg.RepoPAT,
			RepoBranch:      cfg.StagingBranch,
			Backend:         cfg.Backend,
			ExecutionModel:  cfg.BackendModel,
			BuildCmd:        cfg.BuildCmd,
			TestCmd:         cfg.TestCmd,
			TestPlan:        testPlan,
			JobTitle:        jobTitle,
			Story:           story,
			AgentMaxTimeout: cfg.AgentMaxTimeout,
			PassedTests:     passedTests,
		},
	}
	return runJobWebSocket(ctx, jobID, containerID, host, port, "tester", handshake, retryCount)
}

// runJobWebSocket is the shared dial → handshake → read-loop plumbing
// used by both ConnectToAgent and ConnectToTester. The handshake message
// is JSON-marshalled and sent verbatim; both agent and tester share the
// same wire format for the inbound messages they stream back.
func runJobWebSocket(ctx context.Context, jobID int64, containerID, host string, port int, kind string, handshake interface{}, retryCount int) error {
	cfg := config.Instance.GetSnapshot()

	url := fmt.Sprintf("ws://%s:%d", host, port)
	maxRetries := 10
	var conn *websocket.Conn
	var err error

	for retries := 0; retries < maxRetries; retries++ {
		fmt.Printf("Attempting to connect to %s at %s (Attempt %d/%d)...\n", kind, url, retries+1, maxRetries)
		dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
		conn, _, err = dialer.Dial(url, http.Header{})
		if err == nil {
			break
		}
		time.Sleep(1 * time.Second)
	}

	if err != nil {
		return fmt.Errorf("failed to connect to %s after %d attempts: %w", kind, maxRetries, err)
	}

	DefaultManager.RegisterAgent(jobID, conn)
	defer DefaultManager.UnregisterAgent(jobID)

	fmt.Printf("Connected to %s for job %d. Sending handshake...\n", kind, jobID)
	handshakeBytes, err := json.Marshal(handshake)
	if err != nil {
		conn.Close()
		return fmt.Errorf("failed to marshal handshake: %w", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, handshakeBytes); err != nil {
		conn.Close()
		return fmt.Errorf("failed to send handshake: %w", err)
	}

	finishedCleanly := false
	jobFinishedStatus := "unknown"

	var timerMu sync.Mutex
	inactivityTimer := time.NewTimer(time.Duration(cfg.AgentMaxTimeout) * time.Second)
	resetInactivity := func() {
		timerMu.Lock()
		defer timerMu.Unlock()
		if !inactivityTimer.Stop() {
			select {
			case <-inactivityTimer.C:
			default:
			}
		}
		inactivityTimer.Reset(time.Duration(cfg.AgentMaxTimeout) * time.Second)
	}

	go func() {
		select {
		case <-inactivityTimer.C:
			fmt.Printf("[JOB %d] %s inactivity timeout reached.\n", jobID, kind)
			finishedCleanly = true
			DefaultManager.CheckpointAgent(jobID, conn)

			wsclient.GetClient().Send(map[string]interface{}{
				"type":      "job_update",
				"jobId":     jobID,
				"status":    "FAILED",
				"error":     fmt.Sprintf("%s inactivity timeout", kind),
				"timestamp": time.Now().Format(time.RFC3339),
			})

			st := status.DefaultTracker.GetJobStatus(jobID)
			maxReached := true
			if st != nil {
				maxReached = st.Attempt >= st.MaxAttempts
			}

			if !maxReached {
				status.DefaultTracker.IncrementJobStatusRetry(jobID)
				wsclient.GetClient().Send(map[string]interface{}{
					"type":  "job_retry",
					"jobId": jobID,
				})
			} else {
				fmt.Printf("Job %d reached max retries, not retrying.\n", jobID)
			}
			conn.Close()
		}
	}()

	readLoopDone := make(chan struct{})

	go func() {
		defer close(readLoopDone)
		for {
			_, messageBytes, err := conn.ReadMessage()
			if err != nil {
				break
			}
			var payload AgentIncomingMessage
			if err := json.Unmarshal(messageBytes, &payload); err != nil {
				continue
			}

			switch payload.Type {
			case "status", "info", "error", "warn", "stdout", "stderr":
				resetInactivity()
				if payload.Type == "stdout" || payload.Type == "stderr" {
					wsclient.GetClient().Send(map[string]interface{}{
						"type":    "job_log_chunk",
						"jobId":   jobID,
						"chunk":   payload.Message,
						"logType": payload.Type,
					})
				} else {
					wsclient.GetClient().Send(map[string]interface{}{
						"type":    "log",
						"jobId":   jobID,
						"logType": payload.Type,
						"message": payload.Message,
					})
				}

			case "plan":
				status.DefaultTracker.SetJobPlan(jobID, payload.Entries)
				wsclient.GetClient().Send(map[string]interface{}{
					"type":      "job_plan_update",
					"jobId":     jobID,
					"entries":   payload.Entries,
					"timestamp": time.Now().Format(time.RFC3339),
				})

			case "usage":
				if payload.Usage != nil {
					snapshot := status.DefaultTracker.UpdateJobUsage(jobID, *payload.Usage)
					wsclient.GetClient().Send(map[string]interface{}{
						"type":             "job_usage_update",
						"jobId":            jobID,
						"totalTokens":      snapshot.TotalTokens,
						"inputTokens":      snapshot.InputTokens,
						"outputTokens":     snapshot.OutputTokens,
						"cachedReadTokens":  snapshot.CachedReadTokens,
						"cachedWriteTokens": snapshot.CachedWriteTokens,
						"cost":             snapshot.Cost,
						"timestamp":        time.Now().Format(time.RFC3339),
					})
				}

			case "context":
				patch := status.UsageSnapshot{
					Used: payload.Used,
					Size: payload.Size,
					Cost: payload.Cost,
				}
				snapshot := status.DefaultTracker.UpdateJobUsage(jobID, patch)
				wsclient.GetClient().Send(map[string]interface{}{
					"type":      "job_usage_update",
					"jobId":     jobID,
					"used":      snapshot.Used,
					"size":      snapshot.Size,
					"cost":      snapshot.Cost,
					"timestamp": time.Now().Format(time.RFC3339),
				})

			case "stage":
				fmt.Printf("[JOB %d] [STAGE] %s\n", jobID, payload.Stage)
				js := status.DefaultTracker.UpdateJobStatusStage(jobID, payload.Stage, payload.Attempt, payload.MaxRetries)
				msg := map[string]interface{}{
					"type":            "job_update",
					"jobId":           jobID,
					"status":          "RUNNING",
					"stage":           payload.Stage,
					"agentAttempt":    payload.Attempt,
					"agentMaxRetries": payload.MaxRetries,
					"timestamp":       time.Now().Format(time.RFC3339),
				}
				if js != nil {
					msg["startDateTime"] = js.StartDateTime
					msg["attempt"] = js.Attempt
					msg["maxAttempts"] = js.MaxAttempts
				}
				wsclient.GetClient().Send(msg)

			case "finish":
				timerMu.Lock()
				inactivityTimer.Stop()
				timerMu.Unlock()

				finishedCleanly = true
				jobFinishedStatus = payload.Status
				fmt.Printf("Job %d finished with status: %s (verdict: %s)\n", jobID, payload.Status, payload.Verdict)

				if payload.Status != "success" {
					wsclient.GetClient().Send(map[string]interface{}{
						"type":         "job_update",
						"jobId":        jobID,
						"status":       "FAILED",
						"error":        payload.Error,
						"verdict":      payload.Verdict,
						"summary":      payload.Summary,
						"passed_tests": payload.PassedTests,
						"timestamp":    time.Now().Format(time.RFC3339),
					})
					maxReached := false
					if payload.MaxRetriesReached != nil {
						maxReached = *payload.MaxRetriesReached
					}
					if !maxReached {
						status.DefaultTracker.IncrementJobStatusRetry(jobID)
						wsclient.GetClient().Send(map[string]interface{}{
							"type":  "job_retry",
							"jobId": jobID,
						})
					} else {
						fmt.Printf("Job %d reached max retries, not retrying.\n", jobID)
					}
					conn.Close()
					return
				}

				wsclient.GetClient().Send(map[string]interface{}{
					"type":         "job_update",
					"jobId":        jobID,
					"status":       "COMPLETED",
					"branch":       payload.Branch,
					"verdict":      payload.Verdict,
					"summary":      payload.Summary,
					"passed_tests": payload.PassedTests,
					"timestamp":    time.Now().Format(time.RFC3339),
				})
				conn.Close()
				return
			}
		}
	}()

	<-readLoopDone

	timerMu.Lock()
	inactivityTimer.Stop()
	timerMu.Unlock()

	conn.Close()

	if DefaultManager.IsJobStopped(jobID) {
		DefaultManager.ClearStoppedJob(jobID)
		if cfg.RemoveDeletedContainers {
			_ = docker.GetManager().RemoveAgent(ctx, containerID)
		} else {
			_ = docker.GetManager().StopAgent(ctx, containerID)
		}
	} else if finishedCleanly {
		if jobFinishedStatus == "success" && cfg.RemoveDeletedContainers {
			_ = docker.GetManager().RemoveAgent(ctx, containerID)
		}
	} else if !DefaultManager.IsShuttingDown() {
		wsclient.GetClient().Send(map[string]interface{}{
			"type":      "job_update",
			"jobId":     jobID,
			"status":    "FAILED",
			"error":     fmt.Sprintf("%s container crashed abruptly", kind),
			"timestamp": time.Now().Format(time.RFC3339),
		})
		status.DefaultTracker.IncrementJobStatusRetry(jobID)
		wsclient.GetClient().Send(map[string]interface{}{
			"type":  "job_retry",
			"jobId": jobID,
		})
	}

	return nil
}

// broadcastInitialStage pushes the initial "setup" stage to the WS clients
// the moment the orchestrator starts a job — so the web-ui's pipeline timeline
// lights up immediately, without waiting for the agent's first `stage` frame.
func broadcastInitialStage(jobID int64, js status.JobStatus) {
	if js.Stage == "" {
		return
	}
	wsclient.GetClient().Send(map[string]interface{}{
		"type":          "job_update",
		"jobId":         jobID,
		"status":        "RUNNING",
		"stage":         js.Stage,
		"startDateTime": js.StartDateTime,
		"attempt":       js.Attempt,
		"maxAttempts":   js.MaxAttempts,
		"timestamp":     time.Now().Format(time.RFC3339),
	})
}
