package config

import (
	"net/url"
)

// GenerateFinalRepoURL injects PAT credentials into repo URL based on host type.
func GenerateFinalRepoURL(repoURL, repoPAT, repoHost string) string {
	if repoPAT == "" {
		return repoURL
	}
	parsed, err := url.Parse(repoURL)
	if err != nil {
		return repoURL
	}
	if repoHost == "bitbucket" {
		parsed.User = url.UserPassword("x-token-auth", repoPAT)
	} else {
		parsed.User = url.UserPassword("token", repoPAT)
	}
	return parsed.String()
}
