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
        // Create decoration type for comment indicators
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
            backgroundColor: new vscode.ThemeColor('editor.lineHighlightBackground')
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
            })
        );
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
        return filePath.startsWith('/') ? filePath.substring(1) : filePath;
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
        const threads = this.commentThreads.get(documentPath) || [];
        
        // Filter threads based on settings
        const visibleThreads = threads.filter(thread => 
            showResolved || !thread.isResolved
        );

        const decorations: vscode.DecorationOptions[] = visibleThreads.map(thread => {
            const line = Math.max(0, thread.lineStart - 1); // Convert to 0-based
            const range = editor.document.lineAt(line).range;
            
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
        
        // Store decorations for later reference
        const commentDecorations: CommentDecoration[] = visibleThreads.map((thread, index) => ({
            range: decorations[index].range!,
            thread,
            decoration: decorations[index]
        }));
        
        this.activeDecorations.set(documentPath, commentDecorations);
    }

    private getRelativeFilePath(uri: vscode.Uri): string {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
            return uri.fsPath.substring(workspaceFolder.uri.fsPath.length + 1)
                .replace(/\\/g, '/');
        }
        return uri.fsPath.replace(/\\/g, '/');
    }

    private createHoverMessage(thread: CommentThread): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.supportHtml = true;
        md.isTrusted = true;

        md.appendMarkdown(`### 💬 Comment Thread ${thread.isResolved ? '✓ Resolved' : ''}\n\n`);
        
        thread.comments.forEach((comment, index) => {
            if (index > 0) {
                md.appendMarkdown('---\n\n');
            }
            
            md.appendMarkdown(`**${comment.author.displayName}** `);
            md.appendMarkdown(`*${new Date(comment.publishedDate).toLocaleString()}*\n\n`);
            md.appendMarkdown(`${comment.content}\n\n`);
        });

        // Add action links
        md.appendMarkdown(`[Reply](command:azureDevOpsPR.replyToCommentInline?${encodeURIComponent(JSON.stringify({ threadId: thread.id, filePath: thread.filePath }))})`);
        
        if (!thread.isResolved) {
            md.appendMarkdown(` | `);
            md.appendMarkdown(`[Resolve](command:azureDevOpsPR.resolveCommentInline?${encodeURIComponent(JSON.stringify({ threadId: thread.id }))})`);
        }

        return md;
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

    public getThreadAtLine(filePath: string, lineNumber: number): CommentThread | undefined {
        const threads = this.commentThreads.get(filePath) || [];
        return threads.find(thread => 
            lineNumber >= thread.lineStart && lineNumber <= thread.lineEnd
        );
    }

    public refreshComments(): void {
        if (this.currentPR) {
            this.loadCommentsForPR(this.currentPR);
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
