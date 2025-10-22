import * as azdev from 'azure-devops-node-api';
import * as vscode from 'vscode';
import { 
    PullRequest, 
    PRFile, 
    PRThread, 
    AzureDevOpsConfig,
    PRIteration,
    BuildStatus,
    PolicyEvaluation,
    MergeConflict,
    WorkItemRef,
    Label,
    CompletionOptions
} from '../types';

// Interface that both AuthenticationManager and AuthenticationProvider implement
interface IAuthProvider {
    getToken(): Promise<string | undefined>;
}

export class AzureDevOpsService {
    private connection?: azdev.WebApi;
    private gitApi?: any;
    private authProvider: IAuthProvider;
    private config: AzureDevOpsConfig;

    constructor(authProvider: IAuthProvider) {
        this.authProvider = authProvider;
        this.config = this.loadConfig();
    }

    private loadConfig(): AzureDevOpsConfig {
        const config = vscode.workspace.getConfiguration('azureDevOpsPR');
        return {
            organization: config.get('organization') || '',
            project: config.get('project') || '',
            repository: config.get('repository') || this.getRepositoryFromGit()
        };
    }

    private getRepositoryFromGit(): string | undefined {
        // Try to detect repository name from git remote
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            // This is a simplified version - in production, you'd parse .git/config
            return undefined;
        }
        return undefined;
    }

    async initialize(): Promise<void> {
        const token = await this.authProvider.getToken();
        if (!token) {
            throw new Error('No authentication token found. Please authenticate first.');
        }

        if (!this.config.organization) {
            throw new Error('Azure DevOps organization not configured. Please set azureDevOpsPR.organization in settings.');
        }

        if (!this.config.project) {
            throw new Error('Azure DevOps project not configured. Please set azureDevOpsPR.project in settings.');
        }

        // Ensure organization URL is properly formatted
        let orgUrl = this.config.organization;
        
        // If it's not a full URL, assume it's just the org name and use new format
        if (!orgUrl.startsWith('http://') && !orgUrl.startsWith('https://')) {
            orgUrl = `https://dev.azure.com/${orgUrl}`;
        }
        
        // Remove trailing slash if present
        orgUrl = orgUrl.replace(/\/$/, '');
        
        // Support both old (.visualstudio.com) and new (dev.azure.com) URL formats
        // The azure-devops-node-api handles both formats correctly

        try {
            const authHandler = azdev.getPersonalAccessTokenHandler(token);
            this.connection = new azdev.WebApi(orgUrl, authHandler);
            this.gitApi = await this.connection.getGitApi();
        } catch (error: any) {
            throw new Error(`Failed to initialize Azure DevOps connection: ${error.message || error}\nPlease verify your PAT token has the correct permissions (Code Read & Write).`);
        }
    }

    async getPullRequests(status: string = 'active'): Promise<PullRequest[]> {
        await this.ensureInitialized();

        try {
            const searchCriteria = {
                status: status,
                includeLinks: true
            };

            console.log('Getting PRs with config:', {
                repository: this.config.repository,
                project: this.config.project,
                organization: this.config.organization
            });

            const prs = await this.gitApi!.getPullRequests(
                this.config.repository,
                searchCriteria,
                this.config.project
            );

            return prs.map((pr: any) => this.mapToPullRequest(pr));
        } catch (error: any) {
            console.error('Failed to get pull requests:', error);
            throw new Error(`Failed to get pull requests: ${error.message || error}\nRepository: ${this.config.repository}, Project: ${this.config.project}`);
        }
    }

    async getPullRequest(pullRequestId: number): Promise<PullRequest> {
        await this.ensureInitialized();

        const pr = await this.gitApi!.getPullRequest(
            this.config.repository,
            pullRequestId,
            this.config.project
        );

        return this.mapToPullRequest(pr);
    }

    async getPRFiles(pullRequestId: number): Promise<PRFile[]> {
        await this.ensureInitialized();

        const iterations = await this.gitApi!.getPullRequestIterations(
            this.config.repository,
            pullRequestId,
            this.config.project
        );

        if (iterations.length === 0) {
            return [];
        }

        const changes = await this.gitApi!.getPullRequestIterationChanges(
            this.config.repository,
            pullRequestId,
            iterations[iterations.length - 1].id,
            this.config.project
        );

        return changes.changeEntries.map((change: any) => ({
            path: change.item.path,
            changeType: change.changeType,
            objectId: change.item.objectId,
            originalObjectId: change.item.originalObjectId
        }));
    }

    async getPRThreads(pullRequestId: number): Promise<PRThread[]> {
        await this.ensureInitialized();

        const threads = await this.gitApi!.getThreads(
            this.config.repository,
            pullRequestId,
            this.config.project
        );

        return threads.map((thread: any) => ({
            id: thread.id,
            comments: thread.comments.map((comment: any) => ({
                id: comment.id,
                content: comment.content,
                author: {
                    displayName: comment.author.displayName,
                    uniqueName: comment.author.uniqueName
                },
                publishedDate: comment.publishedDate,
                threadId: thread.id,
                isDeleted: comment.isDeleted || false,
                commentType: comment.commentType
            })),
            status: thread.status,
            threadContext: thread.threadContext ? {
                filePath: thread.threadContext.filePath,
                rightFileStart: thread.threadContext.rightFileStart,
                rightFileEnd: thread.threadContext.rightFileEnd
            } : undefined
        }));
    }

    async getFileContent(pullRequestId: number, filePath: string): Promise<string> {
        await this.ensureInitialized();

        const pr = await this.getPullRequest(pullRequestId);
        const sourceCommit = pr.sourceRefName.replace('refs/heads/', '');

        return await this.getFileContentFromBranch(filePath, sourceCommit);
    }

    async getFileContentFromBranch(filePath: string, branch: string): Promise<string> {
        await this.ensureInitialized();

        try {
            const item = await this.gitApi!.getItem(
                this.config.repository,
                filePath,
                this.config.project,
                undefined,
                undefined,
                true,
                false,
                undefined,
                {
                    version: branch,
                    versionType: 'branch'
                }
            );

            return item.content || '';
        } catch (error) {
            throw new Error(`Failed to get file content from branch ${branch}: ${error}`);
        }
    }

    async addComment(pullRequestId: number, content: string, filePath?: string): Promise<void> {
        await this.ensureInitialized();

        const thread: any = {
            comments: [{
                content: content,
                commentType: 1
            }],
            status: 1
        };

        if (filePath) {
            thread.threadContext = {
                filePath: filePath
            };
        }

        await this.gitApi!.createThread(
            thread,
            this.config.repository,
            pullRequestId,
            this.config.project
        );
    }

    async addInlineComment(
        pullRequestId: number,
        content: string,
        filePath: string,
        lineNumber: number
    ): Promise<void> {
        await this.ensureInitialized();

        const thread: any = {
            comments: [{
                content: content,
                commentType: 1
            }],
            status: 1,
            threadContext: {
                filePath: filePath,
                rightFileStart: {
                    line: lineNumber,
                    offset: 1
                },
                rightFileEnd: {
                    line: lineNumber,
                    offset: 1
                }
            }
        };

        await this.gitApi!.createThread(
            thread,
            this.config.repository,
            pullRequestId,
            this.config.project
        );
    }

    async addCommentToThread(
        pullRequestId: number,
        threadId: number,
        content: string
    ): Promise<void> {
        await this.ensureInitialized();

        const comment = {
            content: content,
            commentType: 1
        };

        await this.gitApi!.createComment(
            comment,
            this.config.repository,
            pullRequestId,
            threadId,
            this.config.project
        );
    }

    async resolveThread(pullRequestId: number, threadId: number): Promise<void> {
        await this.ensureInitialized();

        const thread = {
            status: 4 // Fixed/Closed
        };

        await this.gitApi!.updateThread(
            thread,
            this.config.repository,
            pullRequestId,
            threadId,
            this.config.project
        );
    }

    async approvePR(pullRequestId: number): Promise<void> {
        await this.ensureInitialized();

        const reviewer = {
            vote: 10 // 10 = Approved
        };

        await this.gitApi!.createPullRequestReviewer(
            reviewer,
            this.config.repository,
            pullRequestId,
            'me',
            this.config.project
        );
    }

    async completePR(pullRequestId: number): Promise<void> {
        await this.ensureInitialized();

        const pr = await this.getPullRequest(pullRequestId);
        
        const updatePR = {
            status: 3, // Completed
            lastMergeSourceCommit: pr.sourceRefName
        };

        await this.gitApi!.updatePullRequest(
            updatePR,
            this.config.repository,
            pullRequestId,
            this.config.project
        );
    }

    async abandonPR(pullRequestId: number): Promise<void> {
        await this.ensureInitialized();

        const updatePR = {
            status: 2 // Abandoned
        };

        await this.gitApi!.updatePullRequest(
            updatePR,
            this.config.repository,
            pullRequestId,
            this.config.project
        );
    }

    // Work Item Integration
    async getWorkItemsForPR(pullRequestId: number): Promise<WorkItemRef[]> {
        await this.ensureInitialized();

        const pr = await this.gitApi!.getPullRequest(
            this.config.repository,
            pullRequestId,
            this.config.project
        );

        return pr.workItemRefs?.map((wi: any) => ({
            id: wi.id,
            url: wi.url
        })) || [];
    }

    async linkWorkItemToPR(pullRequestId: number, workItemId: string): Promise<void> {
        await this.ensureInitialized();

        const workItemRef = {
            id: workItemId,
            url: `${this.config.organization}/_apis/wit/workItems/${workItemId}`
        };

        await this.gitApi!.updatePullRequest(
            { workItemRefs: [workItemRef] },
            this.config.repository,
            pullRequestId,
            this.config.project
        );
    }

    // Build & Policy Status
    async getBuildStatusForPR(pullRequestId: number): Promise<BuildStatus[]> {
        await this.ensureInitialized();

        try {
            const buildApi = await this.connection!.getBuildApi();
            const pr = await this.getPullRequest(pullRequestId);
            
            const builds = await buildApi.getBuilds(
                this.config.project,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                pr.sourceRefName
            );

            return builds.map((build: any) => ({
                id: build.id,
                buildNumber: build.buildNumber,
                status: build.status,
                result: build.result,
                url: build._links?.web?.href || '',
                definition: {
                    name: build.definition.name
                }
            }));
        } catch (error) {
            console.error('Failed to get build status:', error);
            return [];
        }
    }

    async getPolicyEvaluationsForPR(pullRequestId: number): Promise<PolicyEvaluation[]> {
        await this.ensureInitialized();

        try {
            const policyApi = await this.connection!.getPolicyApi();
            const evaluations = await policyApi.getPolicyEvaluations(
                this.config.project,
                `vstfs:///CodeReview/CodeReviewId/${this.config.project}/${pullRequestId}`
            );

            return evaluations.map((evaluation: any) => ({
                policyId: evaluation.configuration.id,
                policyName: evaluation.configuration.type.displayName,
                status: evaluation.status,
                isBlocking: evaluation.configuration.isBlocking
            }));
        } catch (error) {
            console.error('Failed to get policy evaluations:', error);
            return [];
        }
    }

    // PR Iterations
    async getPRIterations(pullRequestId: number): Promise<PRIteration[]> {
        await this.ensureInitialized();

        const iterations = await this.gitApi!.getPullRequestIterations(
            this.config.repository,
            pullRequestId,
            this.config.project
        );

        return iterations.map((iteration: any) => ({
            id: iteration.id,
            author: {
                displayName: iteration.author?.displayName || 'Unknown',
                uniqueName: iteration.author?.uniqueName || ''
            },
            createdDate: iteration.createdDate,
            description: iteration.description,
            sourceRefCommit: {
                commitId: iteration.sourceRefCommit.commitId
            },
            targetRefCommit: {
                commitId: iteration.targetRefCommit.commitId
            }
        }));
    }

    // Merge Conflicts
    async getMergeConflicts(pullRequestId: number): Promise<MergeConflict[]> {
        await this.ensureInitialized();

        try {
            const conflicts = await this.gitApi!.getPullRequestConflicts(
                this.config.repository,
                pullRequestId,
                this.config.project
            );

            return conflicts.map((conflict: any) => ({
                conflictId: conflict.conflictId,
                conflictPath: conflict.conflictPath,
                conflictType: conflict.conflictType,
                mergeSourceCommit: {
                    commitId: conflict.mergeSourceCommit.commitId
                },
                mergeTargetCommit: {
                    commitId: conflict.mergeTargetCommit.commitId
                }
            }));
        } catch (error) {
            console.error('Failed to get merge conflicts:', error);
            return [];
        }
    }

    // Label Management
    async addLabelToPR(pullRequestId: number, labelName: string): Promise<void> {
        await this.ensureInitialized();

        const label = {
            name: labelName,
            active: true
        };

        await this.gitApi!.createPullRequestLabel(
            label,
            this.config.repository,
            pullRequestId,
            labelName,
            this.config.project
        );
    }

    async removeLabelFromPR(pullRequestId: number, labelName: string): Promise<void> {
        await this.ensureInitialized();

        await this.gitApi!.deletePullRequestLabels(
            this.config.repository,
            pullRequestId,
            labelName,
            this.config.project
        );
    }

    async getLabelsForPR(pullRequestId: number): Promise<Label[]> {
        await this.ensureInitialized();

        const labels = await this.gitApi!.getPullRequestLabels(
            this.config.repository,
            pullRequestId,
            this.config.project
        );

        return labels.map((label: any) => ({
            id: label.id,
            name: label.name,
            active: label.active
        }));
    }

    // Completion Options
    async completePRWithOptions(
        pullRequestId: number,
        options: CompletionOptions
    ): Promise<void> {
        await this.ensureInitialized();

        const pr = await this.getPullRequest(pullRequestId);
        
        const updatePR: any = {
            status: 3, // Completed
            lastMergeSourceCommit: pr.sourceRefName,
            completionOptions: {
                deleteSourceBranch: options.deleteSourceBranch || false,
                squashMerge: options.squashMerge || false,
                mergeCommitMessage: options.mergeCommitMessage,
                bypassPolicy: options.bypassPolicy || false,
                transitionWorkItems: options.transitionWorkItems !== false
            }
        };

        await this.gitApi!.updatePullRequest(
            updatePR,
            this.config.repository,
            pullRequestId,
            this.config.project
        );
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.connection || !this.gitApi) {
            await this.initialize();
        }
    }

    private mapToPullRequest(pr: any): PullRequest {
        return {
            pullRequestId: pr.pullRequestId,
            title: pr.title,
            description: pr.description || '',
            createdBy: {
                displayName: pr.createdBy.displayName,
                uniqueName: pr.createdBy.uniqueName,
                imageUrl: pr.createdBy.imageUrl
            },
            creationDate: pr.creationDate,
            status: pr.status,
            sourceRefName: pr.sourceRefName,
            targetRefName: pr.targetRefName,
            reviewers: pr.reviewers?.map((r: any) => ({
                displayName: r.displayName,
                uniqueName: r.uniqueName,
                vote: r.vote,
                isRequired: r.isRequired || false
            })) || [],
            labels: pr.labels?.map((l: any) => ({
                id: l.id,
                name: l.name
            })) || [],
            mergeStatus: pr.mergeStatus,
            isDraft: pr.isDraft || false
        };
    }
}
