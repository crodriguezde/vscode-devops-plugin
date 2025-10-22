import * as vscode from 'vscode';
import { AzureDevOpsService } from './azureDevOpsService';
import { PRThread } from '../types';

export class InlineCommentService {
    private commentController: vscode.CommentController;
    private currentPRId?: number;

    constructor(private azureDevOpsService: AzureDevOpsService) {
        this.commentController = vscode.comments.createCommentController(
            'azure-devops-pr-comments',
            'Azure DevOps PR Comments'
        );
        this.commentController.commentingRangeProvider = {
            provideCommentingRanges: (document: vscode.TextDocument) => {
                // Allow comments on any line
                const lineCount = document.lineCount;
                return [new vscode.Range(0, 0, lineCount - 1, 0)];
            }
        };
    }

    async loadCommentsForFile(
        document: vscode.TextDocument,
        pullRequestId: number,
        filePath: string
    ): Promise<void> {
        this.currentPRId = pullRequestId;

        try {
            const threads = await this.azureDevOpsService.getPRThreads(pullRequestId);
            const fileThreads = threads.filter(
                t => t.threadContext?.filePath === filePath
            );

            // Create comment threads
            for (const thread of fileThreads) {
                await this.createCommentThread(document, thread);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load comments: ${error}`);
        }
    }

    private async createCommentThread(
        document: vscode.TextDocument,
        thread: PRThread
    ): Promise<void> {
        const lineNumber = (thread.threadContext?.rightFileStart?.line || 1) - 1;
        const range = new vscode.Range(lineNumber, 0, lineNumber, 0);

        const commentThread = this.commentController.createCommentThread(
            document.uri,
            range,
            thread.comments.map(c => this.createComment(c))
        );

        commentThread.contextValue = thread.id.toString();
        commentThread.canReply = true;
        commentThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;

        // Set thread state based on status
        switch (thread.status.toLowerCase()) {
            case 'active':
                commentThread.state = vscode.CommentThreadState.Unresolved;
                break;
            case 'fixed':
            case 'closed':
                commentThread.state = vscode.CommentThreadState.Resolved;
                break;
        }
    }

    private createComment(comment: any): vscode.Comment {
        return {
            body: new vscode.MarkdownString(comment.content),
            mode: vscode.CommentMode.Preview,
            author: {
                name: comment.author.displayName,
                iconPath: vscode.Uri.parse('https://github.com/github.png') // Placeholder
            },
            timestamp: new Date(comment.publishedDate)
        };
    }

    async addInlineComment(
        document: vscode.TextDocument,
        range: vscode.Range,
        pullRequestId: number,
        filePath: string,
        content: string
    ): Promise<void> {
        try {
            // Add comment via API with line number
            await this.azureDevOpsService.addInlineComment(
                pullRequestId,
                content,
                filePath,
                range.start.line + 1
            );

            // Refresh comments
            await this.loadCommentsForFile(document, pullRequestId, filePath);

            vscode.window.showInformationMessage('Comment added successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add comment: ${error}`);
        }
    }

    async addCommentToThread(
        threadId: string,
        pullRequestId: number,
        content: string
    ): Promise<void> {
        try {
            await this.azureDevOpsService.addCommentToThread(
                pullRequestId,
                parseInt(threadId),
                content
            );

            vscode.window.showInformationMessage('Reply added successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add reply: ${error}`);
        }
    }

    async resolveThread(threadId: string, pullRequestId: number): Promise<void> {
        try {
            await this.azureDevOpsService.resolveThread(pullRequestId, parseInt(threadId));
            vscode.window.showInformationMessage('Thread resolved');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to resolve thread: ${error}`);
        }
    }

    dispose(): void {
        this.commentController.dispose();
    }
}
