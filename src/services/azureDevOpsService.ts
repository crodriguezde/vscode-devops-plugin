import * as azdev from 'azure-devops-node-api';
import * as vscode from 'vscode';
import { IGitApi } from 'azure-devops-node-api/GitApi.js';
import { WorkItemExpand } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js';
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
import { AzureCliAuthProvider } from '../auth/azureCliAuth';

export class AzureDevOpsService {
    private connection?: azdev.WebApi;
    private gitApi?: IGitApi;
    private authProvider: AzureCliAuthProvider;
    private config: AzureDevOpsConfig;

    constructor(authProvider: AzureCliAuthProvider) {
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
        if (!this.config.organization) {
            throw new Error('Azure DevOps organization not configured. Please set azureDevOpsPR.organization in settings.');
        }

        if (!this.config.project) {
            throw new Error('Azure DevOps project not configured. Please set azureDevOpsPR.project in settings.');
        }

        // Get token from Azure CLI
        let token: string;
        try {
            token = await this.authProvider.getToken();
        } catch (error: any) {
            throw new Error(`Failed to get Azure CLI token: ${error.message}\n\nPlease ensure:\n1. Azure CLI is installed\n2. You are logged in with 'az login'\n3. Your account has access to Azure DevOps`);
        }

        // Ensure organization URL is properly formatted
        let orgUrl = this.config.organization;
        
        // If it's not a full URL, assume it's just the org name and use new format
        if (!orgUrl.startsWith('http://') && !orgUrl.startsWith('https://')) {
            orgUrl = `https://dev.azure.com/${orgUrl}`;
        }
        
        // Remove trailing slash if present
        orgUrl = orgUrl.replace(/\/$/, '');

        try {
            const authHandler = azdev.getPersonalAccessTokenHandler(token);
            this.connection = new azdev.WebApi(orgUrl, authHandler);
            this.gitApi = await this.connection.getGitApi();
        } catch (error: any) {
            throw new Error(`Failed to initialize Azure DevOps connection: ${error.message || error}\n\nPlease verify:\n1. Your Azure account has access to the organization\n2. You have 'Code Read & Write' permissions`);
        }
    }

    async getPullRequests(status: string = 'active'): Promise<PullRequest[]> {
        await this.ensureInitialized();

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

        try {
            const searchCriteria: any = {
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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

        const pr = await this.gitApi!.getPullRequest(
            this.config.repository,
            pullRequestId,
            this.config.project
        );

        return this.mapToPullRequest(pr);
    }

    async getPRFiles(pullRequestId: number): Promise<PRFile[]> {
        await this.ensureInitialized();

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

        const iterations = await this.gitApi!.getPullRequestIterations(
            this.config.repository,
            pullRequestId,
            this.config.project
        );

        if (iterations.length === 0) {
            return [];
        }

        const lastIteration = iterations[iterations.length - 1];
        const changes = await this.gitApi!.getPullRequestIterationChanges(
            this.config.repository,
            pullRequestId,
            lastIteration.id!,
            this.config.project
        );

        return (changes.changeEntries || []).map((change: any) => ({
            path: change.item.path,
            changeType: change.changeType,
            objectId: change.item.objectId,
            originalObjectId: change.item.originalObjectId
        }));
    }

    async getPRCommits(pullRequestId: number): Promise<any[]> {
        await this.ensureInitialized();
        
        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }
        
        try {
            const commits = await this.gitApi!.getPullRequestCommits(
                this.config.repository,
                pullRequestId,
                this.config.project
            );
            
            return commits || [];
        } catch (error) {
            console.error('Error fetching PR commits:', error);
            throw new Error(`Failed to fetch PR commits: ${error}`);
        }
    }

    async getCommitChanges(commitId: string): Promise<any[]> {
        await this.ensureInitialized();
        
        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }
        
        try {
            const changes = await this.gitApi!.getChanges(
                commitId,
                this.config.repository,
                this.config.project
            );
            
            return changes.changes || [];
        } catch (error) {
            console.error('Error fetching commit changes:', error);
            throw new Error(`Failed to fetch commit changes: ${error}`);
        }
    }

    async getPRThreads(pullRequestId: number, force: boolean = false): Promise<PRThread[]> {
        await this.ensureInitialized();

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

        console.log(`[AzureDevOps] Fetching PR threads for PR #${pullRequestId} (force: ${force})`);
        
        const threads = await this.gitApi!.getThreads(
            this.config.repository,
            pullRequestId,
            this.config.project
        );

        console.log(`[AzureDevOps] Received ${threads.length} threads from API`);
        
        // Filter out deleted comments
        const activeThreads = threads.filter((thread: any) => {
            const hasActiveComments = thread.comments?.some((c: any) => !c.isDeleted);
            return hasActiveComments;
        });

        console.log(`[AzureDevOps] ${activeThreads.length} threads with active comments`);

        return activeThreads.map((thread: any) => ({
            id: thread.id,
            comments: thread.comments
                .filter((comment: any) => !comment.isDeleted) // Filter out deleted comments
                .map((comment: any) => ({
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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

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
                    versionType: 'branch' as any
                }
            );

            return item.content || '';
        } catch (error) {
            throw new Error(`Failed to get file content from branch ${branch}: ${error}`);
        }
    }

    async addComment(pullRequestId: number, content: string, filePath?: string): Promise<void> {
        await this.ensureInitialized();

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

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

    async addInlineCommentRange(
        pullRequestId: number,
        content: string,
        filePath: string,
        startLine: number,
        endLine: number
    ): Promise<void> {
        await this.ensureInitialized();

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

        const thread: any = {
            comments: [{
                content: content,
                commentType: 1
            }],
            status: 1,
            threadContext: {
                filePath: filePath,
                rightFileStart: {
                    line: startLine,
                    offset: 1
                },
                rightFileEnd: {
                    line: endLine,
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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

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

    async getCommentThread(pullRequestId: number, threadId: number): Promise<any> {
        await this.ensureInitialized();

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

        try {
            // Get all threads and find the one we need
            const threads = await this.gitApi!.getThreads(
                this.config.repository,
                pullRequestId,
                this.config.project
            );

            const thread = threads.find((t: any) => t.id === threadId);
            
            if (!thread) {
                throw new Error(`Thread ${threadId} not found`);
            }

            return {
                id: thread.id,
                comments: thread.comments?.map((comment: any) => ({
                    id: comment.id,
                    content: comment.content,
                    author: {
                        id: comment.author?.id,
                        displayName: comment.author?.displayName,
                        uniqueName: comment.author?.uniqueName
                    },
                    publishedDate: comment.publishedDate,
                    isDeleted: comment.isDeleted || false
                })) || [],
                status: thread.status,
                threadContext: thread.threadContext
            };
        } catch (error) {
            console.error(`Failed to get thread ${threadId}:`, error);
            throw error;
        }
    }

    async getCurrentUser(): Promise<any> {
        await this.ensureInitialized();

        try {
            // Get the authorized user from connection data
            const coreApi = await this.connection!.getCoreApi();
            const teamContext: any = { project: this.config.project };
            
            // Get current user from team members
            try {
                const members = await coreApi.getTeamMembersWithExtendedProperties(
                    this.config.project,
                    this.config.project
                );
                
                if (members && members.length > 0) {
                    // The first member with 'me' identity is typically the current user
                    const currentUser = members[0].identity;
                    return {
                        id: currentUser?.id,
                        displayName: currentUser?.displayName,
                        uniqueName: currentUser?.uniqueName
                    };
                }
            } catch {
                // Fallback: just return a basic identity
                return {
                    id: 'me',
                    displayName: 'Current User',
                    uniqueName: 'me'
                };
            }
            
            return null;
        } catch (error) {
            console.error('Failed to get current user:', error);
            // Return a fallback
            return {
                id: 'me',
                displayName: 'Current User',
                uniqueName: 'me'
            };
        }
    }

    async resolveThread(pullRequestId: number, threadId: number): Promise<void> {
        await this.ensureInitialized();

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

        const pr = await this.getPullRequest(pullRequestId);
        
        const updatePR: any = {
            status: 3 // Completed
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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

        try {
            // Need to get PR with includeLinks option to fetch work item refs
            const pr = await this.gitApi!.getPullRequest(
                this.config.repository,
                pullRequestId,
                this.config.project,
                undefined, // maxCommentLength
                undefined, // skip
                undefined, // top
                true,      // includeLinks - THIS IS KEY!
                true       // includeWorkItemRefs - THIS TOO!
            );

            console.log(`[WorkItems] PR #${pullRequestId} raw work item refs:`, pr.workItemRefs);

            if (!pr.workItemRefs || pr.workItemRefs.length === 0) {
                console.log(`[WorkItems] PR #${pullRequestId} has no work item refs in API response`);
                return [];
            }

            return pr.workItemRefs.map((wi: any) => ({
                id: wi.id,
                url: wi.url
            }));
        } catch (error) {
            console.error(`[WorkItems] Failed to get work items for PR #${pullRequestId}:`, error);
            throw error;
        }
    }

    async getWorkItemDetails(workItemId: number): Promise<any> {
        await this.ensureInitialized();

        try {
            const config = vscode.workspace.getConfiguration('azureDevOpsPR');
            const debugEnabled = config.get<boolean>('debugWorkItemHierarchy', false);
            
            const workItemTrackingApi = await this.connection!.getWorkItemTrackingApi();
            const workItem = await workItemTrackingApi.getWorkItem(
                workItemId,
                undefined,  // Cannot specify fields when using expand parameter
                undefined,
                WorkItemExpand.Relations,  // Expand relations to get parent links
                this.config.project
            );

            if (debugEnabled) {
                console.log(`[WorkItemDetails] WI #${workItemId} raw relations:`, JSON.stringify(workItem.relations, null, 2));
            }

            // Find parent relationship
            const parentRelation = workItem.relations?.find((r: any) => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
            let parentId: number | undefined = undefined;
            
            if (parentRelation && parentRelation.url) {
                // Extract work item ID from URL (e.g., "https://dev.azure.com/org/project/_apis/wit/workItems/12345")
                const match = parentRelation.url.match(/workItems\/(\d+)$/);
                if (match) {
                    parentId = parseInt(match[1], 10);
                }
            }

            if (debugEnabled) {
                console.log(`[WorkItemDetails] WI #${workItemId}: ${workItem.fields?.['System.Title']} (Type: ${workItem.fields?.['System.WorkItemType']}, Parent: ${parentId || 'none'})`);
            }

            return {
                id: workItem.id,
                title: workItem.fields?.['System.Title'],
                workItemType: workItem.fields?.['System.WorkItemType'],
                state: workItem.fields?.['System.State'],
                assignedTo: workItem.fields?.['System.AssignedTo']?.displayName,
                parentId: parentId
            };
        } catch (error) {
            console.error(`Failed to get work item ${workItemId}:`, error);
            return null;
        }
    }

    async getWorkItemParent(workItemId: number): Promise<any> {
        await this.ensureInitialized();

        try {
            const workItemDetails = await this.getWorkItemDetails(workItemId);
            
            if (!workItemDetails || !workItemDetails.parentId) {
                return null;
            }

            const parentId = parseInt(workItemDetails.parentId);
            return await this.getWorkItemDetails(parentId);
        } catch (error) {
            console.error(`Failed to get parent for work item ${workItemId}:`, error);
            return null;
        }
    }

    async getWorkItemAtLevel(workItemId: number, level: number): Promise<any> {
        await this.ensureInitialized();

        try {
            const config = vscode.workspace.getConfiguration('azureDevOpsPR');
            const debugEnabled = config.get<boolean>('debugWorkItemHierarchy', false);
            
            if (debugEnabled) {
                console.log(`[WorkItemAtLevel] Starting traversal from WI #${workItemId} to level ${level}`);
            }
            
            let currentWorkItem = await this.getWorkItemDetails(workItemId);
            
            if (!currentWorkItem) {
                if (debugEnabled) {
                    console.log(`[WorkItemAtLevel] Failed to get initial work item #${workItemId}`);
                }
                return null;
            }

            if (debugEnabled) {
                console.log(`[WorkItemAtLevel] Level 0: WI #${currentWorkItem.id} - ${currentWorkItem.title}`);
            }

            // If level is 0, return the work item itself
            if (level === 0) {
                return currentWorkItem;
            }

            // Traverse up the hierarchy 'level' times
            for (let i = 0; i < level; i++) {
                if (!currentWorkItem.parentId) {
                    // No more parents, return the highest we can get
                    if (debugEnabled) {
                        console.log(`[WorkItemAtLevel] Reached top of hierarchy at level ${i} for work item ${workItemId}, returning WI #${currentWorkItem.id}`);
                    }
                    return currentWorkItem;
                }
                
                if (debugEnabled) {
                    console.log(`[WorkItemAtLevel] Level ${i + 1}: Moving to parent WI #${currentWorkItem.parentId}`);
                }
                
                const parent = await this.getWorkItemDetails(currentWorkItem.parentId);
                
                if (!parent) {
                    // Failed to get parent, return what we have
                    if (debugEnabled) {
                        console.log(`[WorkItemAtLevel] Failed to get parent WI #${currentWorkItem.parentId} at level ${i + 1}, returning WI #${currentWorkItem.id}`);
                    }
                    return currentWorkItem;
                }
                
                if (debugEnabled) {
                    console.log(`[WorkItemAtLevel] Level ${i + 1}: Got parent WI #${parent.id} - ${parent.title}`);
                }
                currentWorkItem = parent;
            }

            if (debugEnabled) {
                console.log(`[WorkItemAtLevel] Final result at level ${level}: WI #${currentWorkItem.id} - ${currentWorkItem.title}`);
            }
            return currentWorkItem;
        } catch (error) {
            console.error(`Failed to get work item at level ${level} for work item ${workItemId}:`, error);
            return null;
        }
    }

    async linkWorkItemToPR(pullRequestId: number, workItemId: string): Promise<void> {
        await this.ensureInitialized();

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

        const workItemRef = {
            id: workItemId,
            url: `${this.config.organization}/_apis/wit/workItems/${workItemId}`
        };

        await this.gitApi!.updatePullRequest(
            { workItemRefs: [workItemRef] } as any,
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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

        await this.gitApi!.deletePullRequestLabels(
            this.config.repository,
            pullRequestId,
            labelName,
            this.config.project
        );
    }

    async getLabelsForPR(pullRequestId: number): Promise<Label[]> {
        await this.ensureInitialized();

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

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

        if (!this.config.repository) {
            throw new Error('Repository not configured. Please set azureDevOpsPR.repository in settings.');
        }

        const pr = await this.getPullRequest(pullRequestId);
        
        const updatePR: any = {
            status: 3, // Completed
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
