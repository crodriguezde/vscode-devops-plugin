import * as vscode from 'vscode';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { PullRequest } from '../types';

export class PRTreeDataProvider implements vscode.TreeDataProvider<PRTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PRTreeItem | undefined | null | void> = new vscode.EventEmitter<PRTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PRTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private pullRequests: PullRequest[] = [];

    constructor(private azureDevOpsService: AzureDevOpsService) {}

    async refresh(): Promise<void> {
        try {
            this.pullRequests = await this.azureDevOpsService.getPullRequests();
            this._onDidChangeTreeData.fire();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh PRs: ${error}`);
            this.pullRequests = [];
            this._onDidChangeTreeData.fire();
        }
    }

    getTreeItem(element: PRTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PRTreeItem): Promise<PRTreeItem[]> {
        if (!element) {
            // Root level - show all PRs
            return this.pullRequests.map(pr => new PRTreeItem(pr, vscode.TreeItemCollapsibleState.Collapsed));
        } else {
            // Child level - show PR details
            return this.getPRDetails(element.pr);
        }
    }

    private getPRDetails(pr: PullRequest): PRTreeItem[] {
        const items: PRTreeItem[] = [];

        // Author
        items.push(new PRTreeItem(
            pr,
            vscode.TreeItemCollapsibleState.None,
            `Author: ${pr.createdBy.displayName}`,
            'person'
        ));

        // Status
        items.push(new PRTreeItem(
            pr,
            vscode.TreeItemCollapsibleState.None,
            `Status: ${this.getStatusText(pr.status)}`,
            'info'
        ));

        // Source/Target branches
        items.push(new PRTreeItem(
            pr,
            vscode.TreeItemCollapsibleState.None,
            `${this.getBranchName(pr.sourceRefName)} → ${this.getBranchName(pr.targetRefName)}`,
            'git-branch'
        ));

        // Reviewers
        if (pr.reviewers && pr.reviewers.length > 0) {
            const reviewerText = pr.reviewers.map(r => 
                `${r.displayName} ${this.getVoteIcon(r.vote)}`
            ).join(', ');
            items.push(new PRTreeItem(
                pr,
                vscode.TreeItemCollapsibleState.None,
                `Reviewers: ${reviewerText}`,
                'organization'
            ));
        }

        return items;
    }

    private getBranchName(refName: string): string {
        return refName.replace('refs/heads/', '');
    }

    private getStatusText(status: string | number): string {
        // Azure DevOps returns status as a number:
        // 0 = notSet, 1 = active, 2 = abandoned, 3 = completed
        const statusMap: { [key: string]: string } = {
            '0': 'Not Set',
            '1': 'Active',
            '2': 'Abandoned',
            '3': 'Completed',
            'notset': 'Not Set',
            'active': 'Active',
            'completed': 'Completed',
            'abandoned': 'Abandoned'
        };
        
        // Handle both numeric and string status values
        const statusKey = typeof status === 'number' 
            ? status.toString() 
            : (status || '').toLowerCase();
        
        return statusMap[statusKey] || String(status);
    }

    private getVoteIcon(vote: number): string {
        if (vote === 10) return '✓'; // Approved
        if (vote === 5) return '✓-'; // Approved with suggestions
        if (vote === 0) return '○'; // No vote
        if (vote === -5) return '✕-'; // Waiting for author
        if (vote === -10) return '✕'; // Rejected
        return '?';
    }
}

export class PRTreeItem extends vscode.TreeItem {
    constructor(
        public readonly pr: PullRequest,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        label?: string,
        iconId?: string
    ) {
        // Add status badge to the label if it's a root PR item
        const displayLabel = label || `#${pr.pullRequestId} - ${pr.title} ${PRTreeItem.getStatusBadge(pr)}`;
        super(displayLabel, collapsibleState);
        
        this.tooltip = pr.description || pr.title;
        this.contextValue = 'pullRequest';
        
        if (iconId) {
            this.iconPath = new vscode.ThemeIcon(iconId);
        } else {
            // Icon based on PR status
            this.iconPath = PRTreeItem.getStatusIcon(pr);
        }

        // Add command to open PR when clicked
        if (!label) {
            this.command = {
                command: 'azureDevOpsPR.openPR',
                title: 'Open PR',
                arguments: [this]
            };
        }
    }

    private static getStatusBadge(pr: PullRequest): string {
        const status = typeof pr.status === 'number' 
            ? pr.status.toString() 
            : (pr.status || '').toLowerCase();

        // Status badges with colors (using Unicode and emojis)
        if (pr.isDraft) {
            return '📝 Draft';
        }
        
        switch (status) {
            case '1':
            case 'active':
                return '🟢 Active';
            case '3':
            case 'completed':
                return '✅ Merged';
            case '2':
            case 'abandoned':
                return '⛔ Abandoned';
            default:
                return '⚪ Unknown';
        }
    }

    private static getStatusIcon(pr: PullRequest): vscode.ThemeIcon {
        const status = typeof pr.status === 'number' 
            ? pr.status.toString() 
            : (pr.status || '').toLowerCase();

        if (pr.isDraft) {
            return new vscode.ThemeIcon('git-pull-request-draft', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
        }

        switch (status) {
            case '1':
            case 'active':
                return new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
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
