import * as vscode from 'vscode';
import { InlineCommentProvider } from './inlineCommentProvider';

export class CommentCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor(private inlineCommentProvider: InlineCommentProvider) {}

    public refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        
        // Get relative file path
        const filePath = this.getRelativeFilePath(document.uri);
        
        // Find all comment threads for this file
        const threads = this.inlineCommentProvider['commentThreads'].get(filePath) || [];
        
        const config = vscode.workspace.getConfiguration('azureDevOpsPR.comments');
        const showResolved = config.get<boolean>('showResolved', false);
        
        threads.forEach(thread => {
            // Skip resolved threads if not configured to show them
            if (thread.isResolved && !showResolved) {
                return;
            }
            
            const line = Math.max(0, thread.lineStart - 1); // Convert to 0-based
            if (line >= document.lineCount) {
                return;
            }
            
            const range = document.lineAt(line).range;
            
            // Add "View Thread" code lens
            codeLenses.push(new vscode.CodeLens(range, {
                title: `💬 ${thread.comments.length} comment${thread.comments.length > 1 ? 's' : ''}${thread.isResolved ? ' (resolved)' : ''}`,
                command: 'azureDevOpsPR.showCommentThread',
                arguments: [thread]
            }));
            
            // Add "Reply" code lens
            if (!thread.isResolved) {
                codeLenses.push(new vscode.CodeLens(range, {
                    title: '$(reply) Reply',
                    command: 'azureDevOpsPR.replyToCommentInline',
                    arguments: [{ threadId: thread.id, filePath: thread.filePath }]
                }));
                
                // Add "Resolve" code lens
                codeLenses.push(new vscode.CodeLens(range, {
                    title: '$(check) Resolve',
                    command: 'azureDevOpsPR.resolveCommentInline',
                    arguments: [{ threadId: thread.id }]
                }));
            }
        });
        
        return codeLenses;
    }

    private getRelativeFilePath(uri: vscode.Uri): string {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
            return uri.fsPath.substring(workspaceFolder.uri.fsPath.length + 1)
                .replace(/\\/g, '/');
        }
        return uri.fsPath.replace(/\\/g, '/');
    }
}
