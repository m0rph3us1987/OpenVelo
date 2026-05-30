import * as fs from 'fs';
import * as path from 'path';
import { CONFIG } from './config.js';
import { messenger } from './messenger.js';
import { runCommand, isWatchMode } from './shell.js';
import { createAndMergePR as createAdoPR } from './ado.js';
import { createAndMergePR as createGithubPR } from './github.js';
import { createAndMergePR as createGiteaPR } from './gitea.js';
import { dotnetSetup, isDotnetRepo, runDotnetBuild } from './dotnet.js';
import { openCodeServerManager } from './opencode-server.js';
import { AgentSession } from './session.js';

const IS_WINDOWS = CONFIG.AGENT_PLATFORM === 'windows';

export class WorkflowEngine {
    private readonly checkpointBranch = `feature-${CONFIG.JOB_ID}`;
    private workBranchName: string;

    private diffPath: string = path.join(CONFIG.HOME_DIR, 'DIFF.patch');
    private reviewPath: string = path.join(CONFIG.HOME_DIR, 'REVIEW.json');

    private getSkillsDir(): string {
        const containerPath = CONFIG.AGENT_PLATFORM === 'windows' ? 'C:\\SKILLS' : '/SKILLS';
        if (fs.existsSync(containerPath)) {
            return containerPath;
        }
        const relativeToAgent = path.resolve(process.cwd(), '..', '..', 'data', 'SKILLS');
        if (fs.existsSync(relativeToAgent)) {
            return relativeToAgent;
        }
        const relativeToRoot = path.resolve(process.cwd(), 'data', 'SKILLS');
        if (fs.existsSync(relativeToRoot)) {
            return relativeToRoot;
        }
        return path.resolve(process.cwd(), 'prompts', 'SKILLS');
    }

    private skillsDir: string = this.getSkillsDir();
    private promptTemplateCache: Map<string, string> = new Map();

    private sessionSetup: AgentSession = new AgentSession('setup');
    private sessionPlan: AgentSession = new AgentSession('plan');
    private sessionImplement: AgentSession = new AgentSession('implement');
    private sessionDocument: AgentSession = new AgentSession('document');

    constructor() {
        this.workBranchName = `${this.checkpointBranch}-${Date.now()}`;
    }

    private loadPromptTemplate(fileName: string): string {
        const cached = this.promptTemplateCache.get(fileName);
        if (cached) return cached;

        const templatePath = path.resolve(process.cwd(), 'prompts', fileName);
        const content = fs.readFileSync(templatePath, 'utf-8');
        this.promptTemplateCache.set(fileName, content);
        return content;
    }

    private renderPromptTemplate(fileName: string, values: Record<string, string>): string {
        const template = this.loadPromptTemplate(fileName);
        return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => values[key] ?? '');
    }

    public async execute() {
        try {
            await this.setupConfig();
            await this.diagnostics();

            messenger.onCheckpoint(async () => {
                await this.checkpointCommit();
            });
            await this.setup();

            // Phase 1.5: Blueprint & Architectural Planning
            await this.plan();

            let retries = 0;
            let success = false;
            let forceNewImplementation = true;

            while (retries < CONFIG.MAX_RETRIES && !success) {
                // Phase 1: Implement
                if (forceNewImplementation) {
                    console.log(`Implementation attempt ${retries + 1}/${CONFIG.MAX_RETRIES}`);
                    await this.implement(0, CONFIG.MAX_RETRIES);
                    forceNewImplementation = false;
                }

                // Phase 2: Build & Test — re-test after each fix until pass or budget exhausted
                let testPassed = false;
                let testFailuresInARow = 0;
                while (!testPassed && retries < CONFIG.MAX_RETRIES) {
                    console.log(`Testing attempt ${retries + 1}/${CONFIG.MAX_RETRIES}`);
                    const { passed, errorLog } = await this.test(retries, CONFIG.MAX_RETRIES);

                    if (passed) {
                        testPassed = true;
                        testFailuresInARow = 0;
                    } else {
                        retries++;
                        testFailuresInARow++;
                        
                        if (retries >= CONFIG.MAX_RETRIES) break;
                        
                        if (testFailuresInARow >= 3) {
                            console.warn("Tests failed 3 times. Escalating back to the Planner for a fresh plan...");
                            await this.plan(`The previous implementation plan failed during testing 3 times. The latest test errors were:\n${errorLog}\n\nPlease draft a new, revised implementation plan that addresses these fundamental flaws or incompatibilities.`);
                            testFailuresInARow = 0;
                            this.sessionImplement = new AgentSession('implement');
                            forceNewImplementation = true;
                            break;
                        } else {
                            console.error(`Tests failed. Retrying implementation... (${retries}/${CONFIG.MAX_RETRIES})`);
                            await this.fixImplementation(`Build/Test failed with:\n${errorLog}\n\nFix all errors. Do not revert any previously applied fix.`, retries, CONFIG.MAX_RETRIES);
                        }
                    }
                }

                if (forceNewImplementation) {
                    continue; // Skip review phase, restart outer loop with new plan
                }

                if (!testPassed) break;

                // Phase 3: Review — only reached after tests pass
                this.ensureGitIgnore();
                console.log('Staging all changes for review...');
                await runCommand('git', ['add', '.']);

                console.log(`Review attempt ${retries + 1}/${CONFIG.MAX_RETRIES}`);
                const { verdict, repairHint, findings } = await this.review(retries, CONFIG.MAX_RETRIES);

                if (verdict === 'pass') {
                    success = true;
                } else {
                    retries++;
                    if (retries >= CONFIG.MAX_RETRIES) break;
                    console.error(`Review failed. Retrying implementation... (${retries}/${CONFIG.MAX_RETRIES})`);
                    await this.fixImplementation(`Review failed:\n${findings}\n\nRepair hint: ${repairHint}\n\nAddress the issues above. Check /repo/.openvelo/implementer-notes.md for existing deviation notes before making changes. If a flagged requirement is already documented as a deviation, update the notes — do NOT re-implement it.`, retries, CONFIG.MAX_RETRIES);
                    // Loops back to outer while → re-tests before re-reviewing
                }
            }

            if (!success) throw new Error('Failed after max retries.');

            await this.document();
            await this.finish();
            console.log('Workflow completed successfully.');
            messenger.sendFinish('success', { branch: this.workBranchName });
        } catch (err: any) {
            console.error(`Fatal Error: ${err.message}`);
            const maxRetriesReached = err.message.includes('Max retries reached') || err.message.includes('Failed after max retries');
            messenger.sendFinish('error', { error: err.message, maxRetriesReached });
        } finally {
            setTimeout(() => process.exit(0), 1000);
        }
    }

    private async setupConfig() {
        console.log('Setting up configuration environment...');
    }

    private async diagnostics() {
        console.log('Starting phase: DIAGNOSTICS');
        const resolvedBackend = CONFIG.BACKEND;
        const whichCmd = IS_WINDOWS ? 'where' : 'which';
        const rootDir = IS_WINDOWS ? 'C:\\' : '/';
        const { code } = await runCommand(whichCmd, [resolvedBackend], rootDir);
        if (code !== 0) throw new Error(`Tool ${resolvedBackend} not found in PATH.`);
        await runCommand(resolvedBackend, ['--version'], rootDir);

        const { code: dotnetCode } = await runCommand('dotnet', ['--version'], rootDir);
        if (dotnetCode !== 0) {
            console.log('dotnet CLI not available — .NET builds will not be supported.');
        }
    }

    private async setup() {
        messenger.sendStage('setup');
        console.log('###############################################');
        console.log('###############################################');
        console.log('##############     SETUP    ###################');
        console.log('###############################################');
        console.log('###############################################');
        console.log('Starting phase: SETUP');

        await this.prepareRepository();
        await openCodeServerManager.ensureStarted(CONFIG.REPO_PATH, CONFIG.BACKEND_MODEL);

        if (!fs.existsSync(CONFIG.TOOLS_CACHE_DIR)) {
            fs.mkdirSync(CONFIG.TOOLS_CACHE_DIR, { recursive: true });
        }

        console.log('Updating package lists...');
        await runCommand('apt-get', ['update', '-y']);

        const setupShPath = path.join(CONFIG.REPO_PATH, '.openvelo', 'setup.sh');
        
        let buildRetries = 0;
        let buildSuccess = false;

        while (buildRetries < CONFIG.MAX_RETRIES && !buildSuccess) {
            if (fs.existsSync(setupShPath)) {
                console.log(`Running setup script: ${setupShPath}`);
                await runCommand('bash', [setupShPath], CONFIG.REPO_PATH);
            } else {
                const openVeloDir = path.join(CONFIG.REPO_PATH, '.openvelo');
                if (!fs.existsSync(openVeloDir)) {
                    fs.mkdirSync(openVeloDir, { recursive: true });
                }
            }

            let buildOutput = '';
            let buildCode = 0;
            if (CONFIG.BUILD_CMD) {
                console.log(`Running build command: ${CONFIG.BUILD_CMD}`);
                const res = await runCommand('bash', ['-c', CONFIG.BUILD_CMD], CONFIG.REPO_PATH);
                buildCode = res.code ?? 1;
                buildOutput = res.output;
            }

            if (buildCode !== 0) {
                const files = fs.readdirSync(CONFIG.REPO_PATH).filter(f => !['.git', '.gitkeep', '.openvelo'].includes(f));
                const isEmpty = files.length === 0;
                const setupPrompt = this.renderPromptTemplate('setup.txt', {
                    REPO_IS_EMPTY: isEmpty ? 'true' : 'false',
                    BUILD_CMD: CONFIG.BUILD_CMD || '(none)',
                    BUILD_OUTPUT: buildOutput.substring(0, 4000), // Avoid massive output
                    SETUP_SH_PATH: setupShPath
                });

                const llmResponse = await this.sessionSetup.send(setupPrompt, CONFIG.BACKEND_MODEL);
                const llmResponseStr = JSON.stringify(llmResponse);
                
                if (llmResponseStr.includes('EMPTY_PROJECT')) {
                    console.log('LLM identified empty project build error. Proceeding safely...');
                    buildSuccess = true;
                } else if (llmResponseStr.includes('BUILD_ERROR')) {
                    throw new Error('Max retries reached: Actual build logic error detected by LLM.');
                } else if (llmResponseStr.includes('SETUP_ADJUSTED')) {
                    console.log('LLM adjusted setup.sh. Committing changes...');
                    await runCommand('git', ['add', '.openvelo/setup.sh'], CONFIG.REPO_PATH);
                    await runCommand('git', ['commit', '-m', 'chore: adjust setup.sh for missing dependencies'], CONFIG.REPO_PATH);
                    buildRetries++;
                } else {
                    throw new Error('Max retries reached: LLM could not resolve build error.');
                }
            } else {
                buildSuccess = true;
            }
        }

        if (!buildSuccess) {
            throw new Error('Max retries reached: Build failed after max retries.');
        }

        const files = fs.readdirSync(CONFIG.REPO_PATH).filter(f => !['.git', '.gitkeep', '.openvelo'].includes(f));
        const isEmpty = files.length === 0;

        let testCode = 0;
        if (CONFIG.TEST_CMD && !isEmpty) {
            console.log(`Running test command: ${CONFIG.TEST_CMD}`);
            const res = await runCommand('bash', ['-c', CONFIG.TEST_CMD], CONFIG.REPO_PATH);
            testCode = res.code ?? 1;
        } else if (isEmpty) {
            console.log('Empty project detected. Skipping tests.');
        }

        if (testCode !== 0) {
            throw new Error('Max retries reached: Tests failed. Repository not in a clean state.');
        }

        console.log('Setup phase complete.');
    }

    private async plan(failureContext?: string): Promise<void> {
        messenger.sendStage('blueprinting');
        console.log('###############################################');
        console.log('###############################################');
        console.log('##########   ARCHITECTURAL PLAN   #############');
        console.log('###############################################');
        console.log('###############################################');
        console.log('Starting phase: PLAN & BLUEPRINT');

        let planPrompt = this.renderPromptTemplate('plan.txt', {
            STORY_CONTENT: CONFIG.STORY_CONTENT,
            REPO_PATH: CONFIG.REPO_PATH,
            SKILLS_PATH: this.skillsDir,
        });

        if (failureContext) {
            planPrompt += `\n\n### CRITICAL REVISION NEEDED\n\n${failureContext}\n\nPlease revise the plan to address these failures.`;
        }

        await this.sessionPlan.send(planPrompt, CONFIG.BACKEND_MODEL);

        const planPath = '/tmp/IMPLEMENTATION_PLAN.md';
        if (fs.existsSync(planPath)) {
            console.log('Implementation plan successfully created and saved to /tmp/IMPLEMENTATION_PLAN.md');
        } else {
            console.warn('Warning: LLM failed to write /tmp/IMPLEMENTATION_PLAN.md automatically. Creating a skeleton plan...');
            const fallbackContent = `# Implementation Plan (Skeleton)\n\nFailed to automatically generate a detailed plan. Please proceed with standard exploration.`;
            fs.writeFileSync(planPath, fallbackContent, 'utf-8');
        }
    }

    private async ensureFeatureBranch() {
        const { code: remoteCheck } = await runCommand('git', ['ls-remote', '--exit-code', '--heads', 'origin', this.checkpointBranch]);
        if (remoteCheck === 0) {
            console.log(`Resuming from checkpoint origin/${this.checkpointBranch}...`);
            await runCommand('git', ['fetch', 'origin', this.checkpointBranch]);

            const newTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
            this.workBranchName = `${this.checkpointBranch}-${newTimestamp}`;

            await runCommand('git', ['checkout', '-b', this.workBranchName, `origin/${this.checkpointBranch}`]);
            await runCommand('git', ['push', 'origin', '--delete', this.checkpointBranch]);
            console.log(`Checkpoint branch deleted. Working in ${this.workBranchName}.`);
            return;
        }

        console.log(`Starting fresh with new branch ${this.workBranchName}...`);
        await runCommand('git', ['checkout', '-b', this.workBranchName, `origin/${CONFIG.STAGING_BRANCH}`]);
    }

    private async checkpointCommit() {
        console.log('Checkpoint requested — committing current work...');
        try {
            await runCommand('git', ['add', '.']);
            const timestamp = new Date().toISOString();
            await runCommand('git', ['commit', '--allow-empty', '-m', `wip: checkpoint ${timestamp}`]);
            await runCommand('git', ['push', 'origin', this.checkpointBranch]);
            console.log('Checkpoint committed to remote branch.');
        } catch (err: any) {
            console.error(`Checkpoint commit failed: ${err.message}`);
        }
        messenger.sendCheckpointDone();
    }

    private async prepareRepository() {
        if (!CONFIG.REPO_URL) throw new Error('REPO_URL not provided');

        const rootDir = IS_WINDOWS ? 'C:\\' : '/';
        await runCommand('git', ['clone', CONFIG.REPO_URL, CONFIG.REPO_PATH], rootDir);

        const { code: revParseCode } = await runCommand('git', ['rev-parse', 'HEAD']);
        if (revParseCode !== 0) {
            console.log('Repository is empty. Initializing foundational branches...');

            await runCommand('git', ['checkout', '-b', 'main']);
            if (IS_WINDOWS) {
                fs.writeFileSync(path.join(CONFIG.REPO_PATH, '.gitkeep'), '', 'utf-8');
            } else {
                await runCommand('touch', ['.gitkeep']);
            }
            await runCommand('git', ['add', '.gitkeep']);
            await runCommand('git', ['commit', '-m', 'chore: initial commit']);
            await runCommand('git', ['push', 'origin', 'main']);

            await runCommand('git', ['checkout', '-b', CONFIG.STAGING_BRANCH]);
            await runCommand('git', ['push', 'origin', CONFIG.STAGING_BRANCH]);

            await this.ensureFeatureBranch();
        } else {
            const { code: stagingLocalCheck } = await runCommand('git', ['rev-parse', '--verify', CONFIG.STAGING_BRANCH]);
            const { code: stagingRemoteCheck } = await runCommand('git', ['rev-parse', '--verify', `origin/${CONFIG.STAGING_BRANCH}`]);

            if (stagingLocalCheck !== 0 && stagingRemoteCheck !== 0) {
                console.log(`Staging branch ${CONFIG.STAGING_BRANCH} not found locally or on remote. Creating from HEAD...`);
                await runCommand('git', ['checkout', '-b', CONFIG.STAGING_BRANCH]);
                await runCommand('git', ['push', 'origin', CONFIG.STAGING_BRANCH]);
            } else {
                console.log(`Checking out staging branch ${CONFIG.STAGING_BRANCH}...`);
                await runCommand('git', ['checkout', CONFIG.STAGING_BRANCH]);
                await runCommand('git', ['pull', 'origin', CONFIG.STAGING_BRANCH]);
            }

            await this.ensureFeatureBranch();
        }

        const isWindows = CONFIG.AGENT_PLATFORM === 'windows';
        const skillsExternalPath = isWindows ? 'C:\\SKILLS' : '/SKILLS';

        const opencodeConfigPath = path.join(CONFIG.REPO_PATH, 'opencode.json');
        fs.writeFileSync(opencodeConfigPath, JSON.stringify({
            $schema: 'https://opencode.ai/config.json',
            permission: {
                '*': 'allow',
                'ask_user': 'deny',
                'question': 'deny',
                'external_directory': {
                    '/tmp': 'allow',
                    [skillsExternalPath]: 'allow'
                }
            }
        }, null, 2), 'utf-8');

        await dotnetSetup();
    }

    private ensureGitIgnore(): void {
        const gitIgnorePath = path.join(CONFIG.REPO_PATH, '.gitignore');
        let existingLines: string[] = [];
        if (fs.existsSync(gitIgnorePath)) {
            existingLines = fs.readFileSync(gitIgnorePath, 'utf-8').split('\n');
        }

        const patternsByMarker: Record<string, string[]> = {
            'package.json': ['node_modules/', 'dist/', '.npm/'],
            'Cargo.toml': ['target/'],
            'go.mod': ['*.exe', '*.exe~', '*.dll', '*.so', '*.dylib'],
            'Gemfile': ['vendor/bundle/'],
            'pyproject.toml': ['__pycache__/', '*.pyc', '.venv/', '*.egg-info/'],
            'requirements.txt': ['__pycache__/', '*.pyc', '.venv/'],
        };

        const markerExtensions: Record<string, string[]> = {
            '.csproj': ['bin/', 'obj/'],
            '.sln': ['bin/', 'obj/'],
        };

        const patternsToAdd = new Set<string>();

        for (const [marker, patterns] of Object.entries(patternsByMarker)) {
            if (fs.existsSync(path.join(CONFIG.REPO_PATH, marker))) {
                for (const p of patterns) patternsToAdd.add(p);
            }
        }

        const repoFiles = fs.existsSync(CONFIG.REPO_PATH) ? fs.readdirSync(CONFIG.REPO_PATH) : [];
        for (const file of repoFiles) {
            const ext = path.extname(file);
            if (markerExtensions[ext]) {
                for (const p of markerExtensions[ext]) patternsToAdd.add(p);
            }
        }

        const missing: string[] = [];
        for (const pattern of patternsToAdd) {
            const exists = existingLines.some(line => line.trim() === pattern);
            if (!exists) missing.push(pattern);
        }

        if (missing.length === 0) return;

        const header = existingLines.length === 0
            ? '# Automatically added by OpenVelo agent\n'
            : '';
        const content = header + missing.join('\n') + '\n';
        fs.appendFileSync(gitIgnorePath, content, 'utf-8');
        console.log(`Appended to .gitignore: ${missing.join(', ')}`);
    }

    private async implement(attempt: number = 0, maxRetries: number = 1, injectedErrors?: string): Promise<void> {
        messenger.sendStage('implementing', attempt + 1, maxRetries);
        console.log('###############################################');
        console.log('###############################################');
        console.log('##########    IMPLEMENTATION    ###############');
        console.log('###############################################');
        console.log('###############################################');
        console.log('Starting phase: IMPLEMENT');

        if (attempt === 0) {
            const planPath = '/tmp/IMPLEMENTATION_PLAN.md';
            let planContent = '';
            if (fs.existsSync(planPath)) {
                try {
                    planContent = fs.readFileSync(planPath, 'utf-8');
                } catch (err: any) {
                    console.warn(`Error reading implementation plan: ${err.message}`);
                }
            }

            if (planContent.includes('[ALREADY_IMPLEMENTED]')) {
                console.log('Implementation plan indicates this feature is already fully implemented. Skipping code/test generation and jumping directly to the Build & Test stage.');
                return;
            }

            const impPrompt = this.renderPromptTemplate('implement.txt', {
                STORY_CONTENT: CONFIG.STORY_CONTENT,
                REPO_PATH: CONFIG.REPO_PATH,
                SKILLS_PATH: this.skillsDir,
            });

            const fullPrompt = planContent
                ? `${impPrompt}\n\n---\n\n## Approved Architectural Blueprint\nFollow this plan exactly:\n\n${planContent}`
                : impPrompt;

            await this.sessionImplement.send(fullPrompt, CONFIG.BACKEND_MODEL);
        } else if (injectedErrors) {
            await this.sessionImplement.send(injectedErrors, CONFIG.BACKEND_MODEL);
        }
        // If attempt > 0 and no injectedErrors, this is a re-test cycle after
        // fixImplementation() already applied the fix — nothing to send.
    }

    private async fixImplementation(errors: string, attempt: number, maxRetries: number): Promise<void> {
        await this.implement(attempt, maxRetries, errors);
    }

    private async test(attempt: number = 0, maxRetries: number = 1): Promise<{ passed: boolean; errorLog: string }> {
        messenger.sendStage('testing', attempt + 1, maxRetries);
        console.log('###############################################');
        console.log('###############################################');
        console.log('##############     TEST     ###################');
        console.log('###############################################');
        console.log('###############################################');
        console.log('Starting phase: TEST');

        const sections: string[] = [];
        let buildCode = 0;
        if (CONFIG.BUILD_CMD) {
            if (isWatchMode(CONFIG.BUILD_CMD)) {
                console.error(
                    `Warning: BUILD_CMD appears to use watch mode which will cause the build to run indefinitely: ${CONFIG.BUILD_CMD}`
                );
            }
            if (CONFIG.BUILD_CMD.match(/^\s*dotnet\s+build\b/)) {
                const res = await runDotnetBuild(CONFIG.BUILD_CMD);
                buildCode = res.code ?? 1;
                if (buildCode !== 0) {
                    sections.push(res.output);
                }
            } else {
                const res = await runCommand(CONFIG.BUILD_CMD, []);
                buildCode = res.code ?? 1;
                if (buildCode !== 0) {
                    sections.push(`## BUILD_CMD: ${CONFIG.BUILD_CMD}\n\`\`\`\n${res.output.trim()}\n\`\`\``);
                }
            }
        } else {
            console.log('Skipping BUILD_CMD (not provided).');
        }

        let testCode = 0;
        if (buildCode !== 0) {
            console.log('Skipping TEST_CMD — build failed.');
        } else if (CONFIG.TEST_CMD) {
            if (isWatchMode(CONFIG.TEST_CMD)) {
                console.error(
                    `Warning: TEST_CMD appears to use watch mode which will cause the test to run indefinitely: ${CONFIG.TEST_CMD}`
                );
            }
            const res = await runCommand(CONFIG.TEST_CMD, []);
            testCode = res.code ?? 1;
            if (testCode !== 0) {
                sections.push(`## TEST_CMD: ${CONFIG.TEST_CMD}\n\`\`\`\n${res.output.trim()}\n\`\`\``);
            }
        } else {
            console.log('Skipping TEST_CMD (not provided).');
        }

        const passed = buildCode === 0 && testCode === 0;
        if (passed) {
            console.log('Build and Tests passed!');
        }
        return { passed, errorLog: sections.join('\n\n') };
    }

    private async review(attempt: number = 0, maxRetries: number = 1): Promise<{ verdict: string; repairHint: string; findings: string }> {
        messenger.sendStage('reviewing', attempt + 1, maxRetries);
        console.log('###############################################');
        console.log('###############################################');
        console.log('##############    REVIEW    ###################');
        console.log('###############################################');
        console.log('###############################################');
        console.log('Starting phase: REVIEW');

        if (fs.existsSync(this.reviewPath)) fs.unlinkSync(this.reviewPath);

        const sessionReview = new AgentSession(`review-attempt-${attempt}`);

        const reviewPrompt = this.renderPromptTemplate('review.txt', {
            STORY_CONTENT: CONFIG.STORY_CONTENT,
            REPO_PATH: CONFIG.REPO_PATH,
            SKILLS_PATH: this.skillsDir,
            REVIEW_PATH: this.reviewPath,
            STAGING_BRANCH: CONFIG.STAGING_BRANCH,
        });

        await sessionReview.send(reviewPrompt, CONFIG.BACKEND_MODEL);

        if (!fs.existsSync(this.reviewPath)) {
            console.log('REVIEW.json not written by reviewer — treating as pass.');
            return { verdict: 'pass', repairHint: '', findings: 'Reviewer did not produce output.' };
        }

        let reviewData: any;
        try {
            reviewData = JSON.parse(fs.readFileSync(this.reviewPath, 'utf-8'));
        } catch {
            console.log('REVIEW.json is not valid JSON — treating as pass.');
            return { verdict: 'pass', repairHint: '', findings: 'Reviewer output could not be parsed.' };
        }

        const verdict: string = reviewData.verdict ?? 'pass';
        const repairHint: string = reviewData.repair_hint ?? '';
        const findings: string = reviewData.findings ?? '';

        if (verdict === 'pass') {
            console.log(`Review verdict: ${verdict}. ${findings}`);
        } else {
            console.error(`Review verdict: ${verdict}. ${findings}`);
        }
        return { verdict, repairHint, findings };
    }

    private async document(): Promise<void> {
        messenger.sendStage('documenting');
        console.log('###############################################');
        console.log('###############################################');
        console.log('##########     DOCUMENTING    #################');
        console.log('###############################################');
        console.log('###############################################');
        console.log('Starting phase: DOCUMENT');

        const docPrompt = this.renderPromptTemplate('document.txt', {
            STORY_CONTENT: CONFIG.STORY_CONTENT,
            REPO_PATH: CONFIG.REPO_PATH,
            SKILLS_PATH: this.skillsDir,
            CHECKPOINT_BRANCH: this.checkpointBranch
        });

        await this.sessionDocument.send(docPrompt, CONFIG.BACKEND_MODEL);

        console.log('Documentation phase complete. Staging documentation changes...');
        await runCommand('git', ['add', '.openvelo/architecture'], CONFIG.REPO_PATH);
        const statusRes = await runCommand('git', ['status', '--porcelain', '.openvelo/architecture'], CONFIG.REPO_PATH);
        
        if (statusRes.output.trim() !== '') {
            await runCommand('git', ['commit', '-m', 'docs: update architecture documentation'], CONFIG.REPO_PATH);
        }
    }

    private async finish() {
        messenger.sendStage('pushing');
        console.log('###############################################');
        console.log('###############################################');
        console.log('##############     PUSH     ###################');
        console.log('###############################################');
        console.log('###############################################');
        console.log('Starting phase: FINISH');

        const filesToRemove = ['opencode.json'];
        for (const file of filesToRemove) {
            const filePath = path.join(CONFIG.REPO_PATH, file);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Removed ${file} before commit.`);
            }
        }

        this.ensureGitIgnore();
        await runCommand('git', ['add', '.']);

        const { output: diffOutput } = await runCommand('git', ['diff', '--cached', '--name-only']);
        if (!diffOutput.trim()) {
            console.log('No changes detected after staging. Nothing to commit or push — task is already complete or had no effect. Marking job as successful.');
            await runCommand('git', ['checkout', CONFIG.STAGING_BRANCH]);
            await runCommand('git', ['branch', '-D', this.workBranchName]).catch(() => {});
            const { code: cpRemoteExists } = await runCommand('git', ['ls-remote', '--exit-code', '--heads', 'origin', this.checkpointBranch]);
            if (cpRemoteExists === 0) {
                await runCommand('git', ['push', 'origin', '--delete', this.checkpointBranch]);
            }
            return;
        }

        const titleSuffix = CONFIG.JOB_TITLE ? `: ${CONFIG.JOB_TITLE}` : '';
        await runCommand('git', ['commit', '-m', `feat${titleSuffix}`]);

        console.log('Fetching latest staging before push...');
        await runCommand('git', ['fetch', 'origin', CONFIG.STAGING_BRANCH]);
        const { code: rebaseCode } = await runCommand('git', ['rebase', `origin/${CONFIG.STAGING_BRANCH}`]);
        if (rebaseCode !== 0) {
            console.error('Rebase failed with conflicts. Aborting and exiting...');
            await runCommand('git', ['rebase', '--abort']);
            throw new Error('Rebase failed with conflicts. Cannot push broken branch.');
        }

        await runCommand('git', ['push', 'origin', this.workBranchName, '--force-with-lease']);

        console.log('Creating Pull Request to staging...');
        try {
            let prId: number;
            if (CONFIG.REPO_HOST === 'azure-devops') {
                prId = await createAdoPR(this.workBranchName);
            } else if (CONFIG.REPO_HOST === 'gitea') {
                prId = await createGiteaPR(this.workBranchName);
            } else {
                prId = await createGithubPR(this.workBranchName);
            }
            console.log(`Pull Request #${prId} has been successfully merged and closed.`);
        } catch (prErr: any) {
            console.error(`PR failed: ${prErr.message}. Cleaning up before exit...`);
            await this.deleteFeatureBranch();
            throw prErr;
        }

        console.log('Cleaning up checkpoint branch if it exists...');
        const { code: cpRemoteExists } = await runCommand('git', ['ls-remote', '--exit-code', '--heads', 'origin', this.checkpointBranch]);
        if (cpRemoteExists === 0) {
            await runCommand('git', ['push', 'origin', '--delete', this.checkpointBranch]);
        }

        console.log('Deleting local work branch...');
        await runCommand('git', ['checkout', CONFIG.STAGING_BRANCH]);
        await runCommand('git', ['branch', '-D', this.workBranchName]).catch(() => { });
    }

    private async deleteFeatureBranch(): Promise<void> {
        await runCommand('git', ['checkout', CONFIG.STAGING_BRANCH]).catch(async () => {
            await runCommand('git', ['checkout', '--detach']);
        });

        const { code: workLocalExists } = await runCommand('git', ['rev-parse', '--verify', this.workBranchName]);
        if (workLocalExists === 0) {
            await runCommand('git', ['branch', '-D', this.workBranchName]).catch(() => { });
        }

        console.log(`Cleaning up checkpoint branch ${this.checkpointBranch}...`);
        const { code: cpRemoteExists } = await runCommand('git', ['ls-remote', '--exit-code', '--heads', 'origin', this.checkpointBranch]);
        if (cpRemoteExists === 0) {
            await runCommand('git', ['push', 'origin', '--delete', this.checkpointBranch]);
        }
    }
}