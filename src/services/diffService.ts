import * as vscode from 'vscode';
import { AzureDevOpsService } from './azureDevOpsService';

export class DiffService {
    constructor(private azureDevOpsService: AzureDevOpsService) {}

    async showDiff(pullRequestId: number, filePath: string): Promise<void> {
        try {
            // Get PR details to find source and target commits
            const pr = await this.azureDevOpsService.getPullRequest(pullRequestId);
            
            // Get file content from target branch (original)
            const originalContent = await this.getFileFromBranch(
                filePath,
                pr.targetRefName.replace('refs/heads/', '')
            );

            // Get file content from source branch (modified)
            const modifiedContent = await this.getFileFromBranch(
                filePath,
                pr.sourceRefName.replace('refs/heads/', '')
            );

            // Create virtual documents for comparison
            const originalUri = vscode.Uri.parse(
                `azure-devops-diff:${filePath}?ref=${pr.targetRefName}&pr=${pullRequestId}&side=original`
            );
            const modifiedUri = vscode.Uri.parse(
                `azure-devops-diff:${filePath}?ref=${pr.sourceRefName}&pr=${pullRequestId}&side=modified`
            );

            // Register text document content provider
            this.registerDiffProvider(originalContent, modifiedContent, originalUri, modifiedUri);

            // Show diff editor
            await vscode.commands.executeCommand(
                'vscode.diff',
                originalUri,
                modifiedUri,
                `${this.getFileName(filePath)} (PR #${pullRequestId})`,
                {
                    preview: true,
                    preserveFocus: false
                }
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show diff: ${error}`);
        }
    }

    private async getFileFromBranch(filePath: string, branch: string): Promise<string> {
        try {
            return await this.azureDevOpsService.getFileContentFromBranch(filePath, branch);
        } catch (error) {
            // File might not exist in this branch (new or deleted file)
            return '';
        }
    }

    private registerDiffProvider(
        originalContent: string,
        modifiedContent: string,
        originalUri: vscode.Uri,
        modifiedUri: vscode.Uri
    ): void {
        const provider = new class implements vscode.TextDocumentContentProvider {
            provideTextDocumentContent(uri: vscode.Uri): string {
                if (uri.toString() === originalUri.toString()) {
                    return originalContent;
                } else if (uri.toString() === modifiedUri.toString()) {
                    return modifiedContent;
                }
                return '';
            }
        };

        vscode.workspace.registerTextDocumentContentProvider('azure-devops-diff', provider);
    }

    private getFileName(path: string): string {
        const parts = path.split('/');
        return parts[parts.length - 1];
    }

    async showInlineDiff(pullRequestId: number, filePath: string): Promise<vscode.TextEditor | undefined> {
        try {
            const pr = await this.azureDevOpsService.getPullRequest(pullRequestId);
            const content = await this.azureDevOpsService.getFileContentFromBranch(
                filePath,
                pr.sourceRefName.replace('refs/heads/', '')
            );

            const uri = vscode.Uri.parse(
                `azure-devops-inline:${filePath}?pr=${pullRequestId}`
            );

            // Register content provider for inline viewing
            this.registerInlineProvider(content, uri);

            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc, {
                preview: false,
                preserveFocus: false
            });

            // Add decorations for comments
            await this.addCommentDecorations(editor, pullRequestId, filePath);

            return editor;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show inline diff: ${error}`);
            return undefined;
        }
    }

    private registerInlineProvider(content: string, uri: vscode.Uri): void {
        const provider = new class implements vscode.TextDocumentContentProvider {
            provideTextDocumentContent(): string {
                return content;
            }
        };

        vscode.workspace.registerTextDocumentContentProvider('azure-devops-inline', provider);
    }

    private async addCommentDecorations(
        editor: vscode.TextEditor,
        pullRequestId: number,
        filePath: string
    ): Promise<void> {
        const threads = await this.azureDevOpsService.getPRThreads(pullRequestId);
        const fileThreads = threads.filter(
            t => t.threadContext?.filePath === filePath && t.threadContext.rightFileStart
        );

        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editorWarning.background'),
            isWholeLine: true,
            overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });

        const decorations: vscode.DecorationOptions[] = fileThreads.map(thread => {
            const line = (thread.threadContext?.rightFileStart?.line || 1) - 1;
            const range = new vscode.Range(line, 0, line, Number.MAX_VALUE);
            
            const comment = thread.comments[0];
            return {
                range,
                hoverMessage: `💬 ${comment.author.displayName}: ${comment.content}`
            };
        });

        editor.setDecorations(decorationType, decorations);
    }
}
