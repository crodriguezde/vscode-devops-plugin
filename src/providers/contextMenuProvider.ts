import * as vscode from 'vscode';
import { ClineWorkflowService } from '../services/clineWorkflowService';
import { PullRequest } from '../types';

export class ContextMenuProvider {
    private clineWorkflowService: ClineWorkflowService;
    private disposables: vscode.Disposable[] = [];

    constructor(clineWorkflowService: ClineWorkflowService) {
        this.clineWorkflowService = clineWorkflowService;
    }

    public registerPRContextMenus(context: vscode.ExtensionContext): void {
        // Register commands for each workflow
        const workflows = this.clineWorkflowService.getAvailableWorkflows();

        workflows.forEach(workflow => {
            const commandId = `azureDevOpsPR.workflow.${workflow.name}`;
            
            const command = vscode.commands.registerCommand(commandId, async (prItem: any) => {
                await this.handleWorkflowExecution(prItem, workflow.name);
            });

            this.disposables.push(command);
            context.subscriptions.push(command);
        });

        // Register the main workflow menu command
        const workflowMenuCommand = vscode.commands.registerCommand(
            'azureDevOpsPR.showWorkflowMenu',
            async (prItem: any) => {
                await this.showWorkflowSelectionMenu(prItem);
            }
        );

        this.disposables.push(workflowMenuCommand);
        context.subscriptions.push(workflowMenuCommand);

        // Register configure workflows command
        const configureCommand = vscode.commands.registerCommand(
            'azureDevOpsPR.configureWorkflows',
            async () => {
                await this.configureWorkflows();
            }
        );

        this.disposables.push(configureCommand);
        context.subscriptions.push(configureCommand);
    }

    private async handleWorkflowExecution(prItem: any, workflowName: string): Promise<void> {
        if (!prItem || !prItem.pr) {
            vscode.window.showErrorMessage('No pull request selected');
            return;
        }

        if (!this.clineWorkflowService.isEnabled()) {
            const action = await vscode.window.showWarningMessage(
                'Cline workflow integration is not enabled. Would you like to enable it now?',
                'Enable',
                'Cancel'
            );

            if (action === 'Enable') {
                await this.enableClineIntegration();
                return;
            }
            return;
        }

        const pr: PullRequest = prItem.pr;

        // Show progress notification
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Starting workflow for PR #${pr.pullRequestId}`,
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Preparing workflow context...' });
            
            const result = await this.clineWorkflowService.executeWorkflow(workflowName, pr);

            if (result.success) {
                vscode.window.showInformationMessage(
                    result.message || 'Workflow started successfully'
                );
            } else {
                vscode.window.showErrorMessage(
                    result.error || 'Failed to start workflow'
                );
            }
        });
    }

    private async showWorkflowSelectionMenu(prItem: any): Promise<void> {
        if (!prItem || !prItem.pr) {
            vscode.window.showErrorMessage('No pull request selected');
            return;
        }

        if (!this.clineWorkflowService.isEnabled()) {
            const action = await vscode.window.showWarningMessage(
                'Cline workflow integration is not enabled. Would you like to enable it now?',
                'Enable',
                'Cancel'
            );

            if (action === 'Enable') {
                await this.enableClineIntegration();
                return;
            }
            return;
        }

        const workflows = this.clineWorkflowService.getAvailableWorkflows();

        if (workflows.length === 0) {
            vscode.window.showInformationMessage(
                'No workflows are currently enabled. Configure workflows in settings.'
            );
            return;
        }

        // Create quick pick items
        const items = workflows.map(workflow => ({
            label: `$(${workflow.icon || 'tools'}) ${workflow.displayName}`,
            description: workflow.description,
            workflow: workflow
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a Cline workflow to execute',
            matchOnDescription: true
        });

        if (selected) {
            await this.handleWorkflowExecution(prItem, selected.workflow.name);
        }
    }

    private async enableClineIntegration(): Promise<void> {
        const config = vscode.workspace.getConfiguration('azureDevOpsPR.clineIntegration');
        await config.update('enabled', true, vscode.ConfigurationTarget.Global);
        
        this.clineWorkflowService.refreshConfig();
        
        vscode.window.showInformationMessage(
            'Cline integration enabled. You can now use workflows with your pull requests.'
        );
    }

    private async configureWorkflows(): Promise<void> {
        const options = [
            {
                label: '$(gear) Open Workflow Settings',
                description: 'Configure workflow integration settings',
                action: 'settings'
            },
            {
                label: '$(folder) Set Workflow Path',
                description: 'Set path to custom workflow definitions',
                action: 'path'
            },
            {
                label: '$(checklist) Manage Enabled Workflows',
                description: 'Enable or disable specific workflows',
                action: 'manage'
            },
            {
                label: this.clineWorkflowService.isEnabled() 
                    ? '$(close) Disable Integration' 
                    : '$(check) Enable Integration',
                description: 'Toggle Cline workflow integration',
                action: 'toggle'
            }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Configure Cline Workflow Integration'
        });

        if (!selected) {
            return;
        }

        switch (selected.action) {
            case 'settings':
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'azureDevOpsPR.clineIntegration'
                );
                break;

            case 'path':
                await this.configureWorkflowPath();
                break;

            case 'manage':
                await this.manageEnabledWorkflows();
                break;

            case 'toggle':
                await this.toggleIntegration();
                break;
        }
    }

    private async configureWorkflowPath(): Promise<void> {
        const currentPath = vscode.workspace.getConfiguration('azureDevOpsPR.clineIntegration')
            .get<string>('workflowPath', '');

        const path = await vscode.window.showInputBox({
            prompt: 'Enter path to custom workflow definitions',
            value: currentPath,
            placeHolder: 'e.g., .cline/workflows or /absolute/path/to/workflows',
            validateInput: (value) => {
                if (!value) {
                    return 'Path cannot be empty';
                }
                return null;
            }
        });

        if (path !== undefined) {
            const config = vscode.workspace.getConfiguration('azureDevOpsPR.clineIntegration');
            await config.update('workflowPath', path, vscode.ConfigurationTarget.Global);
            
            // Validate the path
            const isValid = await this.clineWorkflowService.validateWorkflowPath();
            if (!isValid) {
                vscode.window.showWarningMessage(
                    `Warning: The workflow path '${path}' does not exist.`
                );
            } else {
                this.clineWorkflowService.refreshConfig();
                vscode.window.showInformationMessage('Workflow path updated successfully');
            }
        }
    }

    private async manageEnabledWorkflows(): Promise<void> {
        const allWorkflows = [
            'review-pr',
            'analyze-code',
            'security-scan',
            'generate-tests'
        ];

        const config = vscode.workspace.getConfiguration('azureDevOpsPR.clineIntegration');
        const currentEnabled = config.get<string[]>('enabledWorkflows', []);

        const items = allWorkflows.map(workflow => ({
            label: workflow,
            description: currentEnabled.includes(workflow) ? 'Currently enabled' : 'Currently disabled',
            picked: currentEnabled.includes(workflow)
        }));

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: 'Select workflows to enable'
        });

        if (selected) {
            const enabledWorkflows = selected.map(item => item.label);
            await config.update('enabledWorkflows', enabledWorkflows, vscode.ConfigurationTarget.Global);
            
            this.clineWorkflowService.refreshConfig();
            vscode.window.showInformationMessage(
                `Updated enabled workflows (${enabledWorkflows.length} enabled)`
            );
        }
    }

    private async toggleIntegration(): Promise<void> {
        const config = vscode.workspace.getConfiguration('azureDevOpsPR.clineIntegration');
        const currentState = config.get<boolean>('enabled', false);
        
        await config.update('enabled', !currentState, vscode.ConfigurationTarget.Global);
        this.clineWorkflowService.refreshConfig();
        
        vscode.window.showInformationMessage(
            `Cline integration ${!currentState ? 'enabled' : 'disabled'}`
        );
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
