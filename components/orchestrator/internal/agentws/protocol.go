package agentws

import (
	"openvelo/orchestrator/internal/status"
)

type AgentHandshakeConfig struct {
	RepoURL            string `json:"repo_url"`
	RepoHost           string `json:"repo_host"`
	RepoPAT            string `json:"repo_pat"`
	Backend            string `json:"backend"`
	ExecutionModel     string `json:"execution_model"`
	BlueprintModel     string `json:"blueprint_model"`
	ReviewModel        string `json:"review_model"`
	DocumentationModel string `json:"documentation_model"`
	BuildCmd           string `json:"build_cmd"`
	TestCmd            string `json:"test_cmd"`
	StagingBranch      string `json:"staging_branch"`
	JobTitle           string `json:"job_title"`
	Story              string `json:"story,omitempty"`
	AgentMaxTimeout    int    `json:"agent_max_timeout"`
}

type AgentHandshakeMessage struct {
	Type   string               `json:"type"`
	JobID  int64                `json:"job_id"`
	Config AgentHandshakeConfig `json:"config"`
}

type AgentIncomingMessage struct {
	Type              string                `json:"type"`
	Message           string                `json:"message,omitempty"`
	Entries           []status.PlanEntry    `json:"entries,omitempty"`
	Usage             *status.UsageSnapshot `json:"usage,omitempty"`
	Used              *float64              `json:"used,omitempty"`
	Size              *float64              `json:"size,omitempty"`
	Cost              *status.Cost          `json:"cost,omitempty"`
	Stage             string                `json:"stage,omitempty"`
	Attempt           *int                  `json:"attempt,omitempty"`
	MaxRetries        *int                  `json:"max_retries,omitempty"`
	Status            string                `json:"status,omitempty"`
	Branch            string                `json:"branch,omitempty"`
	Error             string                `json:"error,omitempty"`
	MaxRetriesReached *bool                 `json:"maxRetriesReached,omitempty"`
	// Tester verdict fields (present on the terminal `finish` frame of a
	// tester run): the overall pass/fail outcome and its human summary.
	Verdict     string                `json:"verdict,omitempty"`
	Summary     string                `json:"summary,omitempty"`
	PassedTests string                `json:"passed_tests,omitempty"`
}

// TesterHandshakeConfig mirrors the tester's HandshakeConfig (snake_case
// JSON, wire-identical to the agent's HandshakeConfig but with two
// tester-only fields: repo_branch and test_plan).
type TesterHandshakeConfig struct {
	RepoURL         string `json:"repo_url"`
	RepoHost        string `json:"repo_host"`
	RepoPAT         string `json:"repo_pat"`
	RepoBranch      string `json:"repo_branch"`
	Backend         string `json:"backend"`
	ExecutionModel  string `json:"execution_model"`
	BuildCmd        string `json:"build_cmd"`
	TestCmd         string `json:"test_cmd"`
	TestPlan        string `json:"test_plan"`
	JobTitle        string `json:"job_title"`
	Story           string `json:"story,omitempty"`
	AgentMaxTimeout int    `json:"agent_max_timeout"`
	PassedTests     string `json:"passed_tests,omitempty"`
}

type TesterHandshakeMessage struct {
	Type   string                `json:"type"`
	JobID  int64                 `json:"job_id"`
	Config TesterHandshakeConfig `json:"config"`
}
