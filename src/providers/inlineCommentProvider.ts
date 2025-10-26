import * as vscode from 'vscode';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { CommentThread, InlineComment, CommentDecoration } from '../types/commentTypes';
import { PullRequest, PRThread } from '../types';

export class InlineCommentProvider implements vscode.Disposable {
    private decorationType: vscode.TextEditorDecorationType;
    private commentThreads: Map<string, CommentThread[]> = new Map();
    private activeDecorations: Map<string, CommentDecoration[]> = new Map();
    private disposables: vscode.Disposable[] = [];
    private currentPR: PullRequest | null = null;

    constructor(private azureDevOpsService: AzureDevOpsService) {
        // Create decoration type for comment indicators with click support
        this.decorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: vscode.Uri.parse('data:image/svg+xml,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
                    <circle cx="8" cy="8" r="7" fill="#0078d4" stroke="#fff" stroke-width="1"/>
                    <text x="8" y="12" text-anchor="middle" font-size="10" fill="#fff" font-family="Arial">💬</text>
                </svg>
            `)),
            gutterIconSize: 'contain',
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.commentForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            isWholeLine: true,
            backgroundColor: new vscode.ThemeColor('editor.lineHighlightBackground'),
            cursor: 'pointer'
        });

        // Register event listeners
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) {
                    this.updateDecorations(editor);
                }
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                const editor = vscode.window.activeTextEditor;
                if (editor && event.document === editor.document) {
                    this.updateDecorations(editor);
                }
            }),
            vscode.window.onDidChangeTextEditorSelection(event => {
                // Handle click on comment decoration
                this.handleSelection(event);
            })
        );
    }

    private async handleSelection(event: vscode.TextEditorSelectionChangeEvent): Promise<void> {
        const editor = event.textEditor;
        const selection = event.selections[0];
        
        if (!selection || !selection.isEmpty) {
            return; // Only handle single cursor clicks
        }
        
        const line = selection.active.line + 1; // Convert to 1-based
        const documentPath = this.getRelativeFilePath(editor.document.uri);
        const thread = this.getThreadAtLine(documentPath, line);
        
        if (thread && this.currentPR) {
            // Found a comment thread at this line - open Comment Chat
            await vscode.commands.executeCommand('azureDevOpsPR.openCommentChat', {
                pr: this.currentPR,
                thread: thread,
                filePath: documentPath,
                lineNumber: line
            });
        }
    }

    public async loadCommentsForPR(pr: PullRequest): Promise<void> {
        this.currentPR = pr;
        
        try {
            const threads = await this.azureDevOpsService.getPRThreads(pr.pullRequestId);
            this.commentThreads.clear();
            
            // Group threads by file path
            for (const thread of threads) {
                if (thread.threadContext?.filePath) {
                    const filePath = this.normalizeFilePath(thread.threadContext.filePath);
                    const commentThread = this.convertToCommentThread(thread);
                    
                    if (!this.commentThreads.has(filePath)) {
                        this.commentThreads.set(filePath, []);
                    }
                    this.commentThreads.get(filePath)!.push(commentThread);
                }
            }
            
            // Update decorations for active editor
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                this.updateDecorations(activeEditor);
            }
        } catch (error) {
            console.error('Failed to load comments:', error);
            vscode.window.showErrorMessage(`Failed to load PR comments: ${error}`);
        }
    }

    private convertToCommentThread(thread: PRThread): CommentThread {
        const comments: InlineComment[] = thread.comments.map(comment => ({
            id: comment.id,
            threadId: thread.id,
            content: comment.content,
            author: {
                displayName: comment.author.displayName,
                uniqueName: comment.author.uniqueName
            },
            publishedDate: comment.publishedDate,
            filePath: thread.threadContext?.filePath || '',
            lineNumber: thread.threadContext?.rightFileStart?.line || 0,
            isResolved: thread.status === 'fixed' || thread.status === 'closed',
            commentType: comment.commentType === '1' ? 'text' : 'system'
        }));

        const isResolved = thread.status === 'fixed' || thread.status === 'closed';
        
        return {
            id: thread.id,
            comments,
            status: thread.status as any,
            filePath: thread.threadContext?.filePath || '',
            lineStart: thread.threadContext?.rightFileStart?.line || 0,
            lineEnd: thread.threadContext?.rightFileEnd?.line || 0,
            isResolved
        };
    }

    private normalizeFilePath(filePath: string): string {
        // Remove leading slash if present
        let normalized = filePath.startsWith('/') ? filePath.substring(1) : filePath;
        
        // Remove repository folder prefix if present (same logic as diffService)
        // Azure DevOps paths may include repository name like "safeflyV2/src/file.cs"
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension) {
            const git = gitExtension.exports.getAPI(1);
            const repo = git.repositories[0];
            
            if (repo) {
                const gitRootName = repo.rootUri.path.split('/').pop();
                if (gitRootName && normalized.startsWith(gitRootName + '/')) {
                    normalized = normalized.substring(gitRootName.length + 1);
                }
            }
        }
        
        return normalized;
    }

    private updateDecorations(editor: vscode.TextEditor): void {
        const config = vscode.workspace.getConfiguration('azureDevOpsPR.comments');
        const showInline = config.get<boolean>('inlineDisplay', true);
        const showResolved = config.get<boolean>('showResolved', false);

        if (!showInline) {
            editor.setDecorations(this.decorationType, []);
            return;
        }

        const documentPath = this.getRelativeFilePath(editor.document.uri);
        console.log(`[InlineComments] Looking for comments in: ${documentPath}`);
        console.log(`[InlineComments] Available paths:`, Array.from(this.commentThreads.keys()));
        
        const threads = this.commentThreads.get(documentPath) || [];
        console.log(`[InlineComments] Found ${threads.length} threads for ${documentPath}`);
        
        // Filter threads based on settings
        const visibleThreads = threads.filter(thread => 
            showResolved || !thread.isResolved
        );

        console.log(`[InlineComments] Showing ${visibleThreads.length} visible threads (showResolved: ${showResolved})`);

        const decorations: vscode.DecorationOptions[] = visibleThreads.map(thread => {
            const line = Math.max(0, thread.lineStart - 1); // Convert to 0-based
            const range = editor.document.lineAt(line).range;
            
            console.log(`[InlineComments] Adding decoration at line ${thread.lineStart} for thread ${thread.id}`);
            
            const hoverMessage = this.createHoverMessage(thread);
            
            return {
                range,
                hoverMessage,
                renderOptions: {
                    after: {
                        contentText: ` 💬 ${thread.comments.length}`,
                        color: new vscode.ThemeColor('editorCodeLens.foreground')
                    }
                }
            };
        });

        editor.setDecorations(this.decorationType, decorations);
        console.log(`[InlineComments] Applied ${decorations.length} decorations`);
        
        // Store decorations for later reference
        const commentDecorations: CommentDecoration[] = visibleThreads.map((thread, index) => ({
            range: decorations[index].range!,
            thread,
            decoration: decorations[index]
        }));
        
        this.activeDecorations.set(documentPath, commentDecorations);
    }

    private getRelativeFilePath(uri: vscode.Uri): string {
        // Handle git:// scheme URIs (from diff editor)
        if (uri.scheme === 'git') {
            try {
                // Git URIs have the path in the path component
                let gitPath = uri.path;
                
                // Remove leading slash if present
                if (gitPath.startsWith('/')) {
                    gitPath = gitPath.substring(1);
                }
                
                // Normalize and return
                return this.normalizeFilePath(gitPath);
            } catch (e) {
                console.error('Failed to parse git URI:', e);
            }
        }
        
        // Get Git extension to find git root (same logic as diffService and jumpToLine)
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension) {
            const git = gitExtension.exports.getAPI(1);
            const repo = git.repositories[0];
            
            if (repo) {
                const gitRoot = repo.rootUri;
                const gitRootPath = gitRoot.fsPath.replace(/\\/g, '/');
                let filePath = uri.fsPath.replace(/\\/g, '/');
                
                // Make path relative to git root
                if (filePath.startsWith(gitRootPath)) {
                    filePath = filePath.substring(gitRootPath.length + 1);
                }
                
                return this.normalizeFilePath(filePath);
            }
        }
        
        // Fallback to workspace folder
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
            return this.normalizeFilePath(
                uri.fsPath.substring(workspaceFolder.uri.fsPath.length + 1)
                    .replace(/\\/g, '/')
            );
        }
        return this.normalizeFilePath(uri.fsPath.replace(/\\/g, '/'));
    }

    private createHoverMessage(thread: CommentThread): vscode.MarkdownString | undefined {
        // No hover message - users should click to open Comment Chat panel
        return undefined;
    }

    public async showCommentsInEditor(document: vscode.TextDocument): Promise<void> {
        const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
        if (editor) {
            this.updateDecorations(editor);
        }
    }

    public async replyToThread(threadId: number, content: string): Promise<void> {
        if (!this.currentPR) {
            throw new Error('No PR loaded');
        }

        await this.azureDevOpsService.addCommentToThread(
            this.currentPR.pullRequestId,
            threadId,
            content
        );

        // Reload comments
        await this.loadCommentsForPR(this.currentPR);
    }

    public async resolveThread(threadId: number): Promise<void> {
        if (!this.currentPR) {
            throw new Error('No PR loaded');
        }

        await this.azureDevOpsService.resolveThread(
            this.currentPR.pullRequestId,
            threadId
        );

        // Reload comments
        await this.loadCommentsForPR(this.currentPR);
    }

    public async addCommentAtLine(filePath: string, lineNumber: number, content: string): Promise<void> {
        if (!this.currentPR) {
            throw new Error('No PR loaded');
        }

        await this.azureDevOpsService.addInlineComment(
            this.currentPR.pullRequestId,
            content,
            filePath,
            lineNumber
        );

        // Reload comments
        await this.loadCommentsForPR(this.currentPR);
    }

    public async addCommentAtLineRange(filePath: string, startLine: number, endLine: number, content: string): Promise<void> {
        if (!this.currentPR) {
            throw new Error('No PR loaded');
        }

        // Use the range-aware API method if available, otherwise fall back to single line
        if (startLine === endLine) {
            await this.azureDevOpsService.addInlineComment(
                this.currentPR.pullRequestId,
                content,
                filePath,
                startLine
            );
        } else {
            // For multi-line comments, use the range-aware method
            await this.azureDevOpsService.addInlineCommentRange(
                this.currentPR.pullRequestId,
                content,
                filePath,
                startLine,
                endLine
            );
        }

        // Reload comments
        await this.loadCommentsForPR(this.currentPR);
    }

    public getThreadAtLine(filePath: string, lineNumber: number): CommentThread | undefined {
        const threads = this.commentThreads.get(filePath) || [];
        return threads.find(thread => 
            lineNumber >= thread.lineStart && lineNumber <= thread.lineEnd
        );
    }

    public async refreshComments(): Promise<void> {
        if (this.currentPR) {
            await this.loadCommentsForPR(this.currentPR);
        }
    }

    public clear(): void {
        this.commentThreads.clear();
        this.activeDecorations.clear();
        this.currentPR = null;
        
        // Clear all decorations
        vscode.window.visibleTextEditors.forEach(editor => {
            editor.setDecorations(this.decorationType, []);
        });
    }

    public dispose(): void {
        this.decorationType.dispose();
        this.disposables.forEach(d => d.dispose());
        this.clear();
    }
}
