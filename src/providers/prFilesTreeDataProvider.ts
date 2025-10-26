import * as vscode from 'vscode';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { PullRequest, PRFile } from '../types';

export class PRFilesTreeDataProvider implements vscode.TreeDataProvider<PRFileTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PRFileTreeItem | undefined | null | void> = new vscode.EventEmitter<PRFileTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PRFileTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private currentPR?: PullRequest;
    private files: PRFile[] = [];
    private commentCounts: Map<string, number> = new Map();
    private generalComments: any[] = [];

    constructor(private azureDevOpsService: AzureDevOpsService) {}

    async loadPR(pr: PullRequest): Promise<void> {
        try {
            this.currentPR = pr;
            this.files = await this.azureDevOpsService.getPRFiles(pr.pullRequestId);
            
            // Load general comments (comments without valid file paths)
            try {
                const threads = await this.azureDevOpsService.getPRThreads(pr.pullRequestId);
                this.generalComments = threads
                    .filter((thread: any) => {
                        // A thread is "general" only if it has NO threadContext at all,
                        // or if threadContext exists but filePath is explicitly null/undefined/empty
                        const hasNoContext = !thread.threadContext;
                        const hasEmptyFilePath = thread.threadContext && 
                            (!thread.threadContext.filePath || thread.threadContext.filePath.trim() === '');
                        
                        console.log(`[GeneralComments] Thread ${thread.id}: hasNoContext=${hasNoContext}, hasEmptyFilePath=${hasEmptyFilePath}, filePath="${thread.threadContext?.filePath || 'none'}"`);
                        
                        return hasNoContext || hasEmptyFilePath;
                    })
                    .flatMap((thread: any) => 
                        thread.comments.map((comment: any) => ({
                            ...comment,
                            thread: thread
                        }))
                    );
                    
                console.log(`[GeneralComments] Found ${this.generalComments.length} general comments`);
            } catch (commentError) {
                console.error('Failed to load general comments:', commentError);
                this.generalComments = [];
            }
            
            this._onDidChangeTreeData.fire();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load PR files: ${error}`);
            this.files = [];
            this.generalComments = [];
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
            // Root level - show PR info as single root item
            const prInfoLabel = `PR #${this.currentPR.pullRequestId}: ${this.currentPR.title}`;
            return [new PRFileTreeItem(
                this.currentPR,
                undefined,
                prInfoLabel,
                vscode.TreeItemCollapsibleState.Expanded,
                'info',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                true // isPRInfo flag
            )];
        }
        
        // Handle PR info expansion to show details + files
        if (element.isPRInfo && this.currentPR) {
            const items: PRFileTreeItem[] = [];
            
            // Add PR metadata
            items.push(...this.getPRInfoDetails());
            
            // Add files structure
            items.push(...this.organizeFilesByDirectory(this.files));
            
            return items;
        }

        // If element is a directory, show its files organized by subdirectory
        if (element.childFiles) {
            // Get the directory name from the element label
            const dirName = element.label as string;
            
            // Organize files within this directory
            return this.organizeFilesInDirectory(element.childFiles, dirName);
        }

        // If element is a file with no comment, it's a leaf node
        if (element.file && !element.comment) {
            return [];
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

    private getPRInfoDetails(): PRFileTreeItem[] {
        if (!this.currentPR) {
            return [];
        }

        const items: PRFileTreeItem[] = [];
        const pr = this.currentPR;

        // Author
        items.push(new PRFileTreeItem(
            pr,
            undefined,
            `Author: ${pr.createdBy?.displayName || 'Unknown'}`,
            vscode.TreeItemCollapsibleState.None,
            'person'
        ));

        // Branches
        const sourceBranch = pr.sourceRefName.replace('refs/heads/', '');
        const targetBranch = pr.targetRefName.replace('refs/heads/', '');
        items.push(new PRFileTreeItem(
            pr,
            undefined,
            `Branch: ${sourceBranch} → ${targetBranch}`,
            vscode.TreeItemCollapsibleState.None,
            'git-branch'
        ));

        // Status
        const status = pr.isDraft ? 'Draft' : 
                      pr.status === 1 || pr.status === 'active' ? 'Active' :
                      pr.status === 3 || pr.status === 'completed' ? 'Completed' :
                      pr.status === 2 || pr.status === 'abandoned' ? 'Abandoned' : 'Unknown';
        items.push(new PRFileTreeItem(
            pr,
            undefined,
            `Status: ${status}`,
            vscode.TreeItemCollapsibleState.None,
            'info'
        ));

        // File count
        items.push(new PRFileTreeItem(
            pr,
            undefined,
            `Files Changed: ${this.files.length}`,
            vscode.TreeItemCollapsibleState.None,
            'files'
        ));

        // General comments (comments not tied to specific files)
        if (this.generalComments.length > 0) {
            // Group by author
            const commentsByAuthor = new Map<string, any[]>();
            for (const comment of this.generalComments) {
                const author = comment.author?.displayName || 'Unknown';
                if (!commentsByAuthor.has(author)) {
                    commentsByAuthor.set(author, []);
                }
                commentsByAuthor.get(author)!.push(comment);
            }

            items.push(new PRFileTreeItem(
                pr,
                undefined,
                `💬 General Comments (${this.generalComments.length})`,
                vscode.TreeItemCollapsibleState.Collapsed,
                'comment',
                undefined,
                undefined,
                Array.from(commentsByAuthor.entries())
            ));
        }

        return items;
    }

    private async getFileDetails(fileItem: PRFileTreeItem): Promise<PRFileTreeItem[]> {
        const items: PRFileTreeItem[] = [];

        try {
            // Add "Comments" section only - get from PR threads
            // Line changes are better viewed in the diff editor itself
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

            // Normalize path (remove leading slashes)
            const normalizedPath = file.path.startsWith('/') ? file.path.substring(1) : file.path;
            const parts = normalizedPath.split('/').filter(p => p.length > 0);
            
            if (parts.length === 0) {
                console.warn('Skipping file with empty path after normalization:', file);
                continue;
            }
            
            if (parts.length === 1) {
                rootFiles.push(file);
            } else {
                const topDir = parts[0];
                if (topDir && topDir !== '') {
                    if (!grouped.has(topDir)) {
                        grouped.set(topDir, []);
                    }
                    grouped.get(topDir)!.push(file);
                } else {
                    // If topDir is empty, treat as root file
                    rootFiles.push(file);
                }
            }
        }

        const items: PRFileTreeItem[] = [];

        // Add directories (sorted alphabetically)
        const sortedDirs = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [dir, dirFiles] of sortedDirs) {
            items.push(new PRFileTreeItem(
                this.currentPR!,
                undefined,
                dir,
                vscode.TreeItemCollapsibleState.Collapsed,
                'folder',
                dirFiles
            ));
        }

        // Add root files (sorted alphabetically)
        const sortedRootFiles = rootFiles.sort((a, b) => 
            (a.path || '').localeCompare(b.path || '')
        );
        for (const file of sortedRootFiles) {
            items.push(new PRFileTreeItem(
                this.currentPR!,
                file,
                this.getFileName(file.path),
                vscode.TreeItemCollapsibleState.Collapsed
            ));
        }

        return items;
    }

    private organizeFilesInDirectory(files: PRFile[], parentDir: string): PRFileTreeItem[] {
        // Group files by subdirectory within the parent directory
        const grouped = new Map<string, PRFile[]>();
        const directFiles: PRFile[] = [];

        for (const file of files) {
            if (!file.path) {
                continue;
            }

            // Normalize and get path relative to parent directory
            const normalizedPath = file.path.startsWith('/') ? file.path.substring(1) : file.path;
            const parts = normalizedPath.split('/').filter(p => p.length > 0);
            
            // Find where this file sits relative to parent directory
            const parentDirIndex = parts.indexOf(parentDir);
            if (parentDirIndex === -1) {
                // File doesn't belong to this directory
                continue;
            }

            const remainingParts = parts.slice(parentDirIndex + 1);
            
            if (remainingParts.length === 1) {
                // Direct file in this directory
                directFiles.push(file);
            } else if (remainingParts.length > 1) {
                // File in subdirectory
                const subDir = remainingParts[0];
                if (!grouped.has(subDir)) {
                    grouped.set(subDir, []);
                }
                grouped.get(subDir)!.push(file);
            }
        }

        const items: PRFileTreeItem[] = [];

        // Add subdirectories (sorted alphabetically)
        const sortedSubDirs = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [subDir, subDirFiles] of sortedSubDirs) {
            items.push(new PRFileTreeItem(
                this.currentPR!,
                undefined,
                subDir,
                vscode.TreeItemCollapsibleState.Collapsed,
                'folder',
                subDirFiles
            ));
        }

        // Add direct files (sorted alphabetically)
        const sortedFiles = directFiles.sort((a, b) => 
            (a.path || '').localeCompare(b.path || '')
        );
        for (const file of sortedFiles) {
            items.push(new PRFileTreeItem(
                this.currentPR!,
                file,
                this.getFileName(file.path),
                vscode.TreeItemCollapsibleState.Collapsed
            ));
        }

        return items;
    }

    private getFileName(path: string): string {
        if (!path) {
            return 'Unknown';
        }
        const parts = path.split('/');
        return parts[parts.length - 1] || 'Unknown';
    }

    private async getFileCommits(fileItem: PRFileTreeItem): Promise<PRFileTreeItem[]> {
        try {
            // Get Git extension
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                console.error('Git extension not available');
                return [];
            }

            const git = gitExtension.exports.getAPI(1);
            const repo = git.repositories[0];
            
            if (!repo) {
                console.error('No git repository found');
                return [];
            }

            // Get PR branch names
            const sourceBranch = this.currentPR!.sourceRefName.replace('refs/heads/', '');
            const targetBranch = this.currentPR!.targetRefName.replace('refs/heads/', '');

            // Normalize file path
            const gitRoot = repo.rootUri;
            let normalizedPath = fileItem.file!.path.startsWith('/') 
                ? fileItem.file!.path.substring(1) 
                : fileItem.file!.path;
            
            // Remove repo name if present
            const gitRootName = gitRoot.path.split('/').pop();
            if (gitRootName && normalizedPath.startsWith(gitRootName + '/')) {
                normalizedPath = normalizedPath.substring(gitRootName.length + 1);
            }

            // Get commits between target and source branch that modified this file
            // Use git log command: git log target..source -- <file>
            const logArgs = [
                'log',
                `origin/${targetBranch}..${sourceBranch}`,
                '--pretty=format:%H|%an|%ae|%aI|%s',
                '--',
                normalizedPath
            ];

            // Execute git log command
            console.log('[PR Files] Executing git log with args:', logArgs);
            const result = await repo.exec(logArgs);
            
            console.log('[PR Files] Git log result:', {
                exitCode: result.exitCode,
                stdout: result.stdout?.substring(0, 200), // First 200 chars
                stderr: result.stderr
            });
            
            if (!result.stdout || result.stdout.trim().length === 0) {
                console.log('[PR Files] No commits found for file:', normalizedPath);
                // Return a message item if no commits found
                return [
                    new PRFileTreeItem(
                        this.currentPR!,
                        undefined,
                        'No commits found for this file in this PR',
                        vscode.TreeItemCollapsibleState.None,
                        'info'
                    )
                ];
            }

            // Parse commit log output
            const lines = result.stdout.trim().split('\n').filter((line: string) => line.length > 0);
            console.log('[PR Files] Found', lines.length, 'commits for', normalizedPath);
            const fileCommits = lines.map((line: string) => {
                const [commitId, authorName, authorEmail, date, ...messageParts] = line.split('|');
                return {
                    commitId,
                    author: {
                        name: authorName,
                        email: authorEmail,
                        date: date
                    },
                    comment: messageParts.join('|'), // Rejoin in case message contained |
                    parents: [] // Will be populated if needed
                };
            });

            // Already sorted chronologically (newest first) by git log
            
            return fileCommits.map((commit: any) => 
                new PRFileTreeItem(
                    this.currentPR!,
                    fileItem.file,
                    undefined,
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    commit
                )
            );
        } catch (error) {
            console.error('Failed to load file commits from git:', error);
            return [];
        }
    }
}

export class PRFileTreeItem extends vscode.TreeItem {
    public readonly childFiles?: PRFile[];
    public readonly changes?: any[];
    public readonly commentsByAuthor?: [string, any[]][];
    public readonly change?: any;
    public readonly authorComments?: any[];
    public readonly comment?: any;
    public readonly commit?: any;
    public readonly isPRInfo?: boolean;
    public readonly itemType: 'directory' | 'file' | 'changes' | 'comments' | 'change' | 'author' | 'commit';

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
        comment?: any,
        commit?: any,
        isPRInfo?: boolean
    ) {
        super(label || (file ? file.path : 'Unknown'), collapsibleState);

        this.childFiles = childFiles;
        this.changes = changes;
        this.commentsByAuthor = commentsByAuthor;
        this.change = change;
        this.authorComments = authorComments;
        this.comment = comment;
        this.commit = commit;
        this.isPRInfo = isPRInfo;

        // Special handling for PR info header
        if (isPRInfo) {
            this.itemType = 'directory';
            this.contextValue = 'prInfo';
            this.iconPath = new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('terminal.ansiBlue'));
            this.tooltip = `Pull Request #${pr.pullRequestId}\n${pr.title}`;
            return;
        }

        // Determine item type
        if (commit) {
            // Commit item under a file
            this.itemType = 'commit';
            this.contextValue = 'prFileCommit';
            
            const shortHash = commit.commitId.substring(0, 7);
            const message = commit.comment.split('\n')[0];
            this.label = `${shortHash} ${message}`;
            this.description = this.formatTimeAgo(commit.author.date);
            this.iconPath = new vscode.ThemeIcon('git-commit');
            this.tooltip = `${commit.author.name}\n${new Date(commit.author.date).toLocaleString()}\n\n${commit.comment}`;
            
            // Command to view this commit's diff
            this.command = {
                command: 'azureDevOpsPR.viewFileCommitDiff',
                title: 'View Commit Diff',
                arguments: [this]
            };
        } else if (comment) {
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

            // Add double-click command to open diff
            this.command = {
                command: 'azureDevOpsPR.viewFile',
                title: 'View File Diff',
                arguments: [this]
            };
        } else {
            this.iconPath = new vscode.ThemeIcon(iconId || 'folder');
        }
    }

    private getFileIcon(file: PRFile): vscode.ThemeIcon {
        // Color code by change type
        let color: vscode.ThemeColor | undefined;
        
        if (file.changeType) {
            const changeType = typeof file.changeType === 'string'
                ? file.changeType.toLowerCase()
                : String(file.changeType || '').toLowerCase();
                
            switch (changeType) {
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
        if (!changeType) {
            return 'Unknown';
        }
        
        const typeMap: { [key: string]: string } = {
            'add': 'Added',
            'edit': 'Modified',
            'delete': 'Deleted',
            'rename': 'Renamed'
        };
        
        const normalizedType = typeof changeType === 'string'
            ? changeType.toLowerCase()
            : String(changeType || '').toLowerCase();
            
        return typeMap[normalizedType] || String(changeType);
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

    private formatTimeAgo(dateString: string): string {
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
