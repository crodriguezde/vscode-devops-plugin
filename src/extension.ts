import * as vscode from 'vscode';
import { AzureDevOpsService } from './services/azureDevOpsService';
import { PRTreeDataProvider } from './providers/prTreeDataProvider';
import { PRFilesTreeDataProvider } from './providers/prFilesTreeDataProvider';
import { PRCommentsTreeDataProvider } from './providers/prCommentsTreeDataProvider';
import { PRWebviewProvider } from './providers/prWebviewProvider';
import { AuthenticationProvider } from './auth/authenticationProvider';
import { ClineWorkflowService } from './services/clineWorkflowService';
import { ContextMenuProvider } from './providers/contextMenuProvider';
import { EnhancedDiffProvider } from './providers/enhancedDiffProvider';
import { InlineCommentProvider } from './providers/inlineCommentProvider';
import { CommentCodeLensProvider } from './providers/commentCodeLensProvider';
import { SettingsWebviewProvider } from './providers/settingsWebviewProvider';

let azureDevOpsService: AzureDevOpsService;
let settingsWebviewProvider: SettingsWebviewProvider;
let authProvider: AuthenticationProvider;
let prTreeDataProvider: PRTreeDataProvider;
let prFilesTreeDataProvider: PRFilesTreeDataProvider;
let prCommentsTreeDataProvider: PRCommentsTreeDataProvider;
let clineWorkflowService: ClineWorkflowService;
let contextMenuProvider: ContextMenuProvider;
let enhancedDiffProvider: EnhancedDiffProvider;
let inlineCommentProvider: InlineCommentProvider;
let commentCodeLensProvider: CommentCodeLensProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Azure DevOps PR Viewer is now active');

    // Initialize services
    authProvider = new AuthenticationProvider(context);
    azureDevOpsService = new AzureDevOpsService(authProvider);

    // Initialize Cline workflow service
    clineWorkflowService = new ClineWorkflowService();
    
    // Initialize enhanced diff provider
    enhancedDiffProvider = new EnhancedDiffProvider(azureDevOpsService);
    
    // Initialize inline comment provider
    inlineCommentProvider = new InlineCommentProvider(azureDevOpsService);
    context.subscriptions.push(inlineCommentProvider);
    
    // Initialize comment code lens provider
    commentCodeLensProvider = new CommentCodeLensProvider(inlineCommentProvider);
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { scheme: 'file' },
            commentCodeLensProvider
        )
    );
    
    // Initialize tree data providers
    prTreeDataProvider = new PRTreeDataProvider(azureDevOpsService);
    prFilesTreeDataProvider = new PRFilesTreeDataProvider(azureDevOpsService);
    prCommentsTreeDataProvider = new PRCommentsTreeDataProvider(azureDevOpsService);

    // Initialize context menu provider
    contextMenuProvider = new ContextMenuProvider(clineWorkflowService);
    contextMenuProvider.registerPRContextMenus(context);

    // Initialize settings webview provider
    settingsWebviewProvider = new SettingsWebviewProvider(context);

    // Register tree views
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('azureDevOpsPRExplorer', prTreeDataProvider),
        vscode.window.registerTreeDataProvider('azureDevOpsPRFiles', prFilesTreeDataProvider),
        vscode.window.registerTreeDataProvider('azureDevOpsPRComments', prCommentsTreeDataProvider)
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevOpsPR.authenticate', async () => {
            await authenticate();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.refreshPRs', async () => {
            await refreshPRs();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.openPR', async (prItem) => {
            await openPR(prItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.viewPRDetails', async (prItem) => {
            await viewPRDetails(context, prItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.viewFile', async (fileItem) => {
            await viewFile(fileItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.addComment', async (fileItem) => {
            await addComment(fileItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.approvePR', async (prItem) => {
            await approvePR(prItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.completePR', async (prItem) => {
            await completePR(prItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.abandonPR', async (prItem) => {
            await abandonPR(prItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.checkout', async (prItem) => {
            await checkoutPRBranch(prItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.signOut', async () => {
            await signOut();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.toggleInlineComments', async () => {
            await toggleInlineComments();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.viewFileWithCommitSelection', async (fileItem) => {
            await viewFileWithCommitSelection(context, fileItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.replyToComment', async (commentItem) => {
            await replyToComment(commentItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.resolveComment', async (commentItem) => {
            await resolveComment(commentItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.replyToCommentInline', async (args) => {
            await replyToCommentInline(args);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.resolveCommentInline', async (args) => {
            await resolveCommentInline(args);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.showCommentThread', async (thread) => {
            await showCommentThread(thread);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.addCommentAtLine', async () => {
            await addCommentAtLine();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.refreshInlineComments', async () => {
            await refreshInlineComments();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.openSettings', async () => {
            await settingsWebviewProvider.showSettings();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.jumpToLine', async (filePath: string, lineNumber: number) => {
            await jumpToLine(filePath, lineNumber);
        })
    );

    // Auto-refresh on activation if configured
    const config = vscode.workspace.getConfiguration('azureDevOpsPR');
    if (config.get('autoRefresh')) {
        refreshPRs();
    }
}

async function authenticate() {
    try {
        await authProvider.authenticate();
        await azureDevOpsService.initialize();
        await refreshPRs();
    } catch (error) {
        vscode.window.showErrorMessage(`Authentication failed: ${error}`);
    }
}

async function refreshPRs() {
    try {
        await prTreeDataProvider.refresh();
        vscode.window.showInformationMessage('Pull requests refreshed');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh PRs: ${error}`);
    }
}

async function openPR(prItem: any) {
    if (!prItem) {
        return;
    }

    try {
        // Check if auto-checkout is enabled
        const config = vscode.workspace.getConfiguration('azureDevOpsPR');
        const autoCheckout = config.get<boolean>('autoCheckoutBranch', true);
        
        if (autoCheckout) {
            // Automatically checkout the PR branch
            await checkoutPRBranchSilent(prItem.pr);
        }
        
        // Load PR details
        await prFilesTreeDataProvider.loadPR(prItem.pr);
        await prCommentsTreeDataProvider.loadPR(prItem.pr);
        
        // Load inline comments
        await inlineCommentProvider.loadCommentsForPR(prItem.pr);
        
        const branchName = prItem.pr.sourceRefName.replace('refs/heads/', '');
        vscode.window.showInformationMessage(
            `Opened PR #${prItem.pr.pullRequestId}: ${prItem.pr.title}${autoCheckout ? ` (checked out ${branchName})` : ''}`
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to open PR: ${error}`);
    }
}

async function checkoutPRBranchSilent(pr: any): Promise<void> {
    try {
        const sourceBranch = pr.sourceRefName.replace('refs/heads/', '');
        
        // Check if workspace has a git repository
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        // Use the Git extension API if available
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension) {
            const git = gitExtension.exports.getAPI(1);
            const repo = git.repositories[0];
            
            if (repo) {
                // Fetch the branch
                await repo.fetch();
                
                // Try to checkout the branch
                try {
                    await repo.checkout(sourceBranch);
                } catch (checkoutError) {
                    // Branch might not exist locally, try fetching and checking out
                    await repo.fetch('origin', sourceBranch);
                    await repo.checkout(sourceBranch);
                }
            }
        } else {
            // Fallback to terminal commands if Git extension not available
            const terminal = vscode.window.createTerminal({
                name: 'PR Checkout',
                hideFromUser: true
            });
            
            terminal.sendText(`git fetch origin ${sourceBranch}`, true);
            terminal.sendText(`git checkout ${sourceBranch}`, true);
            
            // Dispose terminal after commands complete
            setTimeout(() => terminal.dispose(), 3000);
        }
    } catch (error) {
        // Silently fail - don't show error for checkout issues
        console.error('Failed to checkout branch:', error);
    }
}

async function viewPRDetails(context: vscode.ExtensionContext, prItem: any) {
    if (!prItem) {
        return;
    }

    try {
        const panel = vscode.window.createWebviewPanel(
            'prDetails',
            `PR #${prItem.pr.pullRequestId}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const webviewProvider = new PRWebviewProvider(context, azureDevOpsService);
        await webviewProvider.renderPRDetails(panel, prItem.pr);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to view PR details: ${error}`);
    }
}

async function viewFile(fileItem: any) {
    if (!fileItem || !fileItem.file) {
        return;
    }

    try {
        const content = await azureDevOpsService.getFileContent(
            fileItem.pr.pullRequestId,
            fileItem.file.path
        );

        const doc = await vscode.workspace.openTextDocument({
            content: content,
            language: getLanguageFromPath(fileItem.file.path)
        });

        await vscode.window.showTextDocument(doc);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to view file: ${error}`);
    }
}

async function addComment(fileItem: any) {
    if (!fileItem || !fileItem.file) {
        return;
    }

    try {
        const comment = await vscode.window.showInputBox({
            prompt: 'Enter your comment',
            placeHolder: 'Type your comment here...',
            ignoreFocusOut: true
        });

        if (comment) {
            await azureDevOpsService.addComment(
                fileItem.pr.pullRequestId,
                comment,
                fileItem.file.path
            );
            
            await prCommentsTreeDataProvider.refresh();
            vscode.window.showInformationMessage('Comment added successfully');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to add comment: ${error}`);
    }
}

async function approvePR(prItem: any) {
    if (!prItem) {
        return;
    }

    try {
        await azureDevOpsService.approvePR(prItem.pr.pullRequestId);
        await refreshPRs();
        vscode.window.showInformationMessage(`PR #${prItem.pr.pullRequestId} approved`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to approve PR: ${error}`);
    }
}

async function completePR(prItem: any) {
    if (!prItem) {
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        `Complete PR #${prItem.pr.pullRequestId}?`,
        'Yes',
        'No'
    );

    if (confirm === 'Yes') {
        try {
            await azureDevOpsService.completePR(prItem.pr.pullRequestId);
            await refreshPRs();
            vscode.window.showInformationMessage(`PR #${prItem.pr.pullRequestId} completed`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to complete PR: ${error}`);
        }
    }
}

async function abandonPR(prItem: any) {
    if (!prItem) {
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        `Abandon PR #${prItem.pr.pullRequestId}?`,
        'Yes',
        'No'
    );

    if (confirm === 'Yes') {
        try {
            await azureDevOpsService.abandonPR(prItem.pr.pullRequestId);
            await refreshPRs();
            vscode.window.showInformationMessage(`PR #${prItem.pr.pullRequestId} abandoned`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to abandon PR: ${error}`);
        }
    }
}

async function checkoutPRBranch(prItem: any) {
    if (!prItem) {
        return;
    }

    try {
        const terminal = vscode.window.createTerminal('Azure DevOps PR');
        terminal.show();
        
        const sourceBranch = prItem.pr.sourceRefName.replace('refs/heads/', '');
        terminal.sendText(`git fetch origin ${sourceBranch}`);
        terminal.sendText(`git checkout ${sourceBranch}`);
        
        vscode.window.showInformationMessage(`Checked out branch: ${sourceBranch}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to checkout branch: ${error}`);
    }
}

async function signOut() {
    try {
        await authProvider.signOut();
        vscode.window.showInformationMessage('Signed out from Azure DevOps');
    } catch (error) {
        vscode.window.showErrorMessage(`Sign out failed: ${error}`);
    }
}

async function toggleInlineComments() {
    const config = vscode.workspace.getConfiguration('azureDevOpsPR.comments');
    const current = config.get<boolean>('inlineDisplay', true);
    await config.update('inlineDisplay', !current, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Inline comments ${!current ? 'enabled' : 'disabled'}`);
}

async function viewFileWithCommitSelection(context: vscode.ExtensionContext, fileItem: any) {
    if (!fileItem || !fileItem.file || !fileItem.pr) {
        vscode.window.showErrorMessage('Invalid file item selected');
        return;
    }

    try {
        await enhancedDiffProvider.createDiffView(
            context,
            fileItem.pr,
            fileItem.file.path
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to open enhanced diff viewer: ${error}`);
        // Fallback to standard view
        await viewFile(fileItem);
    }
}

async function replyToComment(commentItem: any) {
    if (!commentItem || !commentItem.comment) {
        return;
    }

    try {
        const reply = await vscode.window.showInputBox({
            prompt: 'Enter your reply',
            placeHolder: 'Type your reply here...',
            ignoreFocusOut: true
        });

        if (reply) {
            await azureDevOpsService.addCommentToThread(
                commentItem.pr.pullRequestId,
                commentItem.comment.threadId,
                reply
            );
            
            await prCommentsTreeDataProvider.refresh();
            vscode.window.showInformationMessage('Reply added successfully');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to reply to comment: ${error}`);
    }
}

async function resolveComment(commentItem: any) {
    if (!commentItem || !commentItem.comment) {
        return;
    }

    try {
        await azureDevOpsService.resolveThread(
            commentItem.pr.pullRequestId,
            commentItem.comment.threadId
        );
        
        await prCommentsTreeDataProvider.refresh();
        vscode.window.showInformationMessage('Comment thread resolved');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to resolve comment: ${error}`);
    }
}

async function replyToCommentInline(args: any) {
    try {
        const reply = await vscode.window.showInputBox({
            prompt: 'Enter your reply',
            placeHolder: 'Type your reply here...',
            ignoreFocusOut: true
        });

        if (reply) {
            await inlineCommentProvider.replyToThread(args.threadId, reply);
            commentCodeLensProvider.refresh();
            vscode.window.showInformationMessage('Reply added successfully');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to reply to comment: ${error}`);
    }
}

async function resolveCommentInline(args: any) {
    try {
        await inlineCommentProvider.resolveThread(args.threadId);
        commentCodeLensProvider.refresh();
        vscode.window.showInformationMessage('Comment thread resolved');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to resolve comment: ${error}`);
    }
}

async function showCommentThread(thread: any) {
    const message = thread.comments.map((c: any) => 
        `**${c.author.displayName}** (${new Date(c.publishedDate).toLocaleString()}):\n${c.content}`
    ).join('\n\n---\n\n');
    
    vscode.window.showInformationMessage(message, { modal: true });
}

async function addCommentAtLine() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const position = editor.selection.active;
    const lineNumber = position.line + 1; // Convert to 1-based

    const comment = await vscode.window.showInputBox({
        prompt: 'Enter your comment',
        placeHolder: 'Type your comment here...',
        ignoreFocusOut: true
    });

    if (comment) {
        try {
            const filePath = getRelativeFilePath(editor.document.uri);
            await inlineCommentProvider.addCommentAtLine(filePath, lineNumber, comment);
            commentCodeLensProvider.refresh();
            vscode.window.showInformationMessage('Comment added successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add comment: ${error}`);
        }
    }
}

async function refreshInlineComments() {
    inlineCommentProvider.refreshComments();
    commentCodeLensProvider.refresh();
    vscode.window.showInformationMessage('Inline comments refreshed');
}

async function jumpToLine(filePath: string, lineNumber: number) {
    try {
        // Find the file in the workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        // Construct full file path
        const fullPath = vscode.Uri.file(`${workspaceFolders[0].uri.fsPath}/${filePath}`);
        
        // Open the file
        const document = await vscode.workspace.openTextDocument(fullPath);
        const editor = await vscode.window.showTextDocument(document);
        
        // Jump to the line (convert to 0-based)
        const position = new vscode.Position(lineNumber - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
        
        vscode.window.showInformationMessage(`Jumped to line ${lineNumber}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to jump to line: ${error}`);
    }
}

function getRelativeFilePath(uri: vscode.Uri): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (workspaceFolder) {
        return uri.fsPath.substring(workspaceFolder.uri.fsPath.length + 1)
            .replace(/\\/g, '/');
    }
    return uri.fsPath.replace(/\\/g, '/');
}

function getLanguageFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: { [key: string]: string } = {
        'ts': 'typescript',
        'js': 'javascript',
        'py': 'python',
        'cs': 'csharp',
        'java': 'java',
        'json': 'json',
        'xml': 'xml',
        'html': 'html',
        'css': 'css',
        'md': 'markdown'
    };
    return languageMap[ext || ''] || 'plaintext';
}

export function deactivate() {
    if (contextMenuProvider) {
        contextMenuProvider.dispose();
    }
    console.log('Azure DevOps PR Viewer deactivated');
}
