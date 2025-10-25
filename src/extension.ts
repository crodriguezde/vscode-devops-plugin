import * as vscode from 'vscode';
import { AzureDevOpsService } from './services/azureDevOpsService';
import { PRTreeDataProvider } from './providers/prTreeDataProvider';
import { PRFilesTreeDataProvider } from './providers/prFilesTreeDataProvider';
import { PRCommentsTreeDataProvider } from './providers/prCommentsTreeDataProvider';
import { PRWebviewProvider } from './providers/prWebviewProvider';
import { AzureCliAuthProvider } from './auth/azureCliAuth';
import { EnhancedDiffProvider } from './providers/enhancedDiffProvider';
import { InlineCommentProvider } from './providers/inlineCommentProvider';
import { CommentCodeLensProvider } from './providers/commentCodeLensProvider';
import { SettingsWebviewProvider } from './providers/settingsWebviewProvider';
import { DiffService } from './services/diffService';

let azureDevOpsService: AzureDevOpsService;
let settingsWebviewProvider: SettingsWebviewProvider;
let authProvider: AzureCliAuthProvider;
let prTreeDataProvider: PRTreeDataProvider;
let prFilesTreeDataProvider: PRFilesTreeDataProvider;
let prCommentsTreeDataProvider: PRCommentsTreeDataProvider;
let enhancedDiffProvider: EnhancedDiffProvider;
let inlineCommentProvider: InlineCommentProvider;
let commentCodeLensProvider: CommentCodeLensProvider;
let diffService: DiffService;

export function activate(context: vscode.ExtensionContext) {
    console.log('Azure DevOps PR Viewer is now active');

    // Initialize services with Azure CLI authentication
    authProvider = new AzureCliAuthProvider();
    azureDevOpsService = new AzureDevOpsService(authProvider);

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
    prTreeDataProvider = new PRTreeDataProvider(azureDevOpsService, context);
    prFilesTreeDataProvider = new PRFilesTreeDataProvider(azureDevOpsService);
    prCommentsTreeDataProvider = new PRCommentsTreeDataProvider(azureDevOpsService);

    // Initialize settings webview provider
    settingsWebviewProvider = new SettingsWebviewProvider(context);

    // Initialize diff service
    diffService = new DiffService(azureDevOpsService);

    // Register tree views
    const prTreeView = vscode.window.createTreeView('azureDevOpsPRExplorer', {
        treeDataProvider: prTreeDataProvider,
        showCollapseAll: true,
        canSelectMany: false
    });
    
    // Note: Checkboxes are not used in this implementation
    // We use visual indicators (⏳ and ✓) in the description instead
    
    context.subscriptions.push(
        prTreeView,
        vscode.window.registerTreeDataProvider('azureDevOpsPRFiles', prFilesTreeDataProvider),
        vscode.window.registerTreeDataProvider('azureDevOpsPRComments', prCommentsTreeDataProvider)
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevOpsPR.authenticate', async () => {
            await authProvider.promptLogin();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.refreshPRs', async () => {
            await refreshPRs();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.openPR', async (prItem, fromContextMenu = false) => {
            await openPR(prItem, fromContextMenu);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.openPRFromContext', async (prItem) => {
            await openPR(prItem, true);
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
        }),

        vscode.commands.registerCommand('azureDevOpsPR.viewFileCommitDiff', async (commitItem) => {
            await viewFileCommitDiff(commitItem);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.togglePendingMyReview', async (prItem) => {
            if (prItem && prItem.pr) {
                prTreeDataProvider.togglePendingMyReview(prItem.pr.pullRequestId);
                const isPending = prTreeDataProvider.isPendingMyReview(prItem.pr.pullRequestId);
                vscode.window.showInformationMessage(
                    `PR #${prItem.pr.pullRequestId} ${isPending ? 'marked as' : 'removed from'} Pending My Review`
                );
            }
        }),

        vscode.commands.registerCommand('azureDevOpsPR.toggleReviewedByMe', async (prItem) => {
            if (prItem && prItem.pr) {
                prTreeDataProvider.toggleReviewedByMe(prItem.pr.pullRequestId);
                const isReviewed = prTreeDataProvider.isReviewedByMe(prItem.pr.pullRequestId);
                vscode.window.showInformationMessage(
                    `PR #${prItem.pr.pullRequestId} ${isReviewed ? 'marked as' : 'unmarked from'} Reviewed by Me`
                );
            }
        }),

        vscode.commands.registerCommand('azureDevOpsPR.debugWorkItems', async (prItem) => {
            console.log('[DEBUG] Debug Work Items command triggered');
            console.log('[DEBUG] prItem:', prItem);
            
            if (!prItem) {
                vscode.window.showErrorMessage('No PR item provided to debug command');
                return;
            }
            
            if (!prItem.pr) {
                vscode.window.showErrorMessage('PR item does not contain PR data');
                return;
            }
            
            try {
                const prId = prItem.pr.pullRequestId;
                console.log(`[DEBUG] Starting debug for PR #${prId}`);
                
                vscode.window.showInformationMessage(`Debugging PR #${prId}...`);
                
                const workItems = await azureDevOpsService.getWorkItemsForPR(prId);
                console.log(`[DEBUG] PR #${prId} work items:`, JSON.stringify(workItems, null, 2));
                
                if (!workItems || workItems.length === 0) {
                    vscode.window.showWarningMessage(`PR #${prId} has NO work items linked.\n\nThis is why it shows under "Unknown Work Item".\n\nSolution: Link work items to this PR in Azure DevOps.`, { modal: true });
                    return;
                }
                
                const workItemId = parseInt(workItems[0].id);
                console.log(`[DEBUG] Fetching work item ${workItemId} details...`);
                
                const details = await azureDevOpsService.getWorkItemDetails(workItemId);
                console.log(`[DEBUG] Work item ${workItemId} details:`, JSON.stringify(details, null, 2));
                
                console.log(`[DEBUG] Fetching parent for work item ${workItemId}...`);
                const parent = await azureDevOpsService.getWorkItemParent(workItemId);
                console.log(`[DEBUG] Work item ${workItemId} parent:`, JSON.stringify(parent, null, 2));
                
                let message = `🔍 PR #${prId} Debug Info\n\n`;
                message += `Work Items Linked: ${workItems.length}\n`;
                message += `First Work Item: #${workItemId}\n`;
                message += `  Title: ${details?.title || 'Unknown'}\n`;
                message += `  Type: ${details?.type || 'Unknown'}\n\n`;
                message += `Parent Work Item: ${parent ? `#${parent.id}\n  Title: ${parent.title}` : 'None (will use work item itself as group)'}\n\n`;
                message += `Check Output panel (View → Output → "Extension Host") for detailed JSON logs.`;
                
                vscode.window.showInformationMessage(message, { modal: true });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Debug failed: ${errorMessage}\n\nCheck Output panel for details.`, { modal: true });
                console.error('[DEBUG] Error:', error);
            }
        }),

        vscode.commands.registerCommand('azureDevOpsPR.groupByPeople', async () => {
            await prTreeDataProvider.setGroupingMode('people');
        }),

        vscode.commands.registerCommand('azureDevOpsPR.groupByWorkItems', async () => {
            await prTreeDataProvider.setGroupingMode('workitems');
        })
    );

    // Auto-refresh on activation if configured
    const config = vscode.workspace.getConfiguration('azureDevOpsPR');
    if (config.get('autoRefresh')) {
        refreshPRs();
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

async function openPR(prItem: any, fromContextMenu: boolean = false) {
    if (!prItem) {
        return;
    }

    try {
        const sourceBranch = prItem.pr.sourceRefName.replace('refs/heads/', '');
        
        // Only show confirmation if opened from context menu
        if (fromContextMenu) {
            const confirm = await vscode.window.showInformationMessage(
                `Open PR #${prItem.pr.pullRequestId}? This will fetch and checkout branch '${sourceBranch}'.`,
                { modal: true },
                'Open PR',
                'Cancel'
            );
            
            if (confirm !== 'Open PR') {
                return;
            }
        }
        
        // Show progress
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Opening PR #${prItem.pr.pullRequestId}`,
            cancellable: false
        }, async (progress) => {
            // Step 1: Fetch from origin
            progress.report({ message: 'Fetching latest changes from origin...' });
            await fetchAndCheckoutBranch(prItem.pr);
            
            // Step 2: Load PR details
            progress.report({ message: 'Loading PR files and comments...' });
            await prFilesTreeDataProvider.loadPR(prItem.pr);
            await prCommentsTreeDataProvider.loadPR(prItem.pr);
            
            // Step 3: Load inline comments
            progress.report({ message: 'Loading inline comments...' });
            await inlineCommentProvider.loadCommentsForPR(prItem.pr);
        });
        
        vscode.window.showInformationMessage(
            `✓ Opened PR #${prItem.pr.pullRequestId} on branch '${sourceBranch}'`
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to open PR: ${error}`);
    }
}

async function fetchAndCheckoutBranch(pr: any): Promise<void> {
    const sourceBranch = pr.sourceRefName.replace('refs/heads/', '');
    
    // Check if workspace has a git repository
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace folder open');
    }

    // Use the Git extension API
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
        throw new Error('Git extension not available');
    }
    
    const git = gitExtension.exports.getAPI(1);
    const repo = git.repositories[0];
    
    if (!repo) {
        throw new Error('No git repository found');
    }
    
    try {
        // Fetch the branch from origin
        await repo.fetch('origin', sourceBranch);
        
        // Checkout the branch
        await repo.checkout(sourceBranch);
        
        // Pull latest changes
        await repo.pull();
    } catch (error) {
        throw new Error(`Failed to checkout branch: ${error}`);
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
        // Use diff service to show side-by-side comparison
        await diffService.openDiff(fileItem.pr, fileItem.file);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to view file diff: ${error}`);
        
        // Fallback to viewing just the modified file
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
        } catch (fallbackError) {
            vscode.window.showErrorMessage(`Failed to view file: ${fallbackError}`);
        }
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

    const selection = editor.selection;
    const startLine = selection.start.line + 1; // Convert to 1-based
    const endLine = selection.end.line + 1;
    
    // Get selected text if any
    const selectedText = editor.document.getText(selection);
    const hasSelection = !selection.isEmpty && selectedText.trim().length > 0;
    
    // Build prompt with context
    let prompt = 'Enter your comment';
    let placeholder = 'Type your comment here...';
    
    if (hasSelection) {
        const lineRange = startLine === endLine 
            ? `line ${startLine}` 
            : `lines ${startLine}-${endLine}`;
        prompt = `Comment on ${lineRange}`;
        placeholder = `Comment about: "${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}"`;
    }

    const comment = await vscode.window.showInputBox({
        prompt,
        placeHolder: placeholder,
        ignoreFocusOut: true,
        value: hasSelection ? `Re: "${selectedText.trim()}"\n\n` : undefined
    });

    if (comment) {
        try {
            const filePath = getRelativeFilePath(editor.document.uri);
            // Use start line for the comment position
            await inlineCommentProvider.addCommentAtLine(filePath, startLine, comment);
            commentCodeLensProvider.refresh();
            
            const lineInfo = startLine === endLine 
                ? `line ${startLine}` 
                : `lines ${startLine}-${endLine}`;
            vscode.window.showInformationMessage(`Comment added at ${lineInfo}`);
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
        // Get Git extension to find git root
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (!gitExtension) {
            vscode.window.showWarningMessage('Git extension not available');
            return;
        }

        const git = gitExtension.exports.getAPI(1);
        const repo = git.repositories[0];
        
        if (!repo) {
            vscode.window.showWarningMessage('No git repository found');
            return;
        }

        // Get the git repository root
        const gitRoot = repo.rootUri;
        
        // Normalize the file path (remove leading slashes)
        const normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
        
        // The file path may include the repository name - remove it if present
        let relativePath = normalizedPath;
        const gitRootName = gitRoot.path.split('/').pop();
        if (gitRootName && relativePath.startsWith(gitRootName + '/')) {
            relativePath = relativePath.substring(gitRootName.length + 1);
        }
        
        // Construct path relative to git root
        const documentUri = vscode.Uri.joinPath(gitRoot, relativePath);
        
        // Check if file exists before trying to open
        try {
            await vscode.workspace.fs.stat(documentUri);
        } catch {
            vscode.window.showWarningMessage(`File not found: ${relativePath}`);
            return;
        }
        
        // Open the file
        const document = await vscode.workspace.openTextDocument(documentUri);
        const editor = await vscode.window.showTextDocument(document);
        
        // Jump to the line (convert to 0-based)
        const position = new vscode.Position(lineNumber - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
        
        vscode.window.showInformationMessage(`Jumped to line ${lineNumber} in ${relativePath.split('/').pop()}`);
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

async function viewFileCommitDiff(commitItem: any) {
    if (!commitItem || !commitItem.commit || !commitItem.file) {
        vscode.window.showErrorMessage('Invalid commit item');
        return;
    }

    try {
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

        const gitRoot = repo.rootUri;
        const commit = commitItem.commit;
        
        // Normalize file path
        let normalizedPath = commitItem.file.path.startsWith('/') 
            ? commitItem.file.path.substring(1) 
            : commitItem.file.path;
        
        // Remove repo name if present
        const gitRootName = gitRoot.path.split('/').pop();
        if (gitRootName && normalizedPath.startsWith(gitRootName + '/')) {
            normalizedPath = normalizedPath.substring(gitRootName.length + 1);
        }
        
        const fullPath = vscode.Uri.joinPath(gitRoot, normalizedPath);
        
        // Get previous commit (parent)
        const previousCommitId = commit.parents && commit.parents.length > 0 
            ? commit.parents[0] 
            : commit.commitId + '^';
        
        // Create URIs for diff
        const previousUri = await repo.toGitUri(fullPath, previousCommitId);
        const currentUri = await repo.toGitUri(fullPath, commit.commitId);
        
        // Open diff
        const shortHash = commit.commitId.substring(0, 7);
        const fileName = normalizedPath.split('/').pop();
        const title = `${fileName} (${previousCommitId.substring(0, 7)} ↔ ${shortHash})`;
        
        await vscode.commands.executeCommand(
            'vscode.diff',
            previousUri,
            currentUri,
            title,
            { preview: false }
        );
    } catch (error) {
        console.error('Failed to view commit diff:', error);
        vscode.window.showErrorMessage(`Failed to view commit diff: ${error}`);
    }
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
    console.log('Azure DevOps PR Viewer deactivated');
}
