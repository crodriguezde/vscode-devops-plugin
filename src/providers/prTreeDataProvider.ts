import * as vscode from 'vscode';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { PullRequest } from '../types';

interface PRGrouping {
    parentWorkItem: {
        id?: number;
        title: string;
    };
    people: Map<string, PullRequest[]>;
}

type GroupingMode = 'people' | 'workitems';

export class PRTreeDataProvider implements vscode.TreeDataProvider<PRTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PRTreeItem | undefined | null | void> = new vscode.EventEmitter<PRTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PRTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private pullRequests: PullRequest[] = [];
    private groupedPRs: Map<string, PRGrouping> = new Map();
    private groupedByPeople: Map<string, PullRequest[]> = new Map();
    private pendingMyReviewPRs: Set<number> = new Set();
    private reviewedByMePRs: Set<number> = new Set();
    private context: vscode.ExtensionContext;
    private groupingMode: GroupingMode = 'people';
    private workItemsReady: boolean = false;

    constructor(private azureDevOpsService: AzureDevOpsService, context?: vscode.ExtensionContext) {
        this.context = context!;
        if (context) {
            // Load PR states from workspace state
            const pendingStored = context.workspaceState.get<number[]>('pendingMyReviewPRs', []);
            const reviewedStored = context.workspaceState.get<number[]>('reviewedByMePRs', []);
            this.pendingMyReviewPRs = new Set(pendingStored);
            this.reviewedByMePRs = new Set(reviewedStored);

            // Watch for configuration changes
            context.subscriptions.push(
                vscode.workspace.onDidChangeConfiguration(e => {
                    if (e.affectsConfiguration('azureDevOpsPR.workItemGroupingLevel')) {
                        // Mark work items as not ready since we need to re-fetch with new level
                        this.workItemsReady = false;
                        
                        // Always refresh to get new grouping
                        vscode.window.showInformationMessage(
                            'Work item grouping level changed. Refreshing pull requests...'
                        );
                        this.refresh();
                    }
                })
            );
        }
    }

    togglePendingMyReview(prId: number): void {
        if (this.pendingMyReviewPRs.has(prId)) {
            this.pendingMyReviewPRs.delete(prId);
        } else {
            this.pendingMyReviewPRs.add(prId);
        }
        
        // Save to workspace state
        if (this.context) {
            this.context.workspaceState.update('pendingMyReviewPRs', Array.from(this.pendingMyReviewPRs));
        }
        
        this._onDidChangeTreeData.fire();
    }

    toggleReviewedByMe(prId: number): void {
        if (this.reviewedByMePRs.has(prId)) {
            this.reviewedByMePRs.delete(prId);
        } else {
            this.reviewedByMePRs.add(prId);
        }
        
        // Save to workspace state
        if (this.context) {
            this.context.workspaceState.update('reviewedByMePRs', Array.from(this.reviewedByMePRs));
        }
        
        this._onDidChangeTreeData.fire();
    }

    isPendingMyReview(prId: number): boolean {
        return this.pendingMyReviewPRs.has(prId);
    }

    isReviewedByMe(prId: number): boolean {
        return this.reviewedByMePRs.has(prId);
    }

    getGroupingMode(): GroupingMode {
        return this.groupingMode;
    }

    isWorkItemsReady(): boolean {
        return this.workItemsReady;
    }

    async setGroupingMode(mode: GroupingMode): Promise<void> {
        if (this.groupingMode === mode) {
            return;
        }

        if (mode === 'workitems' && !this.workItemsReady) {
            vscode.window.showInformationMessage('Work items are still loading. Please wait...');
            return;
        }

        this.groupingMode = mode;
        this._onDidChangeTreeData.fire();
        
        const modeText = mode === 'people' ? 'Group by People' : 'Group by Work Items';
        vscode.window.showInformationMessage(`Switched to: ${modeText}`);
    }

    async refresh(): Promise<void> {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Loading Pull Requests",
            cancellable: false
        }, async (progress) => {
            try {
                // Remember the current mode before refresh
                const previousMode = this.groupingMode;
                
                // Step 1: Fetch PRs
                progress.report({ message: "Fetching pull requests...", increment: 20 });
                this.pullRequests = await this.azureDevOpsService.getPullRequests();
                
                // Step 2: Group by people (fast)
                progress.report({ message: `Grouping ${this.pullRequests.length} PRs by people...`, increment: 30 });
                this.groupPRsByPeople();
                
                // Step 3: Fire update to show people view temporarily
                this.workItemsReady = false;
                this.groupingMode = 'people';
                this._onDidChangeTreeData.fire();
                
                // Step 4: Group by work items in background (slow)
                progress.report({ message: "Loading work items in background...", increment: 25 });
                await this.groupPRsByWorkItemAndPerson(progress);
                
                // Step 5: Mark work items as ready
                this.workItemsReady = true;
                progress.report({ message: "Complete!", increment: 25 });
                
                // Restore the previous mode and fire update
                if (previousMode === 'workitems') {
                    this.groupingMode = 'workitems';
                    this._onDidChangeTreeData.fire();
                } else {
                    // Notify user that work items view is ready (only if was in people view)
                    vscode.window.showInformationMessage(
                        'Work items loaded. You can now switch to Group by Work Items view.',
                        'Switch Now'
                    ).then(selection => {
                        if (selection === 'Switch Now') {
                            this.setGroupingMode('workitems');
                        }
                    });
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to refresh PRs: ${error}`);
                this.pullRequests = [];
                this.groupedPRs.clear();
                this.groupedByPeople.clear();
                this._onDidChangeTreeData.fire();
            }
        });
    }

    private groupPRsByPeople(): void {
        this.groupedByPeople.clear();
        
        for (const pr of this.pullRequests) {
            const authorName = pr.createdBy?.displayName || 'Unknown Author';
            
            if (!this.groupedByPeople.has(authorName)) {
                this.groupedByPeople.set(authorName, []);
            }
            
            this.groupedByPeople.get(authorName)!.push(pr);
        }
        
        console.log(`[PRHierarchy] Grouped ${this.pullRequests.length} PRs into ${this.groupedByPeople.size} people groups`);
    }

    private async groupPRsByWorkItemAndPerson(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
        this.groupedPRs.clear();
        
        // Get the configured grouping level (0-4)
        const config = vscode.workspace.getConfiguration('azureDevOpsPR');
        const groupingLevel = config.get<number>('workItemGroupingLevel', 1);
        
        console.log(`[PRHierarchy] Processing ${this.pullRequests.length} pull requests with grouping level ${groupingLevel}`);
        
        // Process each PR and group by parent work item and person
        const totalPRs = this.pullRequests.length;
        for (let i = 0; i < totalPRs; i++) {
            const pr = this.pullRequests[i];
            
            // Update progress
            if (progress && i % 5 === 0) {
                const percentComplete = Math.floor((i / totalPRs) * 100);
                progress.report({ message: `Processing PR ${i + 1}/${totalPRs} (${percentComplete}%)` });
            }
            let parentKey = 'Unknown';
            let parentTitle = 'Unknown Work Item';
            let parentId: number | undefined = undefined;

            try {
                console.log(`[PRHierarchy] Processing PR #${pr.pullRequestId}`);
                
                // Get work items for this PR
                const workItems = await this.azureDevOpsService.getWorkItemsForPR(pr.pullRequestId);
                console.log(`[PRHierarchy] PR #${pr.pullRequestId} has ${workItems?.length || 0} work items`);
                
                if (workItems && workItems.length > 0) {
                    // Get the first work item's details
                    const workItemId = parseInt(workItems[0].id);
                    console.log(`[PRHierarchy] Fetching work item at level ${groupingLevel} for work item ${workItemId}`);
                    
                    // Get work item at configured hierarchy level
                    const workItemAtLevel = await this.azureDevOpsService.getWorkItemAtLevel(workItemId, groupingLevel);
                    console.log(`[PRHierarchy] Work item at level ${groupingLevel}:`, workItemAtLevel ? `${workItemAtLevel.id}: ${workItemAtLevel.title}` : 'none');
                    
                    if (workItemAtLevel) {
                        parentKey = `WI-${workItemAtLevel.id}`;
                        parentTitle = `#${workItemAtLevel.id}: ${workItemAtLevel.title}`;
                        parentId = workItemAtLevel.id;
                        console.log(`[PRHierarchy] Using grouping: ${parentTitle}`);
                    }
                } else {
                    console.log(`[PRHierarchy] PR #${pr.pullRequestId} has no work items, using Unknown group`);
                }
            } catch (error) {
                console.error(`[PRHierarchy] Failed to get work item info for PR ${pr.pullRequestId}:`, error);
            }

            // Get or create parent work item group
            if (!this.groupedPRs.has(parentKey)) {
                this.groupedPRs.set(parentKey, {
                    parentWorkItem: {
                        id: parentId,
                        title: parentTitle
                    },
                    people: new Map()
                });
            }

            const group = this.groupedPRs.get(parentKey)!;
            const authorName = pr.createdBy?.displayName || 'Unknown Author';

            // Get or create person group
            if (!group.people.has(authorName)) {
                group.people.set(authorName, []);
            }

            // Add PR to person's list
            group.people.get(authorName)!.push(pr);
        }
        
        console.log(`[PRHierarchy] Created ${this.groupedPRs.size} work item groups`);
    }

    getTreeItem(element: PRTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PRTreeItem): Promise<PRTreeItem[]> {
        if (!element) {
            // Root level - different views based on grouping mode
            if (this.groupingMode === 'people') {
                // Group by People view: People → PRs
                const items: PRTreeItem[] = [];
                
                for (const [personName, prs] of this.groupedByPeople) {
                    const prCount = prs.length;
                    items.push(new PRTreeItem(
                        `${personName} (${prCount})`,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'personGroup',
                        undefined,
                        undefined,
                        undefined,
                        personName
                    ));
                }
                
                // Sort by person name
                items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
                
                return items;
            } else {
                // Group by Work Items view: Work Items → People → PRs
                const items: PRTreeItem[] = [];
                
                for (const [key, group] of this.groupedPRs) {
                    items.push(new PRTreeItem(
                        group.parentWorkItem.title,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'workItemGroup',
                        undefined,
                        key,
                        group.parentWorkItem.id
                    ));
                }

                // Sort by work item ID (descending) or put "Unknown" at the end
                items.sort((a, b) => {
                    if (a.groupKey === 'Unknown' && b.groupKey !== 'Unknown') return 1;
                    if (b.groupKey === 'Unknown' && a.groupKey !== 'Unknown') return -1;
                    
                    const aId = a.workItemId || 0;
                    const bId = b.workItemId || 0;
                    return bId - aId;
                });

                return items;
            }
        } else if (element.type === 'personGroup' && this.groupingMode === 'people') {
            // In people mode: show PRs directly under person
            const prs = this.groupedByPeople.get(element.personName!) || [];
            return prs.map(pr => 
                new PRTreeItem(
                    `#${pr.pullRequestId}: ${pr.title}`,
                    vscode.TreeItemCollapsibleState.None,
                    'pullRequest',
                    pr,
                    undefined,
                    undefined,
                    undefined,
                    this.isPendingMyReview(pr.pullRequestId),
                    this.isReviewedByMe(pr.pullRequestId)
                )
            );
        } else if (element.type === 'workItemGroup') {
            // Second level - show people under this work item
            const group = this.groupedPRs.get(element.groupKey!);
            if (!group) return [];

            const items: PRTreeItem[] = [];
            for (const [personName, prs] of group.people) {
                const prCount = prs.length;
                items.push(new PRTreeItem(
                    `${personName} (${prCount})`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'personGroup',
                    undefined,
                    element.groupKey,
                    undefined,
                    personName
                ));
            }

            // Sort by person name
            items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));

            return items;
        } else if (element.type === 'personGroup') {
            // Third level - show PRs for this person under this work item
            const group = this.groupedPRs.get(element.groupKey!);
            if (!group || !element.personName) return [];

            const prs = group.people.get(element.personName) || [];
            return prs.map(pr => 
                new PRTreeItem(
                    `#${pr.pullRequestId}: ${pr.title}`,
                    vscode.TreeItemCollapsibleState.None,
                    'pullRequest',
                    pr,
                    undefined,
                    undefined,
                    undefined,
                    this.isPendingMyReview(pr.pullRequestId),
                    this.isReviewedByMe(pr.pullRequestId)
                )
            );
        } else if (element.type === 'pullRequest' && element.pr) {
            // Fourth level - show PR details (optional, keep collapsed for now)
            return [];
        }

        return [];
    }
}

export class PRTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'workItemGroup' | 'personGroup' | 'pullRequest',
        public readonly pr?: PullRequest,
        public readonly groupKey?: string,
        public readonly workItemId?: number,
        public readonly personName?: string,
        isPendingMyReview?: boolean,
        isReviewedByMe?: boolean
    ) {
        super(label, collapsibleState);

        if (type === 'workItemGroup') {
            this.iconPath = new vscode.ThemeIcon('issues', new vscode.ThemeColor('terminal.ansiBlue'));
            this.contextValue = 'workItemGroup';
            this.tooltip = `Work Item: ${label}`;
        } else if (type === 'personGroup') {
            this.iconPath = new vscode.ThemeIcon('person', new vscode.ThemeColor('terminal.ansiYellow'));
            this.contextValue = 'personGroup';
            this.tooltip = `Author: ${personName}`;
        } else if (type === 'pullRequest' && pr) {
            this.iconPath = PRTreeItem.getStatusIcon(pr);
            this.contextValue = 'pullRequest';
            
            // Build status indicators for tooltip
            const indicators: string[] = [];
            if (isPendingMyReview) indicators.push('⏳ Pending My Review');
            if (isReviewedByMe) indicators.push('✓ Reviewed by Me');
            const statusText = indicators.length > 0 ? `\n${indicators.join('\n')}` : '';
            
            this.tooltip = `${pr.title}\nStatus: ${PRTreeItem.getStatusText(pr)}\nBranch: ${this.getBranchName(pr.sourceRefName)} → ${this.getBranchName(pr.targetRefName)}${statusText}`;
            
            // Show review indicators on the right side only
            const descriptionParts = [];
            if (isPendingMyReview) descriptionParts.push('⏳');
            if (isReviewedByMe) descriptionParts.push('✓');
            this.description = descriptionParts.length > 0 ? descriptionParts.join(' ') : undefined;
        }
    }

    private getBranchName(refName: string): string {
        return refName.replace('refs/heads/', '');
    }

    private static getStatusText(pr: PullRequest): string {
        const status = typeof pr.status === 'number' 
            ? pr.status.toString() 
            : (pr.status || '').toLowerCase();

        if (pr.isDraft) {
            return 'Draft';
        }
        
        switch (status) {
            case '1':
            case 'active':
                return 'Active';
            case '3':
            case 'completed':
                return 'Completed';
            case '2':
            case 'abandoned':
                return 'Abandoned';
            default:
                return 'Unknown';
        }
    }

    private static getStatusIcon(pr: PullRequest): vscode.ThemeIcon {
        const status = typeof pr.status === 'number'
            ? pr.status.toString() 
            : (pr.status || '').toLowerCase();

        if (pr.isDraft) {
            return new vscode.ThemeIcon('git-pull-request-draft', new vscode.ThemeColor('editorWarning.foreground'));
        }

        switch (status) {
            case '1':
            case 'active':
                return new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('terminal.ansiGreen'));
            case '3':
            case 'completed':
                return new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
            case '2':
            case 'abandoned':
                return new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
            default:
                return new vscode.ThemeIcon('git-pull-request');
        }
    }
}
