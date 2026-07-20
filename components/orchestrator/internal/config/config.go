package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/joho/godotenv"
)

type ProjectConfig struct {
	ID                     int64   `json:"id"`
	Port                   int     `json:"port"`
	RepoURL                string  `json:"repo_url"`
	RepoHost               string  `json:"repo_host"`
	RepoPAT                *string `json:"repo_pat"`
	DockerImage            string  `json:"docker_image"`
	DockerImageTester      string  `json:"docker_image_tester"`
	Backend                string  `json:"backend"`
	ExecutionModel         *string `json:"execution_model"`
	BlueprintModel         *string `json:"blueprint_model"`
	ReviewModel            *string `json:"review_model"`
	DocumentationModel     *string `json:"documentation_model"`
	BuildCmd               *string `json:"build_cmd"`
	TestCmd                *string `json:"test_cmd"`
	TestPlan               *string `json:"test_plan"`
	StagingBranch          string  `json:"staging_branch"`
	PollInterval           int     `json:"poll_interval"`
	AgentMaxTimeout        int     `json:"agent_max_timeout"`
	MaxParallelJobs        int     `json:"max_parallel_jobs"`
	MaxRetries             *int    `json:"max_retries"`
	AgentMaxRetries        *int    `json:"agent_max_retries"`
	RemoveDeletedContainers *bool   `json:"remove_deleted_containers"`
}

type GlobalConfig struct {
	mu sync.RWMutex

	ContainerMode             bool
	WebUIURL                  string
	TempDataPath              string
	TempDataHostPath          string
	SkillsHostPath            string
	RepoURL                   string
	RepoHost                  string
	RepoPAT                   string
	Backend                   string
	BackendModel              string
	BackendBlueprintModel     string
	BackendReviewModel        string
	BackendDocumentationModel string
	DockerImage               string
	DockerImageTester         string
	AgentMaxTimeout           int
	MaxParallelJobs           int
	MaxRetries                int
	AgentMaxRetries           int
	PollInterval              int
	BuildCmd                  string
	TestCmd                   string
	TestPlan                  string
	StagingBranch             string
	RemoveDeletedContainers    bool
	ProjectID                 *int64
}

var Instance *GlobalConfig

func init() {
	_ = godotenv.Load(".env.local")
	_ = godotenv.Load("../.env.local")

	cwd, _ := os.Getwd()
	rawTempData := os.Getenv("OPENVELO_TEMP_DATA_PATH")
	if rawTempData == "" {
		rawTempData = filepath.Join(cwd, "temp_data")
	}

	rawHostPath := os.Getenv("OPENVELO_TEMP_DATA_HOST_PATH")
	if rawHostPath == "" {
		rawHostPath = rawTempData
	}
	resolvedHostPath := rawHostPath
	if !filepath.IsAbs(rawHostPath) {
		resolvedHostPath, _ = filepath.Abs(rawHostPath)
	}

	rawSkillsHostPath := os.Getenv("OPENVELO_SKILLS_HOST_PATH")
	if rawSkillsHostPath == "" {
		cwdSkills := filepath.Join(cwd, "data", "SKILLS")
		parentSkills := filepath.Join(cwd, "..", "..", "data", "SKILLS")
		if _, err := os.Stat(cwdSkills); err == nil {
			rawSkillsHostPath = cwdSkills
		} else if _, err := os.Stat(parentSkills); err == nil {
			rawSkillsHostPath = parentSkills
		} else {
			rawSkillsHostPath = cwdSkills
		}
	}
	resolvedSkillsHostPath := rawSkillsHostPath
	if !filepath.IsAbs(rawSkillsHostPath) {
		resolvedSkillsHostPath, _ = filepath.Abs(rawSkillsHostPath)
	}

	webUI := os.Getenv("WEB_UI_URL")
	if webUI == "" {
		webUI = "ws://localhost:3000"
	}
	webUI = strings.TrimSuffix(webUI, "/")

	dockerImg := os.Getenv("DOCKER_IMAGE")
	if dockerImg == "" {
		dockerImg = "openvelo-agent:linux"
	}

	dockerTesterImg := os.Getenv("DOCKER_IMAGE_TESTER")
	if dockerTesterImg == "" {
		dockerTesterImg = "openvelo-tester:linux"
	}

	agentTimeout, _ := strconv.Atoi(getEnvDefault("AGENT_MAX_TIMEOUT", "300"))
	maxParallel, _ := strconv.Atoi(getEnvDefault("MAX_PARALLEL_JOBS", "1"))
	maxRetries, _ := strconv.Atoi(getEnvDefault("MAX_RETRIES", "3"))
	agentMaxRetries, _ := strconv.Atoi(getEnvDefault("AGENT_MAX_RETRIES", "3"))
	pollInterval, _ := strconv.Atoi(getEnvDefault("POLL_INTERVAL", "60000"))

	stagingBranch := os.Getenv("STAGING_BRANCH")
	if stagingBranch == "" {
		stagingBranch = "staging"
	}

	repoHost := os.Getenv("REPO_HOST")
	if repoHost == "" {
		repoHost = "github"
	}

	backend := os.Getenv("BACKEND")
	if backend == "" {
		backend = "kilo"
	}

	removeDeleted := os.Getenv("REMOVE_DELETED_CONTAINERS") != "false"

	Instance = &GlobalConfig{
		ContainerMode:          os.Getenv("OPENVELO_CONTAINER_MODE") == "true",
		WebUIURL:               webUI,
		TempDataPath:           rawTempData,
		TempDataHostPath:       resolvedHostPath,
		SkillsHostPath:         resolvedSkillsHostPath,
		RepoURL:                os.Getenv("REPO_URL"),
		RepoHost:               repoHost,
		RepoPAT:                os.Getenv("REPO_PAT"),
		Backend:                backend,
		BackendModel:           os.Getenv("BACKEND_MODEL"),
		DockerImage:            dockerImg,
		DockerImageTester:      dockerTesterImg,
		AgentMaxTimeout:        agentTimeout,
		MaxParallelJobs:        maxParallel,
		MaxRetries:             maxRetries,
		AgentMaxRetries:        agentMaxRetries,
		PollInterval:           pollInterval,
		BuildCmd:               os.Getenv("BUILD_CMD"),
		TestCmd:                os.Getenv("TEST_CMD"),
		TestPlan:               os.Getenv("TEST_PLAN"),
		StagingBranch:          stagingBranch,
		RemoveDeletedContainers: removeDeleted,
	}
}

func getEnvDefault(key, def string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return def
}

func (c *GlobalConfig) ApplyProjectConfig(project ProjectConfig) {
	c.mu.Lock()
	defer c.mu.Unlock()

	pat := ""
	if project.RepoPAT != nil {
		pat = *project.RepoPAT
	}

	c.RepoURL = GenerateFinalRepoURL(project.RepoURL, pat, project.RepoHost)
	if project.RepoHost != "" {
		c.RepoHost = project.RepoHost
	} else {
		c.RepoHost = "github"
	}
	c.RepoPAT = pat
	c.Backend = project.Backend

	if project.ExecutionModel != nil {
		c.BackendModel = *project.ExecutionModel
	}
	if project.BlueprintModel != nil {
		c.BackendBlueprintModel = *project.BlueprintModel
	}
	if project.ReviewModel != nil {
		c.BackendReviewModel = *project.ReviewModel
	}
	if project.DocumentationModel != nil {
		c.BackendDocumentationModel = *project.DocumentationModel
	}

	c.DockerImage = project.DockerImage
	c.DockerImageTester = project.DockerImageTester
	if project.BuildCmd != nil {
		c.BuildCmd = *project.BuildCmd
	}
	if project.TestCmd != nil {
		c.TestCmd = *project.TestCmd
	}
	if project.TestPlan != nil {
		c.TestPlan = *project.TestPlan
	}
	c.StagingBranch = project.StagingBranch
	c.PollInterval = project.PollInterval
	c.AgentMaxTimeout = project.AgentMaxTimeout
	c.MaxParallelJobs = project.MaxParallelJobs

	if project.MaxRetries != nil {
		c.MaxRetries = *project.MaxRetries
	} else {
		c.MaxRetries = 3
	}
	if project.AgentMaxRetries != nil {
		c.AgentMaxRetries = *project.AgentMaxRetries
	} else {
		c.AgentMaxRetries = 3
	}
	if project.RemoveDeletedContainers != nil {
		c.RemoveDeletedContainers = *project.RemoveDeletedContainers
	} else {
		c.RemoveDeletedContainers = true
	}
	c.ProjectID = &project.ID
}

func (c *GlobalConfig) GetSnapshot() GlobalConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return *c
}
