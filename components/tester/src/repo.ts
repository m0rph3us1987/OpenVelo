import { CONFIG } from './config.js';
import { runCommand } from './shell.js';
import { resetToStaging } from './git-helpers/index.js';

function sharedRepoPath(): string {
    return process.env.SHARED_REPO_PATH || '/shared_repo';
}

export async function mountAndReset(): Promise<void> {
    const branch = CONFIG.REPO_BRANCH;
    if (!branch) {
        throw new Error('REPO_BRANCH (== staging_branch) not provided');
    }

    await resetToStaging({
        sharedRepoPath: sharedRepoPath(),
        repoPath: CONFIG.REPO_PATH,
        stagingBranch: branch,
        runCommand,
    });
}
