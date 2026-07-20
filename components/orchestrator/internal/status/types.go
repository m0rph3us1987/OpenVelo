package status

type PlanEntry struct {
	Content  string `json:"content"`
	Status   string `json:"status"`   // pending, in_progress, completed
	Priority string `json:"priority"` // high, medium, low
}

type Cost struct {
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

type UsageSnapshot struct {
	Used              *float64 `json:"used,omitempty"`
	Size              *float64 `json:"size,omitempty"`
	TotalTokens       *int64   `json:"totalTokens,omitempty"`
	InputTokens       *int64   `json:"inputTokens,omitempty"`
	OutputTokens      *int64   `json:"outputTokens,omitempty"`
	CachedReadTokens  *int64   `json:"cachedReadTokens,omitempty"`
	CachedWriteTokens *int64   `json:"cachedWriteTokens,omitempty"`
	Cost              *Cost    `json:"cost,omitempty"`
}

type JobStatus struct {
	JobID           int64  `json:"jobId"`
	StartDateTime   string `json:"startDateTime"`
	Stage           string `json:"stage"`
	Attempt         int    `json:"attempt"`
	MaxAttempts     int    `json:"maxAttempts"`
	AgentAttempt    *int   `json:"agentAttempt,omitempty"`
	AgentMaxRetries *int   `json:"agentMaxRetries,omitempty"`
}
