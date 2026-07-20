package wsclient

import (
	"fmt"
	"strconv"
	"strings"

	"openvelo/orchestrator/internal/config"
)

type JobPayload struct {
	ID                 int64   `json:"id"`
	Title              *string `json:"title"`
	Description        *string `json:"description"`
	AcceptanceCriteria *string `json:"acceptance_criteria"`
	RetryCount         *int    `json:"retry_count"`
	Type               *string `json:"type,omitempty"`
	DockerImage        *string `json:"docker_image,omitempty"`
	PassedTests        *string `json:"passed_tests,omitempty"`
}

type GenericIncomingMessage struct {
	Type       string                `json:"type"`
	Config     *config.ProjectConfig `json:"config,omitempty"`
	Jobs       []JobPayload          `json:"jobs,omitempty"`
	JobID      *int64                `json:"jobId,omitempty"`
	Checkpoint *bool                 `json:"checkpoint,omitempty"`
}

type OutgoingMessage map[string]interface{}

func AsString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case fmt.Stringer:
		return val.String()
	default:
		return fmt.Sprintf("%v", val)
	}
}

func AsStringPtr(v interface{}) *string {
	if v == nil {
		return nil
	}
	s := AsString(v)
	return &s
}

func AsInt(v interface{}) int {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case float64:
		return int(val)
	case int:
		return val
	case int64:
		return int(val)
	case string:
		i, _ := strconv.Atoi(val)
		return i
	default:
		return 0
	}
}

func AsIntPtr(v interface{}) *int {
	if v == nil {
		return nil
	}
	i := AsInt(v)
	return &i
}

func AsInt64(v interface{}) int64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case float64:
		return int64(val)
	case int:
		return int64(val)
	case int64:
		return val
	case string:
		i, _ := strconv.ParseInt(val, 10, 64)
		return i
	default:
		return 0
	}
}

func AsBool(v interface{}) bool {
	if v == nil {
		return false
	}
	switch val := v.(type) {
	case bool:
		return val
	case float64:
		return val != 0
	case int:
		return val != 0
	case int64:
		return val != 0
	case string:
		s := strings.ToLower(strings.TrimSpace(val))
		return s == "true" || s == "1" || s == "yes"
	default:
		return false
	}
}

func AsBoolPtr(v interface{}) *bool {
	if v == nil {
		return nil
	}
	b := AsBool(v)
	return &b
}

func ParseProjectConfigFromMap(m map[string]interface{}) config.ProjectConfig {
	var cfg config.ProjectConfig
	cfg.ID = AsInt64(m["id"])
	cfg.Port = AsInt(m["port"])
	cfg.RepoURL = AsString(m["repo_url"])
	cfg.RepoHost = AsString(m["repo_host"])
	if m["repo_pat"] != nil {
		cfg.RepoPAT = AsStringPtr(m["repo_pat"])
	}
	cfg.DockerImage = AsString(m["docker_image"])
	cfg.DockerImageTester = AsString(m["docker_image_tester"])
	cfg.Backend = AsString(m["backend"])
	if m["execution_model"] != nil {
		cfg.ExecutionModel = AsStringPtr(m["execution_model"])
	}
	if m["blueprint_model"] != nil {
		cfg.BlueprintModel = AsStringPtr(m["blueprint_model"])
	}
	if m["review_model"] != nil {
		cfg.ReviewModel = AsStringPtr(m["review_model"])
	}
	if m["documentation_model"] != nil {
		cfg.DocumentationModel = AsStringPtr(m["documentation_model"])
	}
	if m["build_cmd"] != nil {
		cfg.BuildCmd = AsStringPtr(m["build_cmd"])
	}
	if m["test_cmd"] != nil {
		cfg.TestCmd = AsStringPtr(m["test_cmd"])
	}
	if m["test_plan"] != nil {
		cfg.TestPlan = AsStringPtr(m["test_plan"])
	}
	cfg.StagingBranch = AsString(m["staging_branch"])
	cfg.PollInterval = AsInt(m["poll_interval"])
	cfg.AgentMaxTimeout = AsInt(m["agent_max_timeout"])
	cfg.MaxParallelJobs = AsInt(m["max_parallel_jobs"])
	if m["max_retries"] != nil {
		cfg.MaxRetries = AsIntPtr(m["max_retries"])
	}
	if m["agent_max_retries"] != nil {
		cfg.AgentMaxRetries = AsIntPtr(m["agent_max_retries"])
	}
	if m["remove_deleted_containers"] != nil {
		cfg.RemoveDeletedContainers = AsBoolPtr(m["remove_deleted_containers"])
	}
	return cfg
}

func ParseJobPayloadFromMap(m map[string]interface{}) JobPayload {
	var job JobPayload
	job.ID = AsInt64(m["id"])
	if m["title"] != nil {
		job.Title = AsStringPtr(m["title"])
	}
	if m["description"] != nil {
		job.Description = AsStringPtr(m["description"])
	}
	if m["acceptance_criteria"] != nil {
		job.AcceptanceCriteria = AsStringPtr(m["acceptance_criteria"])
	}
	if m["retry_count"] != nil {
		job.RetryCount = AsIntPtr(m["retry_count"])
	}
	if m["type"] != nil {
		job.Type = AsStringPtr(m["type"])
	}
	if m["docker_image"] != nil {
		job.DockerImage = AsStringPtr(m["docker_image"])
	}
	if m["passed_tests"] != nil {
		job.PassedTests = AsStringPtr(m["passed_tests"])
	}
	return job
}
