package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"openvelo/orchestrator/internal/agentws"
	"openvelo/orchestrator/internal/config"
	"openvelo/orchestrator/internal/status"
	"openvelo/orchestrator/internal/workflow"
	"openvelo/orchestrator/internal/wsclient"
)

func main() {
	var projectIDStr string
	for _, arg := range os.Args {
		if strings.HasPrefix(arg, "--project-id=") {
			projectIDStr = strings.TrimPrefix(arg, "--project-id=")
			break
		}
	}
	if projectIDStr == "" {
		projectIDStr = os.Getenv("PROJECT_ID")
	}

	if projectIDStr == "" {
		fmt.Fprintln(os.Stderr, "Error: --project-id=<id> argument or PROJECT_ID env var is required.")
		os.Exit(1)
	}

	projectID, err := strconv.ParseInt(projectIDStr, 10, 64)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Invalid project ID '%s': %v\n", projectIDStr, err)
		os.Exit(1)
	}

	config.Instance.ProjectID = &projectID

	fmt.Println("Starting OpenVelo Orchestrator...")
	fmt.Printf("Project ID: %d\n", projectID)

	configured := false
	client := wsclient.GetClient()

	client.OnMessage(func(rawData []byte) {
		var rawMap map[string]interface{}
		if err := json.Unmarshal(rawData, &rawMap); err != nil {
			fmt.Printf("[WS] Warning unmarshaling message: %v\n", err)
			return
		}

		msgType, _ := rawMap["type"].(string)

		switch msgType {
		case "configure":
			if rawCfg, ok := rawMap["config"].(map[string]interface{}); ok {
				fmt.Println("[CONFIG] Received project configuration from web-ui.")
				pCfg := wsclient.ParseProjectConfigFromMap(rawCfg)
				config.Instance.ApplyProjectConfig(pCfg)
				configured = true
				client.Send(map[string]interface{}{"type": "ready"})
			} else {
				fmt.Println("[CONFIG] Warning: configure message payload missing config map")
			}

		case "job_list":
			var jobs []wsclient.JobPayload
			if rawJobs, ok := rawMap["jobs"].([]interface{}); ok {
				for _, rj := range rawJobs {
					if jMap, ok := rj.(map[string]interface{}); ok {
						jobs = append(jobs, wsclient.ParseJobPayloadFromMap(jMap))
					}
				}
			}
			if len(jobs) == 0 {
				return
			}
			fmt.Printf("[POLL] Received %d job(s) from web-ui\n", len(jobs))
			for _, job := range jobs {
				if workflow.DefaultEngine.GetActiveJobCount() >= workflow.DefaultEngine.GetMaxParallelJobs() {
					fmt.Println("[POLL] Max parallel jobs reached, stopping polling for this cycle")
					break
				}
				go workflow.ProcessSingleJob(context.Background(), job)
			}

		case "pause":
			fmt.Println("[CTRL] Pausing orchestrator...")
			workflow.DefaultEngine.SetPaused(true)
			workflow.DefaultEngine.SetShuttingDown(true)
			agentws.DefaultManager.SetShuttingDown(true)
			workflow.DefaultEngine.StopAllContainers(context.Background())
			workflow.DefaultEngine.SetShuttingDown(false)
			agentws.DefaultManager.SetShuttingDown(false)
			fmt.Println("[CTRL] Orchestrator paused.")

		case "resume":
			fmt.Println("[CTRL] Resuming orchestrator...")
			workflow.DefaultEngine.SetPaused(false)

		case "shutdown":
			fmt.Println("[CTRL] Shutdown requested.")
			workflow.DefaultEngine.SetPaused(true)
			workflow.DefaultEngine.SetShuttingDown(true)
			agentws.DefaultManager.SetShuttingDown(true)

			if chk, ok := rawMap["checkpoint"].(bool); ok && chk {
				fmt.Println("[CTRL] Checkpointing agents before shutdown...")
				agentws.DefaultManager.CheckpointAllAgents()
			}
			workflow.DefaultEngine.StopAllContainers(context.Background())
			client.Send(map[string]interface{}{"type": "goodbye"})
			fmt.Println("[CTRL] Orchestrator shut down cleanly.")
			time.Sleep(500 * time.Millisecond)
			os.Exit(0)

		case "stop_job":
			if rawMap["jobId"] != nil {
				jobID := wsclient.AsInt64(rawMap["jobId"])
				fmt.Printf("[CTRL] Stop requested for job %d\n", jobID)
				agentws.DefaultManager.MarkJobAsStoppedByUser(jobID)
				workflow.DefaultEngine.StopSingleJobContainer(context.Background(), jobID)
				client.Send(map[string]interface{}{
					"type":      "job_update",
					"jobId":     jobID,
					"status":    "STOPPED",
					"timestamp": time.Now().Format(time.RFC3339),
				})
			}

		case "get_job_state":
			if rawMap["jobId"] != nil {
				jobID := wsclient.AsInt64(rawMap["jobId"])
				st := status.DefaultTracker.GetJobStatus(jobID)
				plan := status.DefaultTracker.GetJobPlan(jobID)
				usage := status.DefaultTracker.GetJobUsage(jobID)
				client.Send(map[string]interface{}{
					"type":  "job_state",
					"jobId": jobID,
					"state": st,
					"plan":  plan,
					"usage": usage,
				})
			}

		case "get_job_agent_status":
			if rawMap["jobId"] != nil {
				jobID := wsclient.AsInt64(rawMap["jobId"])
				st := status.DefaultTracker.GetJobStatus(jobID)
				plan := status.DefaultTracker.GetJobPlan(jobID)
				usage := status.DefaultTracker.GetJobUsage(jobID)
				client.Send(map[string]interface{}{
					"type":  "job_agent_status",
					"jobId": jobID,
					"state": st,
					"plan":  plan,
					"usage": usage,
				})
			}
		}
	})

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sigChan
		fmt.Println("Received shutdown signal.")
		workflow.DefaultEngine.SetPaused(true)
		workflow.DefaultEngine.SetShuttingDown(true)
		agentws.DefaultManager.SetShuttingDown(true)
		agentws.DefaultManager.CheckpointAllAgents()
		workflow.DefaultEngine.StopAllContainers(context.Background())
		os.Exit(0)
	}()

	client.Connect(projectID)

	ticker := time.NewTicker(1000 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		if !configured {
			continue
		}
		if workflow.DefaultEngine.IsPaused() || workflow.DefaultEngine.IsShuttingDown() {
			continue
		}

		activeCount := workflow.DefaultEngine.GetActiveJobCount()
		maxParallel := workflow.DefaultEngine.GetMaxParallelJobs()

		if activeCount >= maxParallel {
			continue
		}

		freeSlots := maxParallel - activeCount
		fmt.Printf("[POLL] Asking for %d job(s) (active=%d, max=%d)\n", freeSlots, activeCount, maxParallel)
		client.GetNextJobs(freeSlots)
	}
}
