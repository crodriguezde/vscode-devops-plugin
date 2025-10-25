import * as vscode from 'vscode';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { PullRequest } from '../types';

interface GitCommit {
    commitId: string;
    author: {
        name: string;
        email: string;
        date: string;
    };
    comment: string;
    parents: string[];
}

export class PRCommitsTreeDataProvider implements vscode.TreeDataProvider<CommitTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CommitTreeItem | undefined | null | void> = new vscode.EventEmitter<CommitTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CommitTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private currentPR?: PullRequest;
    private commits: GitCommit[] = [];

    constructor(private azureDevOpsService: AzureDevOpsService) {}

    async loadPR(pr: PullRequest): Promise<void> {
        try {
            this.currentPR = pr;
            
            // Get commits for this PR from Azure DevOps
            this.commits = await this.azureDevOpsService.getPRCommits(pr.pullRequestId);
            
            // Sort commits chronologically (oldest first for graph visualization)
            this.commits.sort((a, b) => 
                new Date(a.author.date).getTime() - new Date(b.author.date).getTime()
            );
            
            this._onDidChangeTreeData.fire();
        } catch (error) {
            console.error('Failed to load PR commits:', error);
            vscode.window.showErrorMessage(`Failed to load PR commits: ${error}`);
            this.commits = [];
            this._onDidChangeTreeData.fire();
        }
    }

    async refresh(): Promise<void> {
        if (this.currentPR) {
            await this.loadPR(this.currentPR);
        }
    }

    getTreeItem(element: CommitTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: CommitTreeItem): Promise<CommitTreeItem[]> {
        if (!element) {
            // Root level - show commit graph
            return this.commits.map((commit, index) => {
                const isFirst = index === 0;
                const isLast = index === this.commits.length - 1;
                const previousCommit = index > 0 ? this.commits[index - 1] : undefined;
                const nextCommit = index < this.commits.length - 1 ? this.commits[index + 1] : undefined;
                
                return new CommitTreeItem(
                    this.currentPR!,
                    commit,
                    index,
                    this.commits.length,
                    previousCommit,
                    nextCommit
                );
            });
        }
        
        return [];
    }

    getCommits(): GitCommit[] {
        return this.commits;
    }

    getCurrentPR(): PullRequest | undefined {
        return this.currentPR;
    }
}

export class CommitTreeItem extends vscode.TreeItem {
    constructor(
        public readonly pr: PullRequest,
        public readonly commit: GitCommit,
        public readonly index: number,
        public readonly totalCommits: number,
        public readonly previousCommit: GitCommit | undefined,
        public readonly nextCommit: GitCommit | undefined
    ) {
        const shortHash = commit.commitId.substring(0, 7);
        const message = commit.comment.split('\n')[0]; // First line only
        const displayLabel = `${shortHash} ${message}`;
        
        super(displayLabel, vscode.TreeItemCollapsibleState.None);
        
        // Create description with graph visualization
        const graphSymbol = index === totalCommits - 1 ? '●' : '◯';
        const author = commit.author.name.split(' ')[0]; // First name only
        const timeAgo = this.getTimeAgo(commit.author.date);
        
        this.description = `${graphSymbol} ${author} • ${timeAgo}`;
        
        // Detailed tooltip
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`### Commit ${shortHash}\n\n`);
        this.tooltip.appendMarkdown(`**Message:** ${commit.comment}\n\n`);
        this.tooltip.appendMarkdown(`**Author:** ${commit.author.name} <${commit.author.email}>\n\n`);
        this.tooltip.appendMarkdown(`**Date:** ${new Date(commit.author.date).toLocaleString()}\n\n`);
        this.tooltip.appendMarkdown(`---\n\n`);
        this.tooltip.appendMarkdown(`*Click to view changes in this commit*`);
        
        // Icon with color based on position
        if (index === totalCommits - 1) {
            // Latest commit - filled circle
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('terminal.ansiGreen'));
        } else {
            // Older commits - empty circle
            this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
        }
        
        // Context value for commands
        this.contextValue = 'prCommit';
        
        // Command to view commit diff
        this.command = {
            command: 'azureDevOpsPR.viewCommitDiff',
            title: 'View Commit Changes',
            arguments: [this]
        };
    }

    private getTimeAgo(dateString: string): string {
        const date = new Date(dateString);
        const now = new Date();
        const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
        
        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d ago`;
        const months = Math.floor(days / 30);
        if (months < 12) return `${months}mo ago`;
        const years = Math.floor(months / 12);
        return `${years}y ago`;
    }
}
