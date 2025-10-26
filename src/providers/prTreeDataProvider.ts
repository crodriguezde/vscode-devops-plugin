import * as vscode from 'vscode';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { PullRequest } from '../types';
import { ManualGroup, ManualGroupingState } from '../types/manualGrouping';
import { PRDragAndDropController } from './prDragAndDropController';
import { buildWorkItemHierarchyChain } from '../services/hierarchyCacheHelper';

interface PRGrouping {
    parentWorkItem: {
        id?: number;
        title: string;
    };
    people: Map<string, PullRequest[]>;
}

type GroupingMode = 'people' | 'workitems' | 'manual';

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
    private manualGroups: Map<string, ManualGroup> = new Map();
    private manualGroupingState: ManualGroupingState = { groups: [], nextId: 1 };
    public dragAndDropController: PRDragAndDropController;
    
    // Work item hierarchy cache: workItemId -> array of ancestors from level 0 to max level found
    private workItemHierarchyCache: Map<number, any[]> = new Map();
    private cachedMaxLevel: number = 0;
    // PR to WorkItem mapping cache: prId -> workItemId (for fast regrouping without API calls)
    private prToWorkItemCache: Map<number, number> = new Map();

    constructor(private azureDevOpsService: AzureDevOpsService, context?: vscode.ExtensionContext) {
        this.context = context!;
        
        // Initialize drag and drop controller
        this.dragAndDropController = new PRDragAndDropController();
        this.dragAndDropController.setDropCallback(this.handleDrop.bind(this));
        this.dragAndDropController.setPersonGroupDropCallback(this.handlePersonGroupDrop.bind(this));
        
        if (context) {
            // Load PR states from workspace state
            const pendingStored = context.workspaceState.get<number[]>('pendingMyReviewPRs', []);
            const reviewedStored = context.workspaceState.get<number[]>('reviewedByMePRs', []);
            this.pendingMyReviewPRs = new Set(pendingStored);
            this.reviewedByMePRs = new Set(reviewedStored);

            // Load manual grouping state
            this.loadManualGroups();

            // Watch for configuration changes
            context.subscriptions.push(
                vscode.workspace.onDidChangeConfiguration(async e => {
                    if (e.affectsConfiguration('azureDevOpsPR.workItemGroupingLevel')) {
                        const config = vscode.workspace.getConfiguration('azureDevOpsPR');
                        const newLevel = config.get<number>('workItemGroupingLevel', 1);
                        const debugEnabled = config.get<boolean>('debugWorkItemHierarchy', false);
                        
                        if (debugEnabled) {
                            console.log(`[HierarchyCache] Level changed to ${newLevel}, cached max level: ${this.cachedMaxLevel}`);
                        }
                        
                        if (newLevel <= this.cachedMaxLevel) {
                            // We already have this data cached! Just regroup without fetching
                            if (debugEnabled) {
                                console.log(`[HierarchyCache] Using cached data for level ${newLevel}`);
                            }
                            vscode.window.showInformationMessage(
                                `Switched to level ${newLevel} (using cached data)`
                            );
                            await this.regroupByWorkItemLevel(newLevel);
                            this._onDidChangeTreeData.fire();
                        } else {
                            // Need to fetch higher levels
                            if (debugEnabled) {
                                console.log(`[HierarchyCache] Need to fetch level ${newLevel} (current max: ${this.cachedMaxLevel})`);
                            }
                            vscode.window.showInformationMessage(
                                `Fetching work item level ${newLevel}...`
                            );
                            this.workItemsReady = false;
                            await this.refresh();
                        }
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

    clearAllToggles(): number {
        const totalCleared = this.pendingMyReviewPRs.size + this.reviewedByMePRs.size;
        
        this.pendingMyReviewPRs.clear();
        this.reviewedByMePRs.clear();
        
        // Save to workspace state
        if (this.context) {
            this.context.workspaceState.update('pendingMyReviewPRs', []);
            this.context.workspaceState.update('reviewedByMePRs', []);
        }
        
        this._onDidChangeTreeData.fire();
        return totalCleared;
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
            vscode.window.showInformationMessage('Work items are still loading. Showing People view...');
            // Fall back to people mode and update context
            this.groupingMode = 'people';
            vscode.commands.executeCommand('setContext', 'azureDevOpsPR.mode', 'people');
            this._onDidChangeTreeData.fire();
            return;
        }

        this.groupingMode = mode;
        
        this._onDidChangeTreeData.fire();
        
        const modeText = mode === 'people' ? 'Group by People' : 
                        mode === 'workitems' ? 'Group by Work Items' :
                        'Manual Groups';
        vscode.window.showInformationMessage(`Switched to: ${modeText}`);
    }

    getCurrentWorkItemLevel(): number {
        const config = vscode.workspace.getConfiguration('azureDevOpsPR');
        return config.get<number>('workItemGroupingLevel', 1);
    }

    async setWorkItemLevel(level: number): Promise<void> {
        const config = vscode.workspace.getConfiguration('azureDevOpsPR');
        await config.update('workItemGroupingLevel', level, vscode.ConfigurationTarget.Global);
        // Update context to show current level in UI
        vscode.commands.executeCommand('setContext', 'azureDevOpsPR.currentLevel', level);
        // The configuration change listener will handle the regrouping
    }

    updateLevelContext(): void {
        const currentLevel = this.getCurrentWorkItemLevel();
        vscode.commands.executeCommand('setContext', 'azureDevOpsPR.currentLevel', currentLevel);
    }

    // Manual Grouping Methods
    private loadManualGroups(): void {
        const stored = this.context.workspaceState.get<ManualGroupingState>('manualGroupingState');
        if (stored) {
            this.manualGroupingState = stored;
            this.manualGroups.clear();
            for (const group of stored.groups) {
                // Clean up any invalid PR IDs that no longer exist
                // This will be done after PRs are loaded during refresh
                this.manualGroups.set(group.id, group);
            }
        }
    }

    // Clean up manual groups after PR refresh to remove stale PR IDs
    private cleanupManualGroups(): void {
        const validPRIds = new Set(this.pullRequests.map(pr => pr.pullRequestId));
        let changed = false;

        for (const group of this.manualGroupingState.groups) {
            const originalLength = group.prIds.length;
            group.prIds = group.prIds.filter(prId => validPRIds.has(prId));
            
            if (group.prIds.length !== originalLength) {
                changed = true;
                console.log(`[ManualGroups] Cleaned up group ${group.name}: removed ${originalLength - group.prIds.length} stale PR IDs`);
            }
        }

        if (changed) {
            this.saveManualGroups();
        }
    }

    private saveManualGroups(): void {
        this.context.workspaceState.update('manualGroupingState', this.manualGroupingState);
    }

    async createManualGroup(name: string): Promise<void> {
        const groupId = `manual-${this.manualGroupingState.nextId++}`;
        const newGroup: ManualGroup = {
            id: groupId,
            name: name,
            prIds: [],
            createdDate: new Date(),
            order: this.manualGroupingState.groups.length
        };

        this.manualGroupingState.groups.push(newGroup);
        this.manualGroups.set(groupId, newGroup);
        this.saveManualGroups();
        this._onDidChangeTreeData.fire();
    }

    async deleteManualGroup(groupId: string): Promise<void> {
        const index = this.manualGroupingState.groups.findIndex(g => g.id === groupId);
        if (index !== -1) {
            this.manualGroupingState.groups.splice(index, 1);
            this.manualGroups.delete(groupId);
            this.saveManualGroups();
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    async deleteAllManualGroups(): Promise<void> {
        this.manualGroupingState.groups = [];
        this.manualGroups.clear();
        this.saveManualGroups();
        this._onDidChangeTreeData.fire(undefined);
    }

    async renameManualGroup(groupId: string, newName: string): Promise<void> {
        const group = this.manualGroups.get(groupId);
        if (group) {
            group.name = newName;
            this.saveManualGroups();
            this._onDidChangeTreeData.fire();
        }
    }

    async addPRToManualGroup(prId: number, groupId: string, skipRefresh: boolean = false): Promise<void> {
        const group = this.manualGroups.get(groupId);
        if (group) {
            // Only add if not already present to prevent duplicates
            if (!group.prIds.includes(prId)) {
                group.prIds.push(prId);
                this.saveManualGroups();
                if (!skipRefresh) {
                    this._onDidChangeTreeData.fire();
                }
            } else {
                console.log(`[ManualGroups] PR #${prId} already exists in group ${groupId}, skipping add`);
            }
        }
    }

    async removePRFromManualGroup(prId: number, groupId: string, skipRefresh: boolean = false): Promise<void> {
        const group = this.manualGroups.get(groupId);
        if (group) {
            const index = group.prIds.indexOf(prId);
            if (index !== -1) {
                group.prIds.splice(index, 1);
                this.saveManualGroups();
                console.log(`[ManualGroups] Removed PR #${prId} from group ${groupId}`);
                if (!skipRefresh) {
                    this._onDidChangeTreeData.fire();
                }
            } else {
                console.log(`[ManualGroups] PR #${prId} not found in group ${groupId}, nothing to remove`);
            }
        }
    }

    getManualGroups(): ManualGroup[] {
        return this.manualGroupingState.groups;
    }

    // Drag and drop handler for person groups
    private async handlePersonGroupDrop(
        items: Array<{ type: string; personName: string; sourceGroupId?: string }>,
        target: PRTreeItem | undefined
    ): Promise<void> {
        console.log(`[DragDrop] handlePersonGroupDrop called for ${items.length} person group(s)`);
        
        // Determine target group ID
        let targetGroupId: string | undefined;
        
        if (target?.type === 'manualFolder') {
            targetGroupId = target.manualGroupId;
        } else if (target?.type === 'personGroup' && target.manualGroupId && target.manualGroupId !== 'ungrouped') {
            targetGroupId = target.manualGroupId;
        } else if (target?.type === 'ungroupedFolder' || target?.groupKey === 'ungrouped') {
            targetGroupId = undefined;
        } else {
            vscode.window.showWarningMessage('Cannot drop person group here. Drop on a folder.');
            return;
        }
        
        let totalPRsMoved = 0;
        
        for (const item of items) {
            const personName = item.personName;
            const sourceGroupId = item.sourceGroupId;
            
            console.log(`[DragDrop] Processing person group: ${personName} from ${sourceGroupId || 'ungrouped'}`);
            
            // Find all PRs for this person in the source group
            let prsToMove: number[] = [];
            
            if (sourceGroupId && sourceGroupId !== 'ungrouped') {
                // PRs are in a manual group
                const sourceGroup = this.manualGroups.get(sourceGroupId);
                if (sourceGroup) {
                    prsToMove = this.pullRequests
                        .filter(pr => 
                            sourceGroup.prIds.includes(pr.pullRequestId) &&
                            (pr.createdBy?.displayName || 'Unknown Author') === personName
                        )
                        .map(pr => pr.pullRequestId);
                }
            } else {
                // PRs are in ungrouped
                const ungrouped = this.getUngroupedPRsByPeople();
                const personPRs = ungrouped.get(personName);
                if (personPRs) {
                    prsToMove = personPRs.map(pr => pr.pullRequestId);
                }
            }
            
            console.log(`[DragDrop] Found ${prsToMove.length} PRs for ${personName}`);
            
            // Move all PRs for this person
            for (const prId of prsToMove) {
                // Remove from source
                if (sourceGroupId && sourceGroupId !== 'ungrouped') {
                    await this.removePRFromManualGroup(prId, sourceGroupId, true);
                }
                
                // Add to target
                if (targetGroupId) {
                    // Ensure not in any other group first
                    for (const group of this.manualGroupingState.groups) {
                        if (group.id !== targetGroupId && group.prIds.includes(prId)) {
                            await this.removePRFromManualGroup(prId, group.id, true);
                        }
                    }
                    await this.addPRToManualGroup(prId, targetGroupId, true);
                } else {
                    // Moving to ungrouped - remove from all groups
                    for (const group of this.manualGroupingState.groups) {
                        if (group.prIds.includes(prId)) {
                            await this.removePRFromManualGroup(prId, group.id, true);
                        }
                    }
                }
                
                totalPRsMoved++;
            }
        }
        
        // Refresh the view
        this._onDidChangeTreeData.fire(undefined);
        
        const groupName = targetGroupId 
            ? this.manualGroups.get(targetGroupId)?.name || 'Unknown'
            : 'Unassigned';
        vscode.window.showInformationMessage(
            `Moved ${totalPRsMoved} PR(s) from ${items.length} person group(s) to ${groupName}`
        );
    }

    // Drag and drop handler
    private async handleDrop(
        items: Array<{ prId: number; prTitle: string; sourceGroupId?: string }>,
        targetGroupId: string | undefined
    ): Promise<void> {
        console.log(`[DragDrop] handleDrop called: ${items.length} items to group ${targetGroupId || 'ungrouped'}`);
        
        // Track affected groups for partial refresh
        const affectedGroupIds = new Set<string>();
        const movedPRs: number[] = [];
        
        // Batch operations to avoid multiple refreshes
        for (const item of items) {
            // Skip if source and target are the same
            if (item.sourceGroupId === targetGroupId) {
                console.log(`[DragDrop] PR #${item.prId} already in target group, skipping`);
                continue;
            }
            
            // Skip if moving ungrouped to ungrouped
            if (!item.sourceGroupId && !targetGroupId) {
                console.log(`[DragDrop] PR #${item.prId} already ungrouped, skipping`);
                continue;
            }
            
            // Remove from source group if applicable
            if (item.sourceGroupId && item.sourceGroupId !== 'ungrouped') {
                await this.removePRFromManualGroup(item.prId, item.sourceGroupId, true);
                affectedGroupIds.add(item.sourceGroupId);
            } else if (!item.sourceGroupId || item.sourceGroupId === 'ungrouped') {
                // PR is currently ungrouped, remove from ALL groups to ensure clean state
                for (const group of this.manualGroupingState.groups) {
                    if (group.prIds.includes(item.prId)) {
                        await this.removePRFromManualGroup(item.prId, group.id, true);
                        affectedGroupIds.add(group.id);
                    }
                }
            }
            
            // Add to target group if not ungrouped
            if (targetGroupId) {
                // First ensure PR is not in any other group
                for (const group of this.manualGroupingState.groups) {
                    if (group.id !== targetGroupId && group.prIds.includes(item.prId)) {
                        await this.removePRFromManualGroup(item.prId, group.id, true);
                        affectedGroupIds.add(group.id);
                    }
                }
                
                await this.addPRToManualGroup(item.prId, targetGroupId, true);
                affectedGroupIds.add(targetGroupId);
            } else {
                // Moving to ungrouped - remove from all groups
                for (const group of this.manualGroupingState.groups) {
                    if (group.prIds.includes(item.prId)) {
                        await this.removePRFromManualGroup(item.prId, group.id, true);
                        affectedGroupIds.add(group.id);
                    }
                }
                affectedGroupIds.add('ungrouped');
            }
            
            movedPRs.push(item.prId);
        }
        
        // Partial refresh - only refresh affected groups
        console.log(`[DragDrop] Refreshing ${affectedGroupIds.size} affected groups`);
        this.refreshGroups(Array.from(affectedGroupIds));
        
        if (movedPRs.length > 0) {
            const groupName = targetGroupId 
                ? this.manualGroups.get(targetGroupId)?.name || 'Unknown'
                : 'Unassigned';
            vscode.window.showInformationMessage(
                `Moved ${movedPRs.length} PR(s) to ${groupName}`
            );
        } else {
            console.log(`[DragDrop] No PRs were moved`);
        }
    }

    // Partial refresh for specific groups - preserves expansion state
    private refreshGroups(groupIds: string[]): void {
        // Instead of firing a full refresh which collapses everything,
        // we fire undefined which tells VSCode to refresh while preserving state
        // This is the recommended approach for preserving tree expansion state
        this._onDidChangeTreeData.fire(undefined);
    }

    private getPRsInManualGroups(): Set<number> {
        const prIds = new Set<number>();
        for (const group of this.manualGroupingState.groups) {
            for (const prId of group.prIds) {
                prIds.add(prId);
            }
        }
        return prIds;
    }

    private getUngroupedPRsByPeople(): Map<string, PullRequest[]> {
        const groupedPRIds = this.getPRsInManualGroups();
        const ungrouped = new Map<string, PullRequest[]>();

        for (const pr of this.pullRequests) {
            if (!groupedPRIds.has(pr.pullRequestId)) {
                const authorName = pr.createdBy?.displayName || 'Unknown Author';
                if (!ungrouped.has(authorName)) {
                    ungrouped.set(authorName, []);
                }
                ungrouped.get(authorName)!.push(pr);
            }
        }

        return ungrouped;
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
                
                // Step 2: Clean up manual groups (remove stale PR IDs)
                this.cleanupManualGroups();
                
                // Step 3: Group by people (fast)
                progress.report({ message: `Grouping ${this.pullRequests.length} PRs by people...`, increment: 30 });
                this.groupPRsByPeople();
                
                // Step 4: Fire update to show people view temporarily
                this.workItemsReady = false;
                this.groupingMode = 'people';
                this._onDidChangeTreeData.fire();
                
                // Step 5: Group by work items in background (slow)
                progress.report({ message: "Loading work items in background...", increment: 25 });
                await this.groupPRsByWorkItemAndPerson(progress);
                
                // Step 6: Mark work items as ready
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

    private debugLog(message: string): void {
        const config = vscode.workspace.getConfiguration('azureDevOpsPR');
        const debugEnabled = config.get<boolean>('debugWorkItemHierarchy', false);
        if (debugEnabled) {
            console.log(message);
        }
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
        
        this.debugLog(`[PRHierarchy] Grouped ${this.pullRequests.length} PRs into ${this.groupedByPeople.size} people groups`);
    }

    private async regroupByWorkItemLevel(level: number): Promise<void> {
        this.groupedPRs.clear();
        
        const config = vscode.workspace.getConfiguration('azureDevOpsPR');
        const debugEnabled = config.get<boolean>('debugWorkItemHierarchy', false);
        
        if (debugEnabled) {
            console.log(`[HierarchyCache] Regrouping at level ${level} using cached data (no API calls)`);
        }
        
        // Use ONLY cached data to regroup - no API calls!
        for (const pr of this.pullRequests) {
            let parentKey = 'Unknown';
            let parentTitle = 'Unknown Work Item';
            let parentId: number | undefined = undefined;

            // Look up the work item ID for this PR from our mapping cache
            const workItemId = this.prToWorkItemCache.get(pr.pullRequestId);
            
            if (workItemId) {
                // Get the hierarchy chain for this work item
                const cachedHierarchy = this.workItemHierarchyCache.get(workItemId);
                
                if (cachedHierarchy) {
                    const workItemAtLevel = cachedHierarchy[level];
                    
                    if (workItemAtLevel) {
                        if (debugEnabled) {
                            console.log(`[HierarchyCache] PR #${pr.pullRequestId}: Using cached WI at level ${level}: #${workItemAtLevel.id}`);
                        }
                        
                        parentKey = `WI-${workItemAtLevel.id}`;
                        parentTitle = `#${workItemAtLevel.id}: ${workItemAtLevel.title}`;
                        parentId = workItemAtLevel.id;
                    } else {
                        // Level doesn't exist in hierarchy - use Unknown
                        if (debugEnabled) {
                            console.log(`[HierarchyCache] PR #${pr.pullRequestId}: No parent at level ${level}, using Unknown`);
                        }
                    }
                } else {
                    if (debugEnabled) {
                        console.log(`[HierarchyCache] PR #${pr.pullRequestId}: Work item hierarchy not cached, using Unknown`);
                    }
                }
            } else {
                if (debugEnabled) {
                    console.log(`[HierarchyCache] PR #${pr.pullRequestId}: No work item mapping cached, using Unknown`);
                }
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

            if (!group.people.has(authorName)) {
                group.people.set(authorName, []);
            }

            group.people.get(authorName)!.push(pr);
        }
        
        if (debugEnabled) {
            console.log(`[HierarchyCache] Regrouped into ${this.groupedPRs.size} work item groups`);
        }
    }

    private async groupPRsByWorkItemAndPerson(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
        this.groupedPRs.clear();
        
        // Get the configured grouping level (0-4)
        const config = vscode.workspace.getConfiguration('azureDevOpsPR');
        const groupingLevel = config.get<number>('workItemGroupingLevel', 1);
        
        this.debugLog(`[PRHierarchy] ============================================`);
        this.debugLog(`[PRHierarchy] Starting Work Item Grouping`);
        this.debugLog(`[PRHierarchy] Configuration grouping level: ${groupingLevel}`);
        this.debugLog(`[PRHierarchy] Total PRs to process: ${this.pullRequests.length}`);
        this.debugLog(`[PRHierarchy] ============================================`);
        
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
                this.debugLog(`[PRHierarchy] Processing PR #${pr.pullRequestId}`);
                
                // Get work items for this PR
                const workItems = await this.azureDevOpsService.getWorkItemsForPR(pr.pullRequestId);
                this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId} has ${workItems?.length || 0} work items`);
                
                if (workItems && workItems.length > 0) {
                    // Get the first work item's details
                    const workItemId = parseInt(workItems[0].id);
                    
                    // Cache the PR→WorkItem mapping for fast regrouping
                    this.prToWorkItemCache.set(pr.pullRequestId, workItemId);
                    
                    this.debugLog(`[PRHierarchy] ------------------------`);
                    this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId}: Found ${workItems.length} work items`);
                    this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId}: First work item ID: ${workItemId}`);
                    // Check if we already have this work item cached
                    let hierarchyChain = this.workItemHierarchyCache.get(workItemId);
                    
                    if (!hierarchyChain || hierarchyChain.length <= groupingLevel) {
                        // Need to fetch - either not cached or need higher levels
                        this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId}: Fetching hierarchy up to level ${groupingLevel}`);
                        
                        hierarchyChain = await buildWorkItemHierarchyChain(
                            this.azureDevOpsService,
                            workItemId,
                            groupingLevel  // Only fetch up to the requested level
                        );
                        
                        // Cache the chain
                        this.workItemHierarchyCache.set(workItemId, hierarchyChain);
                        this.cachedMaxLevel = Math.max(this.cachedMaxLevel, hierarchyChain.length - 1);
                    } else {
                        this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId}: Using cached data for level ${groupingLevel}`);
                    }
                    
                    // Use the appropriate level from cache
                    const workItemAtLevel = hierarchyChain[groupingLevel];
                    
                    if (workItemAtLevel) {
                        this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId}: ✓ Got work item at level ${groupingLevel}:`);
                        this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId}:   - ID: ${workItemAtLevel.id}`);
                        this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId}:   - Title: ${workItemAtLevel.title}`);
                        this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId}:   - Type: ${workItemAtLevel.workItemType}`);
                        
                        parentKey = `WI-${workItemAtLevel.id}`;
                        parentTitle = `#${workItemAtLevel.id}: ${workItemAtLevel.title}`;
                        parentId = workItemAtLevel.id;
                        this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId}: Will group under: ${parentTitle}`);
                    } else {
                        // Level doesn't exist in hierarchy (work item has no parent at this level)
                        this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId}: Work item has no parent at level ${groupingLevel}, using Unknown`);
                    }
                } else {
                    this.debugLog(`[PRHierarchy] PR #${pr.pullRequestId} has no work items, using Unknown group`);
                }
            } catch (error) {
                const config = vscode.workspace.getConfiguration('azureDevOpsPR');
                const debugEnabled = config.get<boolean>('debugWorkItemHierarchy', false);
                if (debugEnabled) {
                    console.error(`[PRHierarchy] Failed to get work item info for PR ${pr.pullRequestId}:`, error);
                }
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
        
        this.debugLog(`[PRHierarchy] Created ${this.groupedPRs.size} work item groups`);
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
                    const pendingCount = prs.filter(pr => this.isPendingMyReview(pr.pullRequestId)).length;
                    const reviewedCount = prs.filter(pr => this.isReviewedByMe(pr.pullRequestId)).length;
                    
                    let label = `${personName} (${prCount})`;
                    if (pendingCount > 0 || reviewedCount > 0) {
                        const counts = [];
                        if (pendingCount > 0) counts.push(`⏳${pendingCount}`);
                        if (reviewedCount > 0) counts.push(`✓${reviewedCount}`);
                        label = `${personName} (${prCount}) [${counts.join(' ')}]`;
                    }
                    
                    items.push(new PRTreeItem(
                        label,
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
            } else if (this.groupingMode === 'workitems') {
                // Group by Work Items view: Work Items → People → PRs
                const items: PRTreeItem[] = [];
                
                for (const [key, group] of this.groupedPRs) {
                    // Count all PRs and review statuses in this work item group
                    const allPRs: PullRequest[] = [];
                    for (const prs of group.people.values()) {
                        allPRs.push(...prs);
                    }
                    
                    const totalPRs = allPRs.length;
                    const pendingCount = allPRs.filter(pr => this.isPendingMyReview(pr.pullRequestId)).length;
                    const reviewedCount = allPRs.filter(pr => this.isReviewedByMe(pr.pullRequestId)).length;
                    
                    let label = `${group.parentWorkItem.title} (${totalPRs})`;
                    if (pendingCount > 0 || reviewedCount > 0) {
                        const counts = [];
                        if (pendingCount > 0) counts.push(`⏳${pendingCount}`);
                        if (reviewedCount > 0) counts.push(`✓${reviewedCount}`);
                        label = `${group.parentWorkItem.title} (${totalPRs}) [${counts.join(' ')}]`;
                    }
                    
                    items.push(new PRTreeItem(
                        label,
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
            } else {
                // Manual Groups mode: Manual Folders → People → PRs + Ungrouped Section
                const items: PRTreeItem[] = [];
                
                // Add manual group folders
                for (const group of this.manualGroupingState.groups) {
                    // Get actual PRs in this group
                    const groupPRs = this.pullRequests.filter(pr => group.prIds.includes(pr.pullRequestId));
                    const actualPRCount = groupPRs.length;
                    const pendingCount = groupPRs.filter(pr => this.isPendingMyReview(pr.pullRequestId)).length;
                    const reviewedCount = groupPRs.filter(pr => this.isReviewedByMe(pr.pullRequestId)).length;
                    
                    let label = `${group.name} (${actualPRCount})`;
                    if (pendingCount > 0 || reviewedCount > 0) {
                        const counts = [];
                        if (pendingCount > 0) counts.push(`⏳${pendingCount}`);
                        if (reviewedCount > 0) counts.push(`✓${reviewedCount}`);
                        label = `${group.name} (${actualPRCount}) [${counts.join(' ')}]`;
                    }
                    
                    items.push(new PRTreeItem(
                        label,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'manualFolder',
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        false,
                        false,
                        group.id
                    ));
                }
                
                // Add "Unassigned" group for PRs not in manual groups
                const ungrouped = this.getUngroupedPRsByPeople();
                const ungroupedCount = Array.from(ungrouped.values()).reduce((sum, prs) => sum + prs.length, 0);
                if (ungroupedCount > 0) {
                    items.push(new PRTreeItem(
                        `Unassigned (${ungroupedCount})`,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'ungroupedFolder',
                        undefined,
                        undefined,
                        undefined,
                        undefined
                    ));
                }
                
                return items;
            }
        } else if (element.type === 'workItemGroup') {
            // Second level - show people under this work item
            const group = this.groupedPRs.get(element.groupKey!);
            if (!group) return [];

            const items: PRTreeItem[] = [];
            for (const [personName, prs] of group.people) {
                const prCount = prs.length;
                const pendingCount = prs.filter(pr => this.isPendingMyReview(pr.pullRequestId)).length;
                const reviewedCount = prs.filter(pr => this.isReviewedByMe(pr.pullRequestId)).length;
                
                let label = `${personName} (${prCount})`;
                if (pendingCount > 0 || reviewedCount > 0) {
                    const counts = [];
                    if (pendingCount > 0) counts.push(`⏳${pendingCount}`);
                    if (reviewedCount > 0) counts.push(`✓${reviewedCount}`);
                    label = `${personName} (${prCount}) [${counts.join(' ')}]`;
                }
                
                items.push(new PRTreeItem(
                    label,
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
        } else if (element.type === 'personGroup' && this.groupingMode === 'people') {
            // In people mode: show PRs directly under person
            const prs = this.groupedByPeople.get(element.personName!) || [];
            return prs.map(pr => 
                new PRTreeItem(
                    `#${pr.pullRequestId}: ${pr.title}`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'pullRequest',
                    pr,
                    undefined,
                    undefined,
                    undefined,
                    this.isPendingMyReview(pr.pullRequestId),
                    this.isReviewedByMe(pr.pullRequestId)
                )
            );
        } else if (element.type === 'personGroup' && this.groupingMode === 'workitems') {
            // In workitems mode: show PRs for this person under this work item
            const group = this.groupedPRs.get(element.groupKey!);
            if (!group || !element.personName) return [];

            const prs = group.people.get(element.personName) || [];
            return prs.map(pr => 
                new PRTreeItem(
                    `#${pr.pullRequestId}: ${pr.title}`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'pullRequest',
                    pr,
                    undefined,
                    undefined,
                    undefined,
                    this.isPendingMyReview(pr.pullRequestId),
                    this.isReviewedByMe(pr.pullRequestId)
                )
            );
        } else if (element.type === 'manualFolder') {
            // Manual folder - show people groups
            const group = this.manualGroups.get(element.manualGroupId!);
            if (!group) return [];

            // Get PRs in this manual group, organized by person
            const peopleMap = new Map<string, PullRequest[]>();
            for (const prId of group.prIds) {
                const pr = this.pullRequests.find(p => p.pullRequestId === prId);
                if (pr) {
                    const authorName = pr.createdBy?.displayName || 'Unknown Author';
                    if (!peopleMap.has(authorName)) {
                        peopleMap.set(authorName, []);
                    }
                    peopleMap.get(authorName)!.push(pr);
                }
            }

            const items: PRTreeItem[] = [];
            for (const [personName, prs] of peopleMap) {
                const prCount = prs.length;
                const pendingCount = prs.filter(pr => this.isPendingMyReview(pr.pullRequestId)).length;
                const reviewedCount = prs.filter(pr => this.isReviewedByMe(pr.pullRequestId)).length;
                
                let label = `${personName} (${prCount})`;
                if (pendingCount > 0 || reviewedCount > 0) {
                    const counts = [];
                    if (pendingCount > 0) counts.push(`⏳${pendingCount}`);
                    if (reviewedCount > 0) counts.push(`✓${reviewedCount}`);
                    label = `${personName} (${prCount}) [${counts.join(' ')}]`;
                }
                
                items.push(new PRTreeItem(
                    label,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'personGroup',
                    undefined,
                    undefined,
                    undefined,
                    personName,
                    false,
                    false,
                    element.manualGroupId
                ));
            }

            items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
            return items;
        } else if (element.type === 'ungroupedFolder') {
            // Ungrouped folder - show people groups
            const ungrouped = this.getUngroupedPRsByPeople();
            const items: PRTreeItem[] = [];

            for (const [personName, prs] of ungrouped) {
                const prCount = prs.length;
                const pendingCount = prs.filter(pr => this.isPendingMyReview(pr.pullRequestId)).length;
                const reviewedCount = prs.filter(pr => this.isReviewedByMe(pr.pullRequestId)).length;
                
                let label = `${personName} (${prCount})`;
                if (pendingCount > 0 || reviewedCount > 0) {
                    const counts = [];
                    if (pendingCount > 0) counts.push(`⏳${pendingCount}`);
                    if (reviewedCount > 0) counts.push(`✓${reviewedCount}`);
                    label = `${personName} (${prCount}) [${counts.join(' ')}]`;
                }
                
                items.push(new PRTreeItem(
                    label,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'personGroup',
                    undefined,
                    'ungrouped',
                    undefined,
                    personName
                ));
            }

            items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
            return items;
        } else if (element.type === 'personGroup' && this.groupingMode === 'manual') {
            // In manual mode: show PRs for this person in their group
            let prs: PullRequest[] = [];
            
            if (element.manualGroupId && element.manualGroupId !== 'ungrouped') {
                const group = this.manualGroups.get(element.manualGroupId);
                if (group) {
                    prs = this.pullRequests.filter(pr => 
                        group.prIds.includes(pr.pullRequestId) && 
                        (pr.createdBy?.displayName || 'Unknown Author') === element.personName
                    );
                }
            } else if (element.groupKey === 'ungrouped') {
                const ungrouped = this.getUngroupedPRsByPeople();
                prs = ungrouped.get(element.personName!) || [];
            }

            return prs.map(pr => 
                new PRTreeItem(
                    `#${pr.pullRequestId}: ${pr.title}`,
                    vscode.TreeItemCollapsibleState.Collapsed,
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
            // Show work items under the PR (works in all grouping modes)
            const workItems: PRTreeItem[] = [];
            
            // Check if debug logging is enabled
            const config = vscode.workspace.getConfiguration('azureDevOpsPR');
            const debugEnabled = config.get<boolean>('debugWorkItemDisplay', false);
            
            try {
                if (debugEnabled) {
                    console.log(`[WorkItemDisplay] Fetching work items for PR #${element.pr.pullRequestId} in ${this.groupingMode} mode`);
                }
                const workItemRefs = await this.azureDevOpsService.getWorkItemsForPR(element.pr.pullRequestId);
                
                if (workItemRefs && workItemRefs.length > 0) {
                    if (debugEnabled) {
                        console.log(`[WorkItemDisplay] Found ${workItemRefs.length} work item(s) for PR #${element.pr.pullRequestId}`);
                    }
                    for (const workItemRef of workItemRefs) {
                        const workItemId = parseInt(workItemRef.id);
                        const workItemDetails = await this.azureDevOpsService.getWorkItemDetails(workItemId);
                        
                        if (workItemDetails) {
                            const assignedTo = workItemDetails.assignedTo || 'Unassigned';
                            const label = `#${workItemDetails.id}: ${workItemDetails.title}`;
                            
                            if (debugEnabled) {
                                console.log(`[WorkItemDisplay] Adding work item #${workItemDetails.id} to PR #${element.pr.pullRequestId}`);
                            }
                            workItems.push(new PRTreeItem(
                                label,
                                vscode.TreeItemCollapsibleState.None,
                                'workItem',
                                undefined,
                                undefined,
                                workItemDetails.id,
                                undefined,
                                false,
                                false,
                                undefined,
                                workItemDetails.workItemType,
                                assignedTo,
                                workItemDetails.state
                            ));
                        }
                    }
                } else if (debugEnabled) {
                    console.log(`[WorkItemDisplay] No work items found for PR #${element.pr.pullRequestId}`);
                }
            } catch (error) {
                console.error(`[WorkItemDisplay] Failed to get work items for PR ${element.pr.pullRequestId}:`, error);
            }
            
            if (debugEnabled) {
                console.log(`[WorkItemDisplay] Returning ${workItems.length} work item(s) for PR #${element.pr.pullRequestId}`);
            }
            return workItems;
        }

        return [];
    }
}

export class PRTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'workItemGroup' | 'personGroup' | 'pullRequest' | 'manualFolder' | 'ungroupedFolder' | 'workItem',
        public readonly pr?: PullRequest,
        public readonly groupKey?: string,
        public readonly workItemId?: number,
        public readonly personName?: string,
        isPendingMyReview?: boolean,
        isReviewedByMe?: boolean,
        public readonly manualGroupId?: string,
        public readonly workItemType?: string,
        public readonly workItemAssignedTo?: string,
        public readonly workItemState?: string
    ) {
        super(label, collapsibleState);

        if (type === 'workItem') {
            this.iconPath = new vscode.ThemeIcon('checklist', new vscode.ThemeColor('terminal.ansiCyan'));
            this.contextValue = 'workItem';
            
            // Build detailed tooltip
            const tooltipParts = [
                `Work Item #${workItemId}`,
                `Type: ${workItemType || 'Unknown'}`,
                `State: ${workItemState || 'Unknown'}`,
                `Assigned To: ${workItemAssignedTo || 'Unassigned'}`
            ];
            this.tooltip = tooltipParts.join('\n');
            
            // Show assigned person and state in description
            this.description = `${workItemAssignedTo || 'Unassigned'} • ${workItemState || 'Unknown'}`;
        } else if (type === 'workItemGroup') {
            this.iconPath = new vscode.ThemeIcon('issues', new vscode.ThemeColor('terminal.ansiBlue'));
            this.contextValue = 'workItemGroup';
            this.tooltip = `Work Item: ${label}`;
        } else if (type === 'manualFolder') {
            this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('terminal.ansiMagenta'));
            this.contextValue = 'manualFolder';
            this.tooltip = `Manual Group: ${label}`;
        } else if (type === 'ungroupedFolder') {
            this.iconPath = new vscode.ThemeIcon('inbox', new vscode.ThemeColor('terminal.ansiCyan'));
            this.contextValue = 'ungroupedFolder';
            this.tooltip = `Unassigned PRs: ${label}`;
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
            
            // Show review indicators on the LEFT side (before the PR text)
            const prefix = [];
            if (isPendingMyReview) prefix.push('⏳');
            if (isReviewedByMe) prefix.push('✓');
            if (prefix.length > 0) {
                this.label = `${prefix.join(' ')} ${label}`;
            }
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
