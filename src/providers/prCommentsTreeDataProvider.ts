import * as vscode from 'vscode';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { PullRequest, PRThread } from '../types';

export class PRCommentsTreeDataProvider implements vscode.TreeDataProvider<PRCommentTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PRCommentTreeItem | undefined | null | void> = new vscode.EventEmitter<PRCommentTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PRCommentTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private currentPR?: PullRequest;
    private threads: PRThread[] = [];
    private groupingMode: 'file' | 'people' = 'file';

    constructor(private azureDevOpsService: AzureDevOpsService) {}

    public toggleGrouping(): void {
        this.groupingMode = this.groupingMode === 'file' ? 'people' : 'file';
        this._onDidChangeTreeData.fire();
    }

    public getGroupingMode(): 'file' | 'people' {
        return this.groupingMode;
    }

    private getFileName(path: string): string {
        const parts = path.split('/');
        return parts[parts.length - 1];
    }

    async loadPR(pr: PullRequest): Promise<void> {
        try {
            this.currentPR = pr;
            const allThreads = await this.azureDevOpsService.getPRThreads(pr.pullRequestId);
            // Filter out general comments (those without file paths) - they're shown in PR Files view
            this.threads = allThreads.filter((thread: any) => thread.threadContext?.filePath);
            this._onDidChangeTreeData.fire();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load PR comments: ${error}`);
            this.threads = [];
            this._onDidChangeTreeData.fire();
        }
    }

    async refresh(): Promise<void> {
        if (this.currentPR) {
            await this.loadPR(this.currentPR);
        }
    }

    getTreeItem(element: PRCommentTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PRCommentTreeItem): Promise<PRCommentTreeItem[]> {
        if (!this.currentPR) {
            return [];
        }

        if (!element) {
            if (this.groupingMode === 'file') {
                // Group threads by file
                const threadsByFile = new Map<string, PRThread[]>();
                
                for (const thread of this.threads) {
                    const filePath = thread.threadContext?.filePath || 'Unknown';
                    if (!threadsByFile.has(filePath)) {
                        threadsByFile.set(filePath, []);
                    }
                    threadsByFile.get(filePath)!.push(thread);
                }
                
                // Create items for each file
                return Array.from(threadsByFile.entries()).map(([filePath, threads]) => {
                    const fileName = this.getFileName(filePath);
                    const commentCount = threads.reduce((sum, t) => sum + t.comments.length, 0);
                    
                    return new PRCommentTreeItem(
                        this.currentPR!,
                        undefined,
                        undefined,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        false,
                        fileName,
                        commentCount,
                        threads
                    );
                });
            } else {
                // Group threads by author (people view)
                const threadsByAuthor = new Map<string, PRThread[]>();
                
                for (const thread of this.threads) {
                    const author = thread.comments[0]?.author?.displayName || 'Unknown';
                    if (!threadsByAuthor.has(author)) {
                        threadsByAuthor.set(author, []);
                    }
                    threadsByAuthor.get(author)!.push(thread);
                }
                
                // Create items for each author
                return Array.from(threadsByAuthor.entries()).map(([author, threads]) => {
                    const commentCount = threads.reduce((sum, t) => sum + t.comments.length, 0);
                    
                    return new PRCommentTreeItem(
                        this.currentPR!,
                        undefined,
                        undefined,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        false,
                        author,
                        commentCount,
                        threads,
                        true // isPeopleGroup
                    );
                });
            }
        }
        
        // If element has threads, show them
        if (element.threads) {
            return element.threads.map(thread => 
                new PRCommentTreeItem(
                    this.currentPR!,
                    thread,
                    undefined,
                    vscode.TreeItemCollapsibleState.None,
                    true
                )
            );
        }

        // Don't show children - threads are not expandable
        return [];
    }
}

export class PRCommentTreeItem extends vscode.TreeItem {
    public readonly threads?: PRThread[];

    constructor(
        public readonly pr: PullRequest,
        public readonly thread?: PRThread,
        public readonly comment?: any,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        private isThreadRoot: boolean = false,
        fileName?: string,
        commentCount?: number,
        threads?: PRThread[],
        isPeopleGroup: boolean = false
    ) {
        super('', collapsibleState);

        this.threads = threads;

        // File group or People group item
        if (fileName && commentCount !== undefined && threads) {
            this.label = fileName;
            this.description = `${commentCount} comment${commentCount !== 1 ? 's' : ''}`;
            this.contextValue = isPeopleGroup ? 'prPeopleGroup' : 'prFileGroup';
            this.iconPath = isPeopleGroup ? new vscode.ThemeIcon('person') : new vscode.ThemeIcon('file');
            this.tooltip = `${fileName} - ${commentCount} comment${commentCount !== 1 ? 's' : ''}`;
            return;
        }

        if (isThreadRoot && thread) {
            // Thread root
            const firstComment = thread.comments[0];
            const fileName = thread.threadContext?.filePath 
                ? this.getFileName(thread.threadContext.filePath)
                : 'General';
            
            this.label = `${fileName}: ${this.truncateText(firstComment.content, 50)}`;
            // No tooltip - label already shows truncated comment text
            this.description = `${thread.comments.length} comment${thread.comments.length > 1 ? 's' : ''}`;
            this.contextValue = 'prThread';
            
            // Icon based on thread status
            this.iconPath = this.getThreadIcon(thread.status);
            
            // Add command to jump to comment location in diff
            if (thread.threadContext?.filePath && thread.threadContext?.rightFileStart) {
                this.command = {
                    command: 'azureDevOpsPR.jumpToCommentInDiff',
                    title: 'Jump to Comment',
                    arguments: [{
                        pr: pr,
                        filePath: thread.threadContext.filePath,
                        lineNumber: thread.threadContext.rightFileStart.line,
                        thread: thread
                    }]
                };
            }
        } else if (comment) {
            // Individual comment
            this.label = comment.author.displayName;
            this.description = this.truncateText(comment.content, 50);
            this.tooltip = `${comment.author.displayName}:\n${this.stripHtml(comment.content)}`;
            this.contextValue = 'prComment';
            this.iconPath = new vscode.ThemeIcon('comment');
            
            // Add command to jump to comment location in diff
            if (thread?.threadContext?.filePath && thread?.threadContext?.rightFileStart) {
                this.command = {
                    command: 'azureDevOpsPR.jumpToCommentInDiff',
                    title: 'Jump to Comment',
                    arguments: [{
                        pr: pr,
                        filePath: thread.threadContext.filePath,
                        lineNumber: thread.threadContext.rightFileStart.line,
                        thread: thread
                    }]
                };
            }
        }
    }

    private stripHtml(text: string): string {
        if (!text) {
            return '';
        }
        
        // Remove HTML tags and clean up whitespace
        return text
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private getFileName(path: string): string {
        const parts = path.split('/');
        return parts[parts.length - 1];
    }

    private truncateText(text: string, maxLength: number): string {
        if (!text) {
            return '';
        }

        // Check if text contains HTML
        const hasHtml = /<[^>]+>/.test(text);
        
        if (hasHtml) {
            // Strip HTML tags but preserve the text content
            const withoutTags = text.replace(/<[^>]+>/g, ' ');
            const cleaned = withoutTags.replace(/\s+/g, ' ').trim();
            
            if (cleaned.length <= maxLength) {
                return cleaned;
            }
            return cleaned.substring(0, maxLength) + '...';
        } else {
            // Plain text - remove markdown symbols
            const cleaned = text.replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim();
            if (cleaned.length <= maxLength) {
                return cleaned;
            }
            return cleaned.substring(0, maxLength) + '...';
        }
    }

    private getThreadIcon(status: string): vscode.ThemeIcon {
        switch (String(status || '').toLowerCase()) {
            case 'active':
                return new vscode.ThemeIcon('comment-discussion', 
                    new vscode.ThemeColor('list.warningForeground'));
            case 'fixed':
            case 'closed':
                return new vscode.ThemeIcon('pass', 
                    new vscode.ThemeColor('testing.iconPassed'));
            case 'wontfix':
                return new vscode.ThemeIcon('circle-slash');
            case 'pending':
                return new vscode.ThemeIcon('watch');
            default:
                return new vscode.ThemeIcon('comment-discussion');
        }
    }
}
