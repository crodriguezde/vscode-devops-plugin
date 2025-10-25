import * as vscode from 'vscode';
import { PRFile, PullRequest } from '../types';
import { AzureDevOpsService } from './azureDevOpsService';

export class DiffService {
    constructor(private azureDevOpsService: AzureDevOpsService) {}

    /**
     * Opens a side-by-side diff view for a PR file using local git
     * Left: Base version (target branch from local git)
     * Right: Current working copy (checked out source branch)
     */
    async openDiff(pr: PullRequest, file: PRFile): Promise<void> {
        try {
            // Get workspace folder
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('No workspace folder open');
                return;
            }

            const workspaceRoot = workspaceFolders[0].uri;
            
            // Normalize the file path
            const normalizedPath = file.path.startsWith('/') 
                ? file.path.substring(1) 
                : file.path;

            // Get branch names
            const sourceBranch = pr.sourceRefName.replace('refs/heads/', '');
            const targetBranch = pr.targetRefName.replace('refs/heads/', '');

            // Get Git extension
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                vscode.window.showErrorMessage('Git extension not available');
                return;
            }

            const git = gitExtension.exports.getAPI(1);
            const repo = git.repositories[0];
            
            if (!repo) {
                vscode.window.showErrorMessage('No git repository found');
                return;
            }

            // Get the git repository root
            const gitRoot = repo.rootUri;
            
            // The file path from Azure DevOps may include the repository name
            // We need to make it relative to the git root
            let relativePath = normalizedPath;
            
            // If the path starts with a folder name that matches the last segment of git root,
            // remove it (e.g., "safeflyV2/src/file.cs" -> "src/file.cs")
            const gitRootName = gitRoot.path.split('/').pop();
            if (gitRootName && relativePath.startsWith(gitRootName + '/')) {
                relativePath = relativePath.substring(gitRootName.length + 1);
            }
            
            // Construct full file path relative to git root
            const fullPath = vscode.Uri.joinPath(gitRoot, relativePath);

            // Left side: target branch (read-only)
            const baseUri = await this.toGitUri(fullPath, `origin/${targetBranch}`);
            
            // Right side: Check if we're on the PR branch
            const currentBranch = repo.state.HEAD?.name || '';
            let modifiedUri: vscode.Uri;
            
            if (currentBranch === sourceBranch) {
                // We're on the PR branch - use file:// URI (EDITABLE!)
                modifiedUri = fullPath;
            } else {
                // We're on a different branch - use git:// URI (read-only)
                modifiedUri = await this.toGitUri(fullPath, sourceBranch);
            }

            // Open diff editor
            const fileName = normalizedPath.split('/').pop();
            const editableIndicator = currentBranch === sourceBranch ? ' ✏️' : '';
            const title = `${fileName} (${targetBranch} ↔ ${sourceBranch})${editableIndicator}`;
            
            await vscode.commands.executeCommand(
                'vscode.diff',
                baseUri,
                modifiedUri,
                title,
                {
                    preview: false,
                    preserveFocus: false
                }
            );

            // Load inline comments for this file in the diff editor
            // Wait a moment for the diff editor to open
            setTimeout(async () => {
                try {
                    const threads = await this.azureDevOpsService.getPRThreads(pr.pullRequestId);
                    const fileThreads = threads.filter((thread: any) => 
                        thread.threadContext?.filePath === file.path
                    );

                    if (fileThreads.length > 0) {
                        // The inline comment provider will handle displaying these
                        // We just need to trigger it to load comments for the active file
                        await vscode.commands.executeCommand('azureDevOpsPR.refreshInlineComments');
                    }
                } catch (commentError) {
                    console.error('Failed to load inline comments:', commentError);
                }
            }, 500);

        } catch (error) {
            console.error('Failed to open diff:', error);
            vscode.window.showErrorMessage(`Failed to open diff: ${error}`);
        }
    }

    /**
     * Convert a file URI to a Git URI for a specific ref
     */
    private async toGitUri(uri: vscode.Uri, ref: string): Promise<vscode.Uri> {
        // Use the git extension's toGitUri function for proper URI creation
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (!gitExtension) {
            throw new Error('Git extension not available');
        }
        
        const git = gitExtension.exports.getAPI(1);
        const repo = git.repositories[0];
        
        if (!repo) {
            throw new Error('No git repository found');
        }
        
        // Use the repository's toGitUri method which properly formats the URI
        try {
            return await repo.toGitUri(uri, ref);
        } catch (error) {
            // Fallback: construct URI manually if toGitUri fails
            console.warn('toGitUri failed, using fallback:', error);
            return uri.with({
                scheme: 'git',
                query: JSON.stringify({
                    path: uri.fsPath,
                    ref: ref
                })
            });
        }
    }

    /**
     * Opens a three-way diff (merge editor style)
     * Shows base, theirs (target), and yours (source) side-by-side
     */
    async openMergeStyleDiff(pr: PullRequest, file: PRFile): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('No workspace folder open');
                return;
            }

            const normalizedPath = file.path.startsWith('/') 
                ? file.path.substring(1) 
                : file.path;

            const sourceBranch = pr.sourceRefName.replace('refs/heads/', '');
            const targetBranch = pr.targetRefName.replace('refs/heads/', '');

            // For now, open standard diff (VS Code merge editor requires specific merge conflicts)
            // But we can make it look like merge editor with proper URIs
            const baseUri = vscode.Uri.parse(`git:${normalizedPath}?ref=${targetBranch}`);
            const modifiedUri = vscode.Uri.parse(`git:${normalizedPath}?ref=${sourceBranch}`);

            const title = `📝 ${file.path.split('/').pop()} • ${targetBranch} → ${sourceBranch}`;

            await vscode.commands.executeCommand(
                'vscode.diff',
                baseUri,
                modifiedUri,
                title,
                {
                    preview: false,
                    preserveFocus: false,
                    viewColumn: vscode.ViewColumn.Active
                }
            );

        } catch (error) {
            console.error('Failed to open merge-style diff:', error);
            vscode.window.showErrorMessage(`Failed to open diff: ${error}`);
        }
    }

    /**
     * Gets the content of a file at a specific git ref
     */
    async getFileContent(filePath: string, ref: string): Promise<string> {
        try {
            const normalizedPath = filePath.startsWith('/') 
                ? filePath.substring(1) 
                : filePath;

            const uri = vscode.Uri.parse(`git:${normalizedPath}?ref=${ref}`);
            const document = await vscode.workspace.openTextDocument(uri);
            return document.getText();
        } catch (error) {
            throw new Error(`Failed to get file content: ${error}`);
        }
    }
}
