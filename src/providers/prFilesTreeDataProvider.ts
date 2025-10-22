import * as vscode from 'vscode';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { PullRequest, PRFile } from '../types';

export class PRFilesTreeDataProvider implements vscode.TreeDataProvider<PRFileTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PRFileTreeItem | undefined | null | void> = new vscode.EventEmitter<PRFileTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PRFileTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private currentPR?: PullRequest;
    private files: PRFile[] = [];

    constructor(private azureDevOpsService: AzureDevOpsService) {}

    async loadPR(pr: PullRequest): Promise<void> {
        try {
            this.currentPR = pr;
            this.files = await this.azureDevOpsService.getPRFiles(pr.pullRequestId);
            this._onDidChangeTreeData.fire();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load PR files: ${error}`);
            this.files = [];
            this._onDidChangeTreeData.fire();
        }
    }

    async refresh(): Promise<void> {
        if (this.currentPR) {
            await this.loadPR(this.currentPR);
        }
    }

    getTreeItem(element: PRFileTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PRFileTreeItem): Promise<PRFileTreeItem[]> {
        if (!this.currentPR) {
            return [];
        }

        if (!element) {
            // Root level - organize files by directory structure
            return this.organizeFilesByDirectory(this.files);
        }

        // If element is a directory, show its files
        if (element.childFiles) {
            return element.childFiles
                .filter(file => file.path)
                .map(file => 
                    new PRFileTreeItem(
                        this.currentPR!,
                        file,
                        file.path?.split('/').pop() || 'Unknown',
                        vscode.TreeItemCollapsibleState.Collapsed
                    )
                );
        }

        // If element is a file, show its details (changes and comments)
        if (element.file) {
            return this.getFileDetails(element);
        }

        // If element is "Line Changes" section, show individual changes
        if (element.itemType === 'changes' && element.changes) {
            return element.changes.map(change => 
                new PRFileTreeItem(
                    this.currentPR!,
                    undefined,
                    `Line ${change.line}: ${change.content}`,
                    vscode.TreeItemCollapsibleState.None,
                    change.type === 'add' ? 'add' : change.type === 'delete' ? 'remove' : 'edit',
                    undefined,
                    undefined,
                    undefined,
                    change
                )
            );
        }

        // If element is "Comments" section, show authors
        if (element.itemType === 'comments' && element.commentsByAuthor) {
            return element.commentsByAuthor.map(([author, comments]) =>
                new PRFileTreeItem(
                    this.currentPR!,
                    undefined,
                    `👤 ${author} (${comments.length})`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'person',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    comments
                )
            );
        }

        // If element is an author, show their comments
        if (element.itemType === 'author' && element.authorComments) {
            return element.authorComments.map((comment, index) =>
                new PRFileTreeItem(
                    this.currentPR!,
                    undefined,
                    comment.content || `Comment #${index + 1}`,
                    vscode.TreeItemCollapsibleState.None,
                    'comment',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    comment
                )
            );
        }

        return [];
    }

    private async getFileDetails(fileItem: PRFileTreeItem): Promise<PRFileTreeItem[]> {
        const items: PRFileTreeItem[] = [];

        try {
            // Add "Line Changes" section - will show mock data for now
            // Real implementation would parse diff hunks from Azure DevOps API
            const mockChanges = [
                { line: 10, type: 'add', content: '+ Added new function', filePath: fileItem.file!.path },
                { line: 25, type: 'edit', content: '~ Modified logic', filePath: fileItem.file!.path },
                { line: 42, type: 'delete', content: '- Removed old code', filePath: fileItem.file!.path }
            ];

            items.push(new PRFileTreeItem(
                this.currentPR!,
                undefined,
                `📝 Line Changes (${mockChanges.length})`,
                vscode.TreeItemCollapsibleState.Collapsed,
                'diff',
                undefined,
                mockChanges
            ));

            // Add "Comments" section - get from PR threads
            try {
                const threads = await this.azureDevOpsService.getPRThreads(this.currentPR!.pullRequestId);
                const fileThreads = threads.filter((thread: any) => 
                    thread.threadContext?.filePath === fileItem.file!.path
                );

                if (fileThreads.length > 0) {
                    // Extract all comments from threads and group by author
                    const commentsByAuthor = new Map<string, any[]>();
                    for (const thread of fileThreads) {
                        if (thread.comments) {
                            for (const comment of thread.comments) {
                                const author = comment.author?.displayName || 'Unknown';
                                if (!commentsByAuthor.has(author)) {
                                    commentsByAuthor.set(author, []);
                                }
                                commentsByAuthor.get(author)!.push({
                                    ...comment,
                                    thread: thread,
                                    filePath: fileItem.file!.path
                                });
                            }
                        }
                    }

                    const totalComments = Array.from(commentsByAuthor.values())
                        .reduce((sum, comments) => sum + comments.length, 0);

                    items.push(new PRFileTreeItem(
                        this.currentPR!,
                        undefined,
                        `💬 Comments (${totalComments})`,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'comment',
                        undefined,
                        undefined,
                        Array.from(commentsByAuthor.entries())
                    ));
                }
            } catch (commentError) {
                console.error('Failed to load comments:', commentError);
            }
        } catch (error) {
            console.error('Failed to load file details:', error);
        }

        return items;
    }

    private organizeFilesByDirectory(files: PRFile[]): PRFileTreeItem[] {
        // Group files by their top-level directory
        const grouped = new Map<string, PRFile[]>();
        const rootFiles: PRFile[] = [];

        for (const file of files) {
            // Skip files with null or undefined path
            if (!file.path) {
                console.warn('Skipping file with null/undefined path:', file);
                continue;
            }

            const parts = file.path.split('/');
            if (parts.length === 1) {
                rootFiles.push(file);
            } else {
                const topDir = parts[0];
                if (!grouped.has(topDir)) {
                    grouped.set(topDir, []);
                }
                grouped.get(topDir)!.push(file);
            }
        }

        const items: PRFileTreeItem[] = [];

        // Add directories
        for (const [dir, dirFiles] of grouped) {
            items.push(new PRFileTreeItem(
                this.currentPR!,
                undefined,
                dir,
                vscode.TreeItemCollapsibleState.Collapsed,
                'folder',
                dirFiles
            ));
        }

        // Add root files
        for (const file of rootFiles) {
            items.push(new PRFileTreeItem(
                this.currentPR!,
                file,
                this.getFileName(file.path),
                vscode.TreeItemCollapsibleState.None
            ));
        }

        return items;
    }

    private getFileName(path: string): string {
        if (!path) {
            return 'Unknown';
        }
        const parts = path.split('/');
        return parts[parts.length - 1];
    }
}

export class PRFileTreeItem extends vscode.TreeItem {
    public readonly childFiles?: PRFile[];
    public readonly changes?: any[];
    public readonly commentsByAuthor?: [string, any[]][];
    public readonly change?: any;
    public readonly authorComments?: any[];
    public readonly comment?: any;
    public readonly itemType: 'directory' | 'file' | 'changes' | 'comments' | 'change' | 'author';

    constructor(
        public readonly pr: PullRequest,
        public readonly file?: PRFile,
        label?: string,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        private iconId?: string,
        childFiles?: PRFile[],
        changes?: any[],
        commentsByAuthor?: [string, any[]][], 
        change?: any,
        authorComments?: any[],
        comment?: any
    ) {
        super(label || (file ? file.path : 'Unknown'), collapsibleState);

        this.childFiles = childFiles;
        this.changes = changes;
        this.commentsByAuthor = commentsByAuthor;
        this.change = change;
        this.authorComments = authorComments;
        this.comment = comment;

        // Determine item type
        if (comment) {
            this.itemType = 'change'; // Individual comment
            this.contextValue = 'prComment';
        } else if (authorComments) {
            this.itemType = 'author'; // Author group
            this.contextValue = 'prCommentAuthor';
        } else if (change) {
            this.itemType = 'change'; // Individual line change
            this.contextValue = 'prLineChange';
        } else if (changes) {
            this.itemType = 'changes'; // Line changes section
            this.contextValue = 'prFileChanges';
        } else if (commentsByAuthor) {
            this.itemType = 'comments'; // Comments section
            this.contextValue = 'prFileComments';
        } else if (childFiles) {
            this.itemType = 'directory';
            this.contextValue = 'prDirectory';
        } else if (file) {
            this.itemType = 'file';
            this.contextValue = 'prFile';
        } else {
            this.itemType = 'directory';
            this.contextValue = 'prDirectory';
        }

        // Add command for line changes to jump to line
        if (change && change.filePath) {
            this.command = {
                command: 'azureDevOpsPR.jumpToLine',
                title: 'Jump to Line',
                arguments: [change.filePath, change.line]
            };
            this.tooltip = `Click to jump to line ${change.line}`;
        }

        // Add command for comments to show comment details
        if (comment) {
            this.tooltip = `${comment.author?.displayName || 'Unknown'}: ${comment.content}`;
        }

        if (file) {
            this.tooltip = `${file.path} (${this.getChangeTypeText(file.changeType)})`;
            this.description = this.getChangeTypeText(file.changeType);
            
            // Set icon based on file type
            this.iconPath = this.getFileIcon(file);

            // Files are now expandable - remove direct command
            if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
                this.command = {
                    command: 'azureDevOpsPR.viewFile',
                    title: 'View File',
                    arguments: [this]
                };
            }
        } else {
            this.iconPath = new vscode.ThemeIcon(iconId || 'folder');
        }
    }

    private getFileIcon(file: PRFile): vscode.ThemeIcon {
        // Color code by change type
        let color: vscode.ThemeColor | undefined;
        
        switch (file.changeType?.toLowerCase()) {
            case 'add':
                color = new vscode.ThemeColor('gitDecoration.addedResourceForeground');
                break;
            case 'edit':
                color = new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
                break;
            case 'delete':
                color = new vscode.ThemeColor('gitDecoration.deletedResourceForeground');
                break;
        }

        const ext = file.path?.split('.').pop()?.toLowerCase();
        const iconMap: { [key: string]: string } = {
            'ts': 'file-code',
            'js': 'file-code',
            'py': 'file-code',
            'cs': 'file-code',
            'java': 'file-code',
            'json': 'json',
            'xml': 'file-code',
            'html': 'file-code',
            'css': 'file-code',
            'md': 'markdown',
            'yml': 'file-code',
            'yaml': 'file-code'
        };

        const iconId = iconMap[ext || ''] || 'file';
        return new vscode.ThemeIcon(iconId, color);
    }

    private getChangeTypeText(changeType: string): string {
        const typeMap: { [key: string]: string } = {
            'add': 'Added',
            'edit': 'Modified',
            'delete': 'Deleted',
            'rename': 'Renamed'
        };
        return typeMap[changeType.toLowerCase()] || changeType;
    }

    async getChildren(): Promise<PRFileTreeItem[]> {
        if (this.childFiles && this.childFiles.length > 0) {
            return this.childFiles
                .filter(file => file.path) // Skip files with null path
                .map(file => 
                    new PRFileTreeItem(
                        this.pr,
                        file,
                        file.path?.split('/').pop() || 'Unknown'
                    )
                );
        }
        return [];
    }
}
