import * as vscode from 'vscode';
import { AzureDevOpsService } from './services/azureDevOpsService';
import { PRTreeDataProvider, PRTreeItem } from './providers/prTreeDataProvider';
import { PRFilesTreeDataProvider } from './providers/prFilesTreeDataProvider';
import { PRCommentsTreeDataProvider } from './providers/prCommentsTreeDataProvider';
import { PRWebviewProvider } from './providers/prWebviewProvider';
import { AzureCliAuthProvider } from './auth/azureCliAuth';
import { EnhancedDiffProvider } from './providers/enhancedDiffProvider';
import { InlineCommentProvider } from './providers/inlineCommentProvider';
import { CommentCodeLensProvider } from './providers/commentCodeLensProvider';
import { SettingsWebviewProvider } from './providers/settingsWebviewProvider';
import { DiffService } from './services/diffService';
import { CommentChatWebviewProvider } from './providers/commentChatWebviewProvider';
import { DynamicCommandManager } from './services/dynamicCommandManager';

let azureDevOpsService: AzureDevOpsService;
let dynamicCommandManager: DynamicCommandManager;
let commentChatProvider: CommentChatWebviewProvider;
let settingsWebviewProvider: SettingsWebviewProvider;
let authProvider: AzureCliAuthProvider;
let prTreeDataProvider: PRTreeDataProvider;
let prFilesTreeDataProvider: PRFilesTreeDataProvider;
let prCommentsTreeDataProvider: PRCommentsTreeDataProvider;
let enhancedDiffProvider: EnhancedDiffProvider;
let inlineCommentProvider: InlineCommentProvider;
let commentCodeLensProvider: CommentCodeLensProvider;
let diffService: DiffService;
let extensionContext: vscode.ExtensionContext;

/**
 * Show an information message that auto-closes after the configured timeout
 * Uses status bar for non-critical success messages
 */
function showAutoCloseMessage(message: string): void {
    const config = vscode.workspace.getConfiguration('azureDevOpsPR');
    const timeout = config.get<number>('notificationTimeout', 3000);
    
    // Show in status bar with auto-close
    vscode.window.setStatusBarMessage(`$(check) ${message}`, timeout);
}

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    console.log('Azure DevOps PR Viewer is now active');

    // Initialize services with Azure CLI authentication
    authProvider = new AzureCliAuthProvider();
    azureDevOpsService = new AzureDevOpsService(authProvider);
    
    // Initialize dynamic command manager for mode-specific commands
    // This eliminates the need for context keys that can cause disposal errors
    dynamicCommandManager = new DynamicCommandManager();
    context.subscriptions.push(dynamicCommandManager);

    // Initialize enhanced diff provider
    enhancedDiffProvider = new EnhancedDiffProvider(azureDevOpsService);
    
    // Initialize inline comment provider (disabled by default)
    inlineCommentProvider = new InlineCommentProvider(azureDevOpsService);
    context.subscriptions.push(inlineCommentProvider);
    
    // Comment code lens provider is available but not registered by default
    // Users can enable it via settings if they prefer the old inline comment experience
    commentCodeLensProvider = new CommentCodeLensProvider(inlineCommentProvider);
    
    // Initialize tree data providers
    prTreeDataProvider = new PRTreeDataProvider(azureDevOpsService, context);
    prFilesTreeDataProvider = new PRFilesTreeDataProvider(azureDevOpsService);
    prCommentsTreeDataProvider = new PRCommentsTreeDataProvider(azureDevOpsService);
    
    // Set up context keys for mode visibility
    const setModeContext = (mode: 'people' | 'workitems' | 'manual') => {
        vscode.commands.executeCommand('setContext', 'azureDevOpsPR.mode', mode);
    };
    
    // Initialize with people mode
    setModeContext('people');
    
    // Initialize current level context
    prTreeDataProvider.updateLevelContext();

    // Initialize settings webview provider
    settingsWebviewProvider = new SettingsWebviewProvider(context);

    // Initialize comment chat webview provider as webview view (sidebar)
    commentChatProvider = new CommentChatWebviewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'azureDevOpsPRCommentChat',
            commentChatProvider
        )
    );
    
    // Set up comment handler for inline comment service
    commentChatProvider.setCommentSubmitHandler(async (reply: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }
        
        const selection = editor.selection;
        const startLine = selection.start.line + 1; // Convert to 1-based
        const endLine = selection.end.line + 1;
        const filePath = getRelativeFilePath(editor.document.uri);
        
        // Use the range-aware method
        await inlineCommentProvider.addCommentAtLineRange(filePath, startLine, endLine, reply);
        
        // Refresh inline comments to show the new comment bubble in the diff editor
        await inlineCommentProvider.refreshComments();
        commentCodeLensProvider.refresh();
        
        // Also refresh the comments tree view
        await prCommentsTreeDataProvider.refresh();
        
        const lineInfo = startLine === endLine 
            ? `line ${startLine}` 
            : `lines ${startLine}-${endLine}`;
        vscode.window.showInformationMessage(`✓ Comment added at ${lineInfo}`);
    });

    // Initialize diff service
    diffService = new DiffService(azureDevOpsService);

    // Register tree views with drag and drop support
    const prTreeView = vscode.window.createTreeView('azureDevOpsPRExplorer', {
        treeDataProvider: prTreeDataProvider,
        showCollapseAll: true,
        canSelectMany: false,
        dragAndDropController: prTreeDataProvider.dragAndDropController
    });
    
    // Register PR Files tree view
    const prFilesTreeView = vscode.window.createTreeView('azureDevOpsPRFiles', {
        treeDataProvider: prFilesTreeDataProvider,
        showCollapseAll: true
    });
    
    // Register PR Comments tree view
    const prCommentsTreeView = vscode.window.createTreeView('azureDevOpsPRComments', {
        treeDataProvider: prCommentsTreeDataProvider,
        showCollapseAll: true
    });
    
    // Add tree views to subscriptions
    context.subscriptions.push(prTreeView, prFilesTreeView, prCommentsTreeView);
    
    // Note: Checkboxes are not used in this implementation
    // We use visual indicators (⏳ and ✓) in the description instead
    
    // Define command callbacks for dynamic registration
    const modeCommandCallbacks = {
        createManualGroup: async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Enter group name',
                placeHolder: 'My Group',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Group name cannot be empty';
                    }
                    return null;
                }
            });
            if (name) {
                await prTreeDataProvider.createManualGroup(name.trim());
                vscode.window.showInformationMessage(`Created group: ${name}`);
            }
        },
        deleteAllManualGroups: async () => {
            const groups = prTreeDataProvider.getManualGroups();
            if (groups.length === 0) {
                vscode.window.showInformationMessage('No groups to delete');
                return;
            }

            const totalPRs = groups.reduce((sum, g) => sum + g.prIds.length, 0);
            const confirm = await vscode.window.showWarningMessage(
                `Delete all ${groups.length} group(s)?\n\nThis will unassign ${totalPRs} PR(s). This action cannot be undone.`,
                { modal: true },
                'Delete All', 'Cancel'
            );
            
            if (confirm === 'Delete All') {
                await prTreeDataProvider.deleteAllManualGroups();
                vscode.window.showInformationMessage(`Deleted ${groups.length} group(s), unassigned ${totalPRs} PR(s)`);
            }
        },
        selectWorkItemLevel: async () => {
            const currentLevel = prTreeDataProvider.getCurrentWorkItemLevel();
            
            const levelOptions = [
                {
                    label: '$(circle-outline) Level 0',
                    description: 'Group by directly linked work item',
                    level: 0
                },
                {
                    label: '$(circle-outline) Level 1',
                    description: 'Group by parent of work item (1 level up)',
                    level: 1
                },
                {
                    label: '$(circle-outline) Level 2',
                    description: 'Group by grandparent (2 levels up)',
                    level: 2
                },
                {
                    label: '$(circle-outline) Level 3',
                    description: 'Group by great-grandparent (3 levels up)',
                    level: 3
                },
                {
                    label: '$(circle-outline) Level 4',
                    description: 'Group by 4 levels up from work item',
                    level: 4
                }
            ];
            
            // Mark the current level with a filled circle
            levelOptions[currentLevel].label = `$(circle-filled) Level ${currentLevel} (Current)`;
            
            const selected = await vscode.window.showQuickPick(levelOptions, {
                placeHolder: `Select work item grouping level (Current: Level ${currentLevel})`,
                title: 'Work Item Grouping Level'
            });
            
            if (selected && selected.level !== currentLevel) {
                await prTreeDataProvider.setWorkItemLevel(selected.level);
                vscode.window.showInformationMessage(`✓ Work item grouping set to Level ${selected.level}`);
            }
        }
    };

    // Register mode-specific commands on startup so they're always available
    // (The dynamic manager approach was causing issues with menu visibility)
    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevOpsPR.createManualGroup', modeCommandCallbacks.createManualGroup),
        vscode.commands.registerCommand('azureDevOpsPR.deleteAllManualGroups', modeCommandCallbacks.deleteAllManualGroups),
        vscode.commands.registerCommand('azureDevOpsPR.selectWorkItemLevel', modeCommandCallbacks.selectWorkItemLevel),
        
        vscode.commands.registerCommand('azureDevOpsPR.groupByPeople', async () => {
            setModeContext('people');
            await prTreeDataProvider.setGroupingMode('people');
        }),
        
        vscode.commands.registerCommand('azureDevOpsPR.groupByWorkItems', async () => {
            setModeContext('workitems');
            await prTreeDataProvider.setGroupingMode('workitems');
        }),

        vscode.commands.registerCommand('azureDevOpsPR.groupByManual', async () => {
            setModeContext('manual');
            await prTreeDataProvider.setGroupingMode('manual');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevOpsPR.deleteManualGroup', async (item: PRTreeItem) => {
            if (item.manualGroupId) {
                const confirm = await vscode.window.showWarningMessage(
                    `Delete group "${item.label}"?`,
                    { modal: true },
                    'Delete', 'Cancel'
                );
                if (confirm === 'Delete') {
                    await prTreeDataProvider.deleteManualGroup(item.manualGroupId);
                    vscode.window.showInformationMessage('Group deleted');
                }
            }
        }),

        vscode.commands.registerCommand('azureDevOpsPR.renameManualGroup', async (item: PRTreeItem) => {
            if (item.manualGroupId) {
                const currentName = item.label?.toString().replace(/\s*\(\d+\)$/, '') || '';
                const newName = await vscode.window.showInputBox({
                    prompt: 'Enter new group name',
                    value: currentName,
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) {
                            return 'Group name cannot be empty';
                        }
                        return null;
                    }
                });
                if (newName && newName !== currentName) {
                    await prTreeDataProvider.renameManualGroup(item.manualGroupId, newName.trim());
                    vscode.window.showInformationMessage(`Group renamed to: ${newName}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevOpsPR.addToManualGroup', async (item: PRTreeItem) => {
            if (item.pr) {
                const groups = prTreeDataProvider.getManualGroups();
                
                if (groups.length === 0) {
                    const create = await vscode.window.showInformationMessage(
                        'No manual groups exist. Create one?',
                        'Create Group', 'Cancel'
                    );
                    if (create === 'Create Group') {
                        await vscode.commands.executeCommand('azureDevOpsPR.createManualGroup');
                    }
                    return;
                }
                
                const items = groups.map(g => ({ 
                    label: g.name,
                    description: `${g.prIds.length} PRs`,
                    group: g 
                }));
                
                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select group to add PR to'
                });
                
                if (selected) {
                    await prTreeDataProvider.addPRToManualGroup(item.pr.pullRequestId, selected.group.id);
                    vscode.window.showInformationMessage(`Added PR #${item.pr.pullRequestId} to ${selected.label}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevOpsPR.removeFromManualGroup', async (item: PRTreeItem) => {
            if (item.pr && item.manualGroupId) {
                await prTreeDataProvider.removePRFromManualGroup(item.pr.pullRequestId, item.manualGroupId);
                vscode.window.showInformationMessage(`Removed PR from group`);
            }
        })
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('azureDevOpsPR.authenticate', async () => {
            await authProvider.promptLogin();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.refreshPRs', async () => {
            await refreshPRs();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.refreshPRFiles', async () => {
            await refreshPRFiles();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.refreshPRComments', async () => {
            await refreshPRCommentsView();
        }),

        vscode.commands.registerCommand('azureDevOpsPR.toggleCommentsGrouping', async () => {
            prCommentsTreeDataProvider.toggleGrouping();
            const mode = prCommentsTreeDataProvider.getGroupingMode();
            vscode.window.showInformationMessage(`Comments grouped by ${mode === 'file' ? 'File' : 'People'}`);
        }),

        vscode.commands.registerCommand('azureDevOpsPR.refreshCommentChat', async () => {
            await refreshCommentChat();
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

        vscode.commands.registerCommand('azureDevOpsPR.jumpToCommentInDiff', async (args) => {
            await jumpToCommentInDiff(args);
        }),


        vscode.commands.registerCommand('azureDevOpsPR.clearAllToggles', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Clear all "Pending My Review" and "Reviewed by Me" toggles?',
                { modal: true },
                'Clear All', 'Cancel'
            );
            
            if (confirm === 'Clear All') {
                const count = prTreeDataProvider.clearAllToggles();
                vscode.window.showInformationMessage(`✓ Cleared ${count} review toggle(s)`);
            }
        }),

        vscode.commands.registerCommand('azureDevOpsPR.openCommentChat', async (args: any) => {
            if (!args || !args.thread || !args.pr) {
                return;
            }

            try {
                // Get current user info
                const currentUser = await azureDevOpsService.getCurrentUser();
                const currentUserId = currentUser?.id || '';

                // Convert CommentThread to format expected by chat provider
                const comments = args.thread.comments.map((c: any) => ({
                    author: c.author?.displayName || 'Unknown',
                    content: c.content || '',
                    date: new Date(c.publishedDate || Date.now()),
                    isCurrentUser: c.author?.uniqueName === currentUser?.emailAddress
                }));

                // Build title
                const fileName = args.filePath?.split('/').pop() || 'Comment';
                const lineNumber = args.lineNumber || args.thread.lineStart;
                const title = `💬 ${fileName} (Line ${lineNumber})`;

                // Show chat interface
                await commentChatProvider.show(
                    comments,
                    title,
                    async (reply: string) => {
                        await azureDevOpsService.addCommentToThread(
                            args.pr.pullRequestId,
                            args.thread.id,
                            reply
                        );
                        await prCommentsTreeDataProvider.refresh();
                        await inlineCommentProvider.refreshComments();
                    },
                    args.thread.id,
                    args.thread.status === 2 // 2 = Fixed/Resolved in Azure DevOps
                );

                // Set resolve handler
                commentChatProvider['onResolve'] = async () => {
                    await azureDevOpsService.resolveThread(
                        args.pr.pullRequestId,
                        args.thread.id
                    );
                    await prCommentsTreeDataProvider.refresh();
                    await inlineCommentProvider.refreshComments();
                };
            } catch (error) {
                console.error('Failed to open comment chat:', error);
                vscode.window.showErrorMessage(`Failed to open comment chat: ${error}`);
            }
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
        // Cascade refresh to PR Files, Comments, and Comment Chat
        await prFilesTreeDataProvider.refresh();
        await prCommentsTreeDataProvider.refresh();
        await inlineCommentProvider.refreshComments();
        vscode.window.showInformationMessage('Pull requests refreshed');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh PRs: ${error}`);
    }
}

async function refreshPRFiles() {
    try {
        await prFilesTreeDataProvider.refresh();
        // Cascade refresh to Comments and Comment Chat
        await prCommentsTreeDataProvider.refresh();
        await inlineCommentProvider.refreshComments();
        vscode.window.showInformationMessage('PR files refreshed');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh PR files: ${error}`);
    }
}

async function refreshPRCommentsView() {
    try {
        await prCommentsTreeDataProvider.refresh();
        await inlineCommentProvider.refreshComments();
        vscode.window.showInformationMessage('Comments refreshed');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh comments: ${error}`);
    }
}

async function refreshCommentChat() {
    try {
        // Refresh the current chat view (it will reload based on current selection/context)
        await inlineCommentProvider.refreshComments();
        commentCodeLensProvider.refresh();
        vscode.window.showInformationMessage('Comment chat refreshed');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh comment chat: ${error}`);
    }
}

async function openPR(prItem: any, fromContextMenu: boolean = false) {
    if (!prItem) {
        return;
    }

    try {
        const sourceBranch = prItem.pr.sourceRefName.replace('refs/heads/', '');
        
        // Always show confirmation with window closing info
        const message = fromContextMenu
            ? `Open PR #${prItem.pr.pullRequestId}?\n\nThis will:\n• Close all open editor windows\n• Fetch and checkout branch '${sourceBranch}'\n• Load PR files and comments`
            : `Opening PR #${prItem.pr.pullRequestId} will close all open editor windows.\n\nContinue?`;
            
        const confirm = await vscode.window.showInformationMessage(
            message,
            { modal: true },
            'Open PR',
            'Cancel'
        );
        
        if (confirm !== 'Open PR') {
            return;
        }
        
        // Close all open editors
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        
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
    
    // Fetch the branch from origin
    await repo.fetch('origin', sourceBranch);
    
    // Checkout the branch
    await repo.checkout(sourceBranch);
    
    // Pull latest changes
    await repo.pull();
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

// Track files currently being opened to prevent double-clicks
const filesBeingOpened = new Set<string>();

async function viewFile(fileItem: any) {
    if (!fileItem || !fileItem.file) {
        return;
    }

    const fileKey = `${fileItem.pr.pullRequestId}-${fileItem.file.path}`;
    
    // Check if this file is already being opened
    if (filesBeingOpened.has(fileKey)) {
        vscode.window.showInformationMessage(
            `Opening ${fileItem.file.path.split('/').pop()}... Please wait.`
        );
        return;
    }

    // Mark file as being opened
    filesBeingOpened.add(fileKey);

    try {
        // Show progress notification
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Opening ${fileItem.file.path.split('/').pop()}`,
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Loading diff...' });
            
            try {
                // Use diff service to show side-by-side comparison
                await diffService.openDiff(fileItem.pr, fileItem.file);
            } catch (error) {
                throw error; // Will be caught by outer try-catch
            }
        });
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
    } finally {
        // Always remove from the set when done
        filesBeingOpened.delete(fileKey);
    }
}

async function addComment(fileItem: any) {
    if (!fileItem || !fileItem.file) {
        return;
    }

    try {
        const fileName = fileItem.file.path.split('/').pop() || 'File';
        await commentChatProvider.showForNewComment(
            `Add Comment - ${fileName}`,
            async (comment: string) => {
                await azureDevOpsService.addComment(
                    fileItem.pr.pullRequestId,
                    comment,
                    fileItem.file.path
                );
                await prCommentsTreeDataProvider.refresh();
                vscode.window.showInformationMessage('Comment added successfully');
            }
        );
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
    if (!commentItem || !commentItem.thread) {
        vscode.window.showErrorMessage('Invalid comment item - no thread data');
        return;
    }

    try {
        const thread = commentItem.thread;
        const threadId = thread.id;
        
        if (!threadId) {
            vscode.window.showErrorMessage('Thread ID not found');
            return;
        }

        // Get current user info
        const currentUser = await azureDevOpsService.getCurrentUser();
        const currentUserId = currentUser?.id || '';

        // Format comments for chat interface
        const comments = thread.comments.map((c: any) => ({
            author: c.author?.displayName || 'Unknown',
            content: c.content || '',
            date: new Date(c.publishedDate || Date.now()),
            isCurrentUser: c.author?.id === currentUserId
        }));

        // Show chat interface with better title including line info
        const fileName = thread.threadContext?.filePath?.split('/').pop() || 'Comment';
        const lineNumber = thread.threadContext?.rightFileStart?.line;
        const titleSuffix = lineNumber ? ` (Line ${lineNumber})` : '';
        
        await commentChatProvider.show(
            comments,
            `💬 ${fileName}${titleSuffix}`,
            async (reply: string) => {
                await azureDevOpsService.addCommentToThread(
                    commentItem.pr.pullRequestId,
                    threadId,
                    reply
                );
                await prCommentsTreeDataProvider.refresh();
            },
            threadId,
            thread.status === 2 // 2 = Fixed/Resolved in Azure DevOps
        );
        
        // Set resolve handler
        commentChatProvider['onResolve'] = async () => {
            await azureDevOpsService.resolveThread(
                commentItem.pr.pullRequestId,
                threadId
            );
            await prCommentsTreeDataProvider.refresh();
        };
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to open comment chat: ${error}`);
        console.error('Reply to comment error:', error);
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
    
    // Build title with context
    const filePath = getRelativeFilePath(editor.document.uri);
    const fileName = filePath.split('/').pop() || 'File';
    const lineRange = startLine === endLine 
        ? `Line ${startLine}` 
        : `Lines ${startLine}-${endLine}`;
    
    const title = hasSelection 
        ? `${fileName} - ${lineRange}\n"${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}"`
        : `${fileName} - ${lineRange}`;

    try {
        await commentChatProvider.showForNewComment(
            title,
            async (comment: string) => {
                await inlineCommentProvider.addCommentAtLine(filePath, startLine, comment);
                commentCodeLensProvider.refresh();
                
                const lineInfo = startLine === endLine 
                    ? `line ${startLine}` 
                    : `lines ${startLine}-${endLine}`;
                vscode.window.showInformationMessage(`Comment added at ${lineInfo}`);
            }
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to add comment: ${error}`);
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

async function jumpToCommentInDiff(args: any) {
    if (!args || !args.pr || !args.filePath) {
        vscode.window.showWarningMessage('Invalid comment location');
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

        // Get the current branch (should be the PR source branch)
        const currentBranch = repo.state.HEAD?.name;
        const sourceBranch = args.pr.sourceRefName.replace('refs/heads/', '');
        
        // Check if we're on the PR branch
        if (currentBranch !== sourceBranch) {
            const switchBranch = await vscode.window.showWarningMessage(
                `You're on branch '${currentBranch}', but the comment is on '${sourceBranch}'. Switch to PR branch?`,
                'Switch Branch', 'Cancel'
            );
            
            if (switchBranch === 'Switch Branch') {
                try {
                    await repo.checkout(sourceBranch);
                    vscode.window.showInformationMessage(`Switched to branch '${sourceBranch}'`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to switch branch: ${error}`);
                    return;
                }
            } else {
                // User cancelled - this is normal, not an error
                return;
            }
        }

        // Normalize file path - use the same logic as inlineCommentProvider
        const gitRoot = repo.rootUri;
        let normalizedPath = args.filePath.startsWith('/') 
            ? args.filePath.substring(1) 
            : args.filePath;
        
        // Remove repo name if present in path (Azure DevOps sometimes includes it)
        const gitRootName = gitRoot.path.split('/').pop();
        if (gitRootName && normalizedPath.startsWith(gitRootName + '/')) {
            normalizedPath = normalizedPath.substring(gitRootName.length + 1);
        }
        
        console.log(`[JumpToComment] Original path: ${args.filePath}`);
        console.log(`[JumpToComment] Normalized path: ${normalizedPath}`);
        console.log(`[JumpToComment] Git root: ${gitRoot.fsPath}`);
        
        // Construct the file URI
        const fileUri = vscode.Uri.joinPath(gitRoot, normalizedPath);
        console.log(`[JumpToComment] Full file URI: ${fileUri.toString()}`);
        
        // Check if file exists
        try {
            await vscode.workspace.fs.stat(fileUri);
        } catch (statError) {
            console.error(`[JumpToComment] File not found at: ${fileUri.fsPath}`);
            console.error(`[JumpToComment] Stat error:`, statError);
            vscode.window.showErrorMessage(`File not found: ${normalizedPath}\n\nTried: ${fileUri.fsPath}`);
            return;
        }
        
        // Open the file
        const document = await vscode.workspace.openTextDocument(fileUri);
        const editor = await vscode.window.showTextDocument(document);
        
        // Jump to the line
        if (args.lineNumber) {
            const position = new vscode.Position(args.lineNumber - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
        }

        // If there's a thread, open the comment chat
        if (args.thread) {
            const thread = args.thread;
            const currentUser = await azureDevOpsService.getCurrentUser();
            const currentUserId = currentUser?.id || '';

            // Format comments for chat interface
            const comments = thread.comments.map((c: any) => ({
                author: c.author?.displayName || 'Unknown',
                content: c.content || '',
                date: new Date(c.publishedDate || Date.now()),
                isCurrentUser: c.author?.id === currentUserId
            }));

            // Show chat interface
            const fileName = normalizedPath.split('/').pop() || 'Comment';
            await commentChatProvider.show(
                comments,
                `${fileName} - Line ${args.lineNumber}`,
                async (reply: string) => {
                    await azureDevOpsService.addCommentToThread(
                        args.pr.pullRequestId,
                        thread.id,
                        reply
                    );
                    await prCommentsTreeDataProvider.refresh();
                },
                thread.id,
                thread.status === 2 || thread.status === 'fixed' || thread.status === 'closed'
            );
        }
    } catch (error) {
        console.error('[JumpToComment] Failed to jump to comment:', error);
        vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
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
