package status

import (
	"sync"
)

type Tracker struct {
	mu          sync.RWMutex
	statuses    map[int64]*JobStatus
	retryCounts map[int64]int
	plans       map[int64][]PlanEntry
	usages      map[int64]*UsageSnapshot
}

var DefaultTracker = NewTracker()

func NewTracker() *Tracker {
	return &Tracker{
		statuses:    make(map[int64]*JobStatus),
		retryCounts: make(map[int64]int),
		plans:       make(map[int64][]PlanEntry),
		usages:      make(map[int64]*UsageSnapshot),
	}
}

func (t *Tracker) computeAttempt(jobID int64) int {
	return t.retryCounts[jobID] + 1
}

func (t *Tracker) InitJobStatus(jobID int64, startedAtIso string, maxAttempts int, retryCount *int) JobStatus {
	t.mu.Lock()
	defer t.mu.Unlock()

	if retryCount != nil {
		t.retryCounts[jobID] = *retryCount
	}
	attempt := t.retryCounts[jobID] + 1

	js := &JobStatus{
		JobID:         jobID,
		StartDateTime: startedAtIso,
		Stage:         "setup",
		Attempt:       attempt,
		MaxAttempts:   maxAttempts,
	}
	t.statuses[jobID] = js
	return *js
}

func (t *Tracker) UpdateJobStatusStage(jobID int64, stage string, agentAttempt *int, agentMaxRetries *int) *JobStatus {
	t.mu.Lock()
	defer t.mu.Unlock()

	js, exists := t.statuses[jobID]
	if !exists {
		return nil
	}
	js.Stage = stage
	js.Attempt = t.retryCounts[jobID] + 1
	if agentAttempt != nil {
		js.AgentAttempt = agentAttempt
	}
	if agentMaxRetries != nil {
		js.AgentMaxRetries = agentMaxRetries
	}
	res := *js
	return &res
}

func (t *Tracker) GetJobStatus(jobID int64) *JobStatus {
	t.mu.RLock()
	defer t.mu.RUnlock()

	js, exists := t.statuses[jobID]
	if !exists {
		return nil
	}
	res := *js
	return &res
}

func (t *Tracker) SetJobPlan(jobID int64, entries []PlanEntry) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.plans[jobID] = entries
}

func (t *Tracker) GetJobPlan(jobID int64) []PlanEntry {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.plans[jobID]
}

func (t *Tracker) UpdateJobUsage(jobID int64, patch UsageSnapshot) UsageSnapshot {
	t.mu.Lock()
	defer t.mu.Unlock()

	existing, ok := t.usages[jobID]
	if !ok {
		existing = &UsageSnapshot{}
		t.usages[jobID] = existing
	}

	if patch.Used != nil {
		existing.Used = patch.Used
	}
	if patch.Size != nil {
		existing.Size = patch.Size
	}
	if patch.TotalTokens != nil {
		existing.TotalTokens = patch.TotalTokens
	}
	if patch.InputTokens != nil {
		existing.InputTokens = patch.InputTokens
	}
	if patch.OutputTokens != nil {
		existing.OutputTokens = patch.OutputTokens
	}
	if patch.CachedReadTokens != nil {
		existing.CachedReadTokens = patch.CachedReadTokens
	}
	if patch.CachedWriteTokens != nil {
		existing.CachedWriteTokens = patch.CachedWriteTokens
	}
	if patch.Cost != nil {
		existing.Cost = patch.Cost
	}
	return *existing
}

func (t *Tracker) GetJobUsage(jobID int64) *UsageSnapshot {
	t.mu.RLock()
	defer t.mu.RUnlock()
	u, ok := t.usages[jobID]
	if !ok {
		return nil
	}
	res := *u
	return &res
}

func (t *Tracker) ClearJobStatus(jobID int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.statuses, jobID)
	delete(t.retryCounts, jobID)
	delete(t.plans, jobID)
	delete(t.usages, jobID)
}

func (t *Tracker) IncrementJobStatusRetry(jobID int64) int {
	t.mu.Lock()
	defer t.mu.Unlock()

	next := t.retryCounts[jobID] + 1
	t.retryCounts[jobID] = next
	if js, ok := t.statuses[jobID]; ok {
		js.Attempt = next + 1
		js.Stage = "setup"
	}
	return next
}
