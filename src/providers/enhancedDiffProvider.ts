import * as vscode from 'vscode';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { CommitInfo, DiffData, CommitSelection, DiffViewerConfig } from '../types/diffTypes';
import { PullRequest, PRIteration } from '../types';
import * as path from 'path';

export class EnhancedDiffProvider {
    private panels: Map<string, vscode.WebviewPanel> = new Map();
    private config: DiffViewerConfig;

    constructor(private azureDevOpsService: AzureDevOpsService) {
        this.config = this.loadConfig();
    }

    private loadConfig(): DiffViewerConfig {
        const config = vscode.workspace.getConfiguration('azureDevOpsPR.diffViewer');
        return {
            showCommitDropdowns: config.get('showCommitDropdowns', true),
            defaultCommitSelection: config.get('defaultCommitSelection', 'latest'),
            syntaxHighlighting: true,
            showLineNumbers: true
        };
    }

    public async createDiffView(
        context: vscode.ExtensionContext,
        pr: PullRequest,
        filePath: string
    ): Promise<vscode.WebviewPanel> {
        const panelKey = `${pr.pullRequestId}-${filePath}`;
        
        // Check if panel already exists
        if (this.panels.has(panelKey)) {
            const existingPanel = this.panels.get(panelKey)!;
            existingPanel.reveal();
            return existingPanel;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            'enhancedDiff',
            `Diff: ${path.basename(filePath)} (PR #${pr.pullRequestId})`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'media'))
                ]
            }
        );

        this.panels.set(panelKey, panel);

        // Clean up when panel is closed
        panel.onDidDispose(() => {
            this.panels.delete(panelKey);
        });

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleWebviewMessage(message, panel, pr, filePath);
            },
            undefined,
            context.subscriptions
        );

        // Load commit history
        const commits = await this.getCommitHistory(pr.pullRequestId);
        
        // Determine default commits
        const { leftCommit, rightCommit } = this.getDefaultCommits(commits, pr);
        
        // Load diff data
        const diffData = await this.generateDiff(
            pr.pullRequestId,
            leftCommit.commitId,
            rightCommit.commitId,
            filePath
        );

        // Render webview
        panel.webview.html = this.getWebviewContent(
            panel.webview,
            context,
            diffData,
            commits
        );

        return panel;
    }

    public async getCommitHistory(prId: number): Promise<CommitInfo[]> {
        try {
            const iterations = await this.azureDevOpsService.getPRIterations(prId);
            
            const commits: CommitInfo[] = iterations.map(iteration => ({
                commitId: iteration.sourceRefCommit.commitId,
                comment: iteration.description || 'No description',
                author: {
                    name: iteration.author.displayName,
                    email: iteration.author.uniqueName,
                    date: iteration.createdDate
                }
            }));

            // Sort by date, most recent first
            commits.sort((a, b) => b.author.date.getTime() - a.author.date.getTime());

            return commits;
        } catch (error) {
            console.error('Failed to get commit history:', error);
            return [];
        }
    }

    private getDefaultCommits(
        commits: CommitInfo[],
        pr: PullRequest
    ): { leftCommit: CommitInfo; rightCommit: CommitInfo } {
        if (commits.length === 0) {
            // Fallback to PR source/target
            return {
                leftCommit: {
                    commitId: pr.targetRefName,
                    comment: 'Target branch',
                    author: { name: 'System', email: '', date: new Date() }
                },
                rightCommit: {
                    commitId: pr.sourceRefName,
                    comment: 'Source branch',
                    author: { name: 'System', email: '', date: new Date() }
                }
            };
        }

        // Based on config, determine defaults
        switch (this.config.defaultCommitSelection) {
            case 'base':
                return {
                    leftCommit: commits[commits.length - 1], // Oldest
                    rightCommit: commits[0] // Latest
                };
            case 'latest':
            default:
                return {
                    leftCommit: commits.length > 1 ? commits[1] : commits[0],
                    rightCommit: commits[0]
                };
        }
    }

    public async generateDiff(
        prId: number,
        leftCommitId: string,
        rightCommitId: string,
        filePath: string
    ): Promise<DiffData> {
        try {
            // Get file content from both commits
            const leftContent = await this.getFileContentAtCommit(prId, filePath, leftCommitId);
            const rightContent = await this.getFileContentAtCommit(prId, filePath, rightCommitId);

            // Get commit info
            const commits = await this.getCommitHistory(prId);
            const leftCommit = commits.find(c => c.commitId === leftCommitId) || {
                commitId: leftCommitId,
                comment: 'Left commit',
                author: { name: 'Unknown', email: '', date: new Date() }
            };
            const rightCommit = commits.find(c => c.commitId === rightCommitId) || {
                commitId: rightCommitId,
                comment: 'Right commit',
                author: { name: 'Unknown', email: '', date: new Date() }
            };

            return {
                leftCommit,
                rightCommit,
                filePath,
                leftContent,
                rightContent,
                changes: [] // Changes will be computed in webview
            };
        } catch (error) {
            throw new Error(`Failed to generate diff: ${error}`);
        }
    }

    private async getFileContentAtCommit(
        prId: number,
        filePath: string,
        commitId: string
    ): Promise<string> {
        try {
            // Try to get file content at specific commit
            const content = await this.azureDevOpsService.getFileContent(prId, filePath);
            return content;
        } catch (error) {
            console.error(`Failed to get file content at commit ${commitId}:`, error);
            return '';
        }
    }

    private async handleWebviewMessage(
        message: any,
        panel: vscode.WebviewPanel,
        pr: PullRequest,
        filePath: string
    ): Promise<void> {
        switch (message.command) {
            case 'commitSelectionChanged':
                await this.handleCommitSelectionChange(
                    panel,
                    pr,
                    filePath,
                    message.leftCommitId,
                    message.rightCommitId
                );
                break;
            
            case 'openInExternalTool':
                await this.openInExternalDiffTool(pr, filePath);
                break;
            
            case 'copyDiff':
                await this.copyDiffToClipboard(message.diff);
                break;
        }
    }

    private async handleCommitSelectionChange(
        panel: vscode.WebviewPanel,
        pr: PullRequest,
        filePath: string,
        leftCommitId: string,
        rightCommitId: string
    ): Promise<void> {
        try {
            const diffData = await this.generateDiff(
                pr.pullRequestId,
                leftCommitId,
                rightCommitId,
                filePath
            );

            // Send updated diff to webview
            panel.webview.postMessage({
                command: 'updateDiff',
                diffData
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update diff: ${error}`);
        }
    }

    private async openInExternalDiffTool(pr: PullRequest, filePath: string): Promise<void> {
        vscode.window.showInformationMessage(
            'External diff tool integration coming soon. Use VS Code built-in diff for now.'
        );
    }

    private async copyDiffToClipboard(diff: string): Promise<void> {
        await vscode.env.clipboard.writeText(diff);
        vscode.window.showInformationMessage('Diff copied to clipboard');
    }

    private getWebviewContent(
        webview: vscode.Webview,
        context: vscode.ExtensionContext,
        diffData: DiffData,
        commits: CommitInfo[]
    ): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(context.extensionPath, 'media', 'diffViewer.css'))
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(context.extensionPath, 'media', 'diffViewer.js'))
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';">
    <title>Enhanced Diff Viewer</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 0;
            margin: 0;
        }
        .diff-controls {
            padding: 10px;
            background-color: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 15px;
        }
        .commit-selectors {
            display: flex;
            align-items: center;
            gap: 10px;
            flex: 1;
        }
        .commit-dropdown {
            padding: 5px 10px;
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 2px;
            min-width: 200px;
        }
        .arrow-icon {
            font-size: 18px;
            color: var(--vscode-foreground);
        }
        .diff-actions {
            display: flex;
            gap: 8px;
        }
        button {
            padding: 6px 14px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .diff-container {
            display: flex;
            height: calc(100vh - 60px);
        }
        .diff-side {
            flex: 1;
            overflow: auto;
            position: relative;
        }
        .diff-separator {
            width: 2px;
            background-color: var(--vscode-panel-border);
        }
        .diff-content {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: 1.5;
            white-space: pre;
            padding: 10px;
        }
        .line {
            display: flex;
        }
        .line-number {
            min-width: 50px;
            padding: 0 10px;
            text-align: right;
            color: var(--vscode-editorLineNumber-foreground);
            user-select: none;
        }
        .line-content {
            flex: 1;
            padding: 0 10px;
        }
        .line-add {
            background-color: var(--vscode-diffEditor-insertedTextBackground);
        }
        .line-delete {
            background-color: var(--vscode-diffEditor-removedTextBackground);
        }
        .line-modify {
            background-color: var(--vscode-diffEditor-insertedTextBackground);
        }
    </style>
</head>
<body>
    <div class="diff-controls">
        <div class="commit-selectors">
            <select id="leftCommit" class="commit-dropdown">
                ${commits.map(c => `
                    <option value="${c.commitId}" ${c.commitId === diffData.leftCommit.commitId ? 'selected' : ''}>
                        ${c.commitId.substring(0, 8)} - ${c.comment} (${new Date(c.author.date).toLocaleDateString()})
                    </option>
                `).join('')}
            </select>
            <span class="arrow-icon">↔</span>
            <select id="rightCommit" class="commit-dropdown">
                ${commits.map(c => `
                    <option value="${c.commitId}" ${c.commitId === diffData.rightCommit.commitId ? 'selected' : ''}>
                        ${c.commitId.substring(0, 8)} - ${c.comment} (${new Date(c.author.date).toLocaleDateString()})
                    </option>
                `).join('')}
            </select>
        </div>
        <div class="diff-actions">
            <button id="refreshBtn" title="Refresh Diff">↻ Refresh</button>
            <button id="copyBtn" title="Copy Diff">📋 Copy</button>
        </div>
    </div>
    <div class="diff-container">
        <div class="diff-side" id="leftSide">
            <div class="diff-content" id="leftContent"></div>
        </div>
        <div class="diff-separator"></div>
        <div class="diff-side" id="rightSide">
            <div class="diff-content" id="rightContent"></div>
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        let currentDiffData = ${JSON.stringify(diffData)};
        
        function renderDiff(diffData) {
            const leftContent = document.getElementById('leftContent');
            const rightContent = document.getElementById('rightContent');
            
            leftContent.innerHTML = renderSide(diffData.leftContent, 'left');
            rightContent.innerHTML = renderSide(diffData.rightContent, 'right');
        }
        
        function renderSide(content, side) {
            const lines = content.split('\\n');
            return lines.map((line, idx) => 
                \`<div class="line">
                    <span class="line-number">\${idx + 1}</span>
                    <span class="line-content">\${escapeHtml(line)}</span>
                </div>\`
            ).join('');
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // Event listeners
        document.getElementById('leftCommit').addEventListener('change', (e) => {
            const leftCommitId = e.target.value;
            const rightCommitId = document.getElementById('rightCommit').value;
            vscode.postMessage({
                command: 'commitSelectionChanged',
                leftCommitId,
                rightCommitId
            });
        });
        
        document.getElementById('rightCommit').addEventListener('change', (e) => {
            const leftCommitId = document.getElementById('leftCommit').value;
            const rightCommitId = e.target.value;
            vscode.postMessage({
                command: 'commitSelectionChanged',
                leftCommitId,
                rightCommitId
            });
        });
        
        document.getElementById('refreshBtn').addEventListener('click', () => {
            const leftCommitId = document.getElementById('leftCommit').value;
            const rightCommitId = document.getElementById('rightCommit').value;
            vscode.postMessage({
                command: 'commitSelectionChanged',
                leftCommitId,
                rightCommitId
            });
        });
        
        document.getElementById('copyBtn').addEventListener('click', () => {
            const diff = currentDiffData.leftContent + '\\n---\\n' + currentDiffData.rightContent;
            vscode.postMessage({
                command: 'copyDiff',
                diff
            });
        });
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateDiff') {
                currentDiffData = message.diffData;
                renderDiff(currentDiffData);
            }
        });
        
        // Initial render
        renderDiff(currentDiffData);
    </script>
</body>
</html>`;
    }

    public refreshConfig(): void {
        this.config = this.loadConfig();
    }
}
