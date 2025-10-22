import * as vscode from 'vscode';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { PullRequest } from '../types';

export class PRWebviewProvider {
    constructor(
        private context: vscode.ExtensionContext,
        private azureDevOpsService: AzureDevOpsService
    ) {}

    async renderPRDetails(panel: vscode.WebviewPanel, pr: PullRequest): Promise<void> {
        panel.webview.html = await this.getPRDetailsHtml(pr);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'approve':
                        await this.azureDevOpsService.approvePR(pr.pullRequestId);
                        vscode.window.showInformationMessage('PR approved');
                        break;
                    case 'complete':
                        await this.azureDevOpsService.completePR(pr.pullRequestId);
                        vscode.window.showInformationMessage('PR completed');
                        panel.dispose();
                        break;
                    case 'abandon':
                        await this.azureDevOpsService.abandonPR(pr.pullRequestId);
                        vscode.window.showInformationMessage('PR abandoned');
                        panel.dispose();
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private async getPRDetailsHtml(pr: PullRequest): Promise<string> {
        const files = await this.azureDevOpsService.getPRFiles(pr.pullRequestId);
        const threads = await this.azureDevOpsService.getPRThreads(pr.pullRequestId);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PR #${pr.pullRequestId}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        .header {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 20px;
            margin-bottom: 20px;
        }
        .pr-title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .pr-meta {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }
        .section {
            margin-bottom: 30px;
        }
        .section-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 5px;
        }
        .description {
            white-space: pre-wrap;
            background-color: var(--vscode-textBlockQuote-background);
            padding: 10px;
            border-radius: 4px;
            border-left: 4px solid var(--vscode-textBlockQuote-border);
        }
        .reviewer {
            display: inline-block;
            margin: 5px 10px 5px 0;
            padding: 5px 10px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 3px;
        }
        .file-item {
            padding: 8px;
            margin: 5px 0;
            background-color: var(--vscode-list-hoverBackground);
            border-radius: 3px;
            display: flex;
            justify-content: space-between;
        }
        .file-path {
            font-family: var(--vscode-editor-font-family);
        }
        .change-type {
            font-size: 12px;
            padding: 2px 8px;
            border-radius: 3px;
        }
        .change-add {
            background-color: #28a745;
            color: white;
        }
        .change-edit {
            background-color: #ffa500;
            color: white;
        }
        .change-delete {
            background-color: #dc3545;
            color: white;
        }
        .comment-thread {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 10px;
            margin: 10px 0;
        }
        .comment {
            padding: 8px;
            margin: 5px 0;
            border-left: 3px solid var(--vscode-textLink-foreground);
            background-color: var(--vscode-textBlockQuote-background);
        }
        .comment-author {
            font-weight: bold;
            margin-bottom: 5px;
        }
        .actions {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            margin-right: 10px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .vote-approved {
            color: #28a745;
        }
        .vote-rejected {
            color: #dc3545;
        }
        .vote-waiting {
            color: #ffa500;
        }
        .branch-info {
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 4px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="pr-title">#${pr.pullRequestId}: ${this.escapeHtml(pr.title)}</div>
        <div class="pr-meta">
            Created by ${this.escapeHtml(pr.createdBy.displayName)} on ${new Date(pr.creationDate).toLocaleString()}
        </div>
        <div class="branch-info">
            ${this.getBranchName(pr.sourceRefName)} → ${this.getBranchName(pr.targetRefName)}
        </div>
    </div>

    ${pr.description ? `
    <div class="section">
        <div class="section-title">Description</div>
        <div class="description">${this.escapeHtml(pr.description)}</div>
    </div>
    ` : ''}

    <div class="section">
        <div class="section-title">Reviewers (${pr.reviewers.length})</div>
        ${pr.reviewers.map(r => `
            <span class="reviewer ${this.getVoteClass(r.vote)}">
                ${this.escapeHtml(r.displayName)} ${this.getVoteSymbol(r.vote)}
            </span>
        `).join('')}
    </div>

    <div class="section">
        <div class="section-title">Files Changed (${files.length})</div>
        ${files.map(f => `
            <div class="file-item">
                <span class="file-path">${this.escapeHtml(f.path)}</span>
                <span class="change-type change-${f.changeType.toLowerCase()}">${f.changeType}</span>
            </div>
        `).join('')}
    </div>

    <div class="section">
        <div class="section-title">Comments (${threads.length} threads)</div>
        ${threads.map(thread => `
            <div class="comment-thread">
                ${thread.threadContext?.filePath ? `<strong>File: ${this.escapeHtml(thread.threadContext.filePath)}</strong>` : '<strong>General Comment</strong>'}
                ${thread.comments.map(c => `
                    <div class="comment">
                        <div class="comment-author">${this.escapeHtml(c.author.displayName)}</div>
                        <div>${this.escapeHtml(c.content)}</div>
                    </div>
                `).join('')}
            </div>
        `).join('')}
    </div>

    <div class="actions">
        <button onclick="approve()">Approve</button>
        <button onclick="complete()">Complete</button>
        <button onclick="abandon()">Abandon</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function approve() {
            vscode.postMessage({ command: 'approve' });
        }
        
        function complete() {
            if (confirm('Are you sure you want to complete this PR?')) {
                vscode.postMessage({ command: 'complete' });
            }
        }
        
        function abandon() {
            if (confirm('Are you sure you want to abandon this PR?')) {
                vscode.postMessage({ command: 'abandon' });
            }
        }
    </script>
</body>
</html>`;
    }

    private escapeHtml(text: string): string {
        const map: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    private getBranchName(refName: string): string {
        return refName.replace('refs/heads/', '');
    }

    private getVoteSymbol(vote: number): string {
        if (vote === 10) return '✓';
        if (vote === 5) return '✓-';
        if (vote === 0) return '○';
        if (vote === -5) return '✕-';
        if (vote === -10) return '✕';
        return '?';
    }

    private getVoteClass(vote: number): string {
        if (vote > 0) return 'vote-approved';
        if (vote < 0) return 'vote-rejected';
        return '';
    }
}
