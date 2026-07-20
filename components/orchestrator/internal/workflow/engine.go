package workflow

import (
	"context"
	"fmt"
	"sync"

	"openvelo/orchestrator/internal/config"
	"openvelo/orchestrator/internal/docker"
	"openvelo/orchestrator/internal/wsclient"
)

type Engine struct {
	mu               sync.RWMutex
	isPaused         bool
	isShuttingDown   bool
	activeJobCount   int
	activeContainers map[int64]string
	jobsInProgress   map[int64]bool
}

var DefaultEngine = NewEngine()

func NewEngine() *Engine {
	return &Engine{
		activeContainers: make(map[int64]string),
		jobsInProgress:   make(map[int64]bool),
	}
}

func (e *Engine) SetPaused(val bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.isPaused = val
}

func (e *Engine) IsPaused() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.isPaused
}

func (e *Engine) SetShuttingDown(val bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.isShuttingDown = val
}

func (e *Engine) IsShuttingDown() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.isShuttingDown
}

func (e *Engine) GetActiveJobCount() int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.activeJobCount
}

func (e *Engine) GetMaxParallelJobs() int {
	return config.Instance.GetSnapshot().MaxParallelJobs
}

func (e *Engine) StopAllContainers(ctx context.Context) {
	e.mu.Lock()
	containers := make(map[int64]string)
	for k, v := range e.activeContainers {
		containers[k] = v
	}
	e.mu.Unlock()

	var wg sync.WaitGroup
	for jobID, cid := range containers {
		wg.Add(1)
		go func(jID int64, containerID string) {
			defer wg.Done()
			fmt.Printf("Stopping container %s (job %d)\n", containerID, jID)
			_ = docker.GetManager().StopAgent(ctx, containerID)
			wsclient.GetClient().Send(map[string]interface{}{
				"type":        "job_update",
				"jobId":       jID,
				"status":      "PENDING",
				"containerId": nil,
			})
		}(jobID, cid)
	}
	wg.Wait()

	e.mu.Lock()
	e.activeContainers = make(map[int64]string)
	e.mu.Unlock()
}

func (e *Engine) StopSingleJobContainer(ctx context.Context, jobID int64) bool {
	e.mu.Lock()
	cid, ok := e.activeContainers[jobID]
	if ok {
		delete(e.activeContainers, jobID)
	}
	e.mu.Unlock()

	if ok {
		fmt.Printf("Stopping container %s for job %d\n", cid, jobID)
		_ = docker.GetManager().StopAgent(ctx, cid)
		return true
	}
	return false
}
