import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { WorkflowDefinition, WorkflowContext, WorkflowResult, ClineWorkflowConfig } from '../types/clineTypes';
import { PullRequest } from '../types';

export class ClineWorkflowService {
    private config: ClineWorkflowConfig;
    private workflowDefinitions: Map<string, WorkflowDefinition> = new Map();

    constructor() {
        this.config = this.loadConfig();
        this.loadWorkflowDefinitions();
    }

    private loadConfig(): ClineWorkflowConfig {
        const config = vscode.workspace.getConfiguration('azureDevOpsPR.clineIntegration');
        return {
            enabled: config.get('enabled', false),
            workflowPath: config.get('workflowPath', ''),
            enabledWorkflows: config.get('enabledWorkflows', ['review-pr', 'analyze-code']),
            autoExecute: config.get('autoExecute', false)
        };
    }

    private loadWorkflowDefinitions(): void {
        // Define default workflows
        const defaultWorkflows: WorkflowDefinition[] = [
            {
                name: 'review-pr',
                displayName: 'Review Pull Request',
                description: 'Perform a comprehensive code review using Cline',
                enabled: true,
                icon: 'search',
                category: 'review'
            },
            {
                name: 'analyze-code',
                displayName: 'Analyze Code Quality',
                description: 'Analyze code quality and suggest improvements',
                enabled: true,
                icon: 'beaker',
                category: 'analysis'
            },
            {
                name: 'security-scan',
                displayName: 'Security Scan',
                description: 'Scan for security vulnerabilities',
                enabled: true,
                icon: 'shield',
                category: 'analysis'
            },
            {
                name: 'generate-tests',
                displayName: 'Generate Tests',
                description: 'Generate unit tests for changed files',
                enabled: true,
                icon: 'beaker',
                category: 'automation'
            }
        ];

        defaultWorkflows.forEach(workflow => {
            if (this.config.enabledWorkflows.includes(workflow.name)) {
                this.workflowDefinitions.set(workflow.name, workflow);
            }
        });

        // Load custom workflows from workflow path if configured
        if (this.config.workflowPath) {
            this.loadCustomWorkflows();
        }
    }

    private loadCustomWorkflows(): void {
        try {
            const workflowPath = this.resolveWorkflowPath();
            if (fs.existsSync(workflowPath)) {
                const files = fs.readdirSync(workflowPath);
                files.forEach(file => {
                    if (file.endsWith('.json')) {
                        try {
                            const content = fs.readFileSync(path.join(workflowPath, file), 'utf-8');
                            const workflow: WorkflowDefinition = JSON.parse(content);
                            if (this.config.enabledWorkflows.includes(workflow.name)) {
                                this.workflowDefinitions.set(workflow.name, workflow);
                            }
                        } catch (error) {
                            console.error(`Failed to load workflow ${file}:`, error);
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Failed to load custom workflows:', error);
        }
    }

    private resolveWorkflowPath(): string {
        const configPath = this.config.workflowPath;
        
        // If absolute path, use as is
        if (path.isAbsolute(configPath)) {
            return configPath;
        }
        
        // If relative path, resolve from workspace
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            return path.join(workspaceFolder.uri.fsPath, configPath);
        }
        
        return configPath;
    }

    public async executeWorkflow(workflowName: string, pr: PullRequest): Promise<WorkflowResult> {
        if (!this.config.enabled) {
            return {
                success: false,
                error: 'Cline workflow integration is not enabled. Please enable it in settings.'
            };
        }

        const workflow = this.workflowDefinitions.get(workflowName);
        if (!workflow) {
            return {
                success: false,
                error: `Workflow '${workflowName}' not found or not enabled.`
            };
        }

        try {
            const context = this.buildWorkflowContext(pr);
            const result = await this.invokeClineWorkflow(workflow, context);
            return result;
        } catch (error: any) {
            return {
                success: false,
                error: `Failed to execute workflow: ${error.message || error}`
            };
        }
    }

    private buildWorkflowContext(pr: PullRequest): WorkflowContext {
        return {
            pullRequestId: pr.pullRequestId,
            title: pr.title,
            description: pr.description,
            sourceRefName: pr.sourceRefName,
            targetRefName: pr.targetRefName,
            author: pr.createdBy.displayName,
            reviewers: pr.reviewers?.map(r => r.displayName) || []
        };
    }

    private async invokeClineWorkflow(
        workflow: WorkflowDefinition,
        context: WorkflowContext
    ): Promise<WorkflowResult> {
        // Create a new Cline task with the workflow context
        const taskDescription = this.buildTaskDescription(workflow, context);
        
        // Use Cline API to start a new task
        // This will open Cline with pre-filled context
        try {
            await vscode.commands.executeCommand('cline.newTask', {
                task: taskDescription,
                context: this.formatContextForCline(context)
            });

            return {
                success: true,
                message: `Workflow '${workflow.displayName}' started in Cline`,
                output: taskDescription
            };
        } catch (error: any) {
            // Fallback: Copy task to clipboard and notify user
            await vscode.env.clipboard.writeText(taskDescription);
            
            const action = await vscode.window.showInformationMessage(
                `Workflow task copied to clipboard. Please paste it into Cline to start the workflow.`,
                'Open Cline'
            );

            if (action === 'Open Cline') {
                await vscode.commands.executeCommand('cline.focus');
            }

            return {
                success: true,
                message: 'Workflow task copied to clipboard',
                output: taskDescription
            };
        }
    }

    private buildTaskDescription(workflow: WorkflowDefinition, context: WorkflowContext): string {
        let description = `## ${workflow.displayName}\n\n`;
        description += `${workflow.description}\n\n`;
        description += `### Pull Request Context\n`;
        description += `- **PR #${context.pullRequestId}**: ${context.title}\n`;
        description += `- **Author**: ${context.author}\n`;
        description += `- **Branch**: ${context.sourceRefName} → ${context.targetRefName}\n`;
        
        if (context.reviewers && context.reviewers.length > 0) {
            description += `- **Reviewers**: ${context.reviewers.join(', ')}\n`;
        }
        
        description += `\n### Description\n${context.description || 'No description provided'}\n\n`;
        
        // Add workflow-specific instructions
        switch (workflow.name) {
            case 'review-pr':
                description += this.getReviewInstructions();
                break;
            case 'analyze-code':
                description += this.getAnalysisInstructions();
                break;
            case 'security-scan':
                description += this.getSecurityInstructions();
                break;
            case 'generate-tests':
                description += this.getTestGenerationInstructions();
                break;
        }
        
        return description;
    }

    private getReviewInstructions(): string {
        return `### Task
Please perform a comprehensive code review of this pull request:

1. **Code Quality**: Review code for best practices, maintainability, and readability
2. **Logic Review**: Verify the implementation logic is sound
3. **Potential Issues**: Identify potential bugs, edge cases, or performance concerns
4. **Security**: Check for security vulnerabilities
5. **Documentation**: Ensure code is properly documented
6. **Tests**: Review test coverage and quality

Please provide:
- Summary of changes
- Detailed findings with line numbers
- Recommendations for improvements
- Security concerns (if any)
- Overall assessment (Approve/Request Changes)`;
    }

    private getAnalysisInstructions(): string {
        return `### Task
Analyze the code quality of the changes in this pull request:

1. Code complexity analysis
2. Design pattern usage
3. Code duplication detection
4. Performance implications
5. Maintainability assessment

Provide detailed recommendations for improving code quality.`;
    }

    private getSecurityInstructions(): string {
        return `### Task
Perform a security scan of the changes in this pull request:

1. Check for common vulnerabilities (SQL injection, XSS, etc.)
2. Identify insecure dependencies
3. Review authentication/authorization logic
4. Check for exposed secrets or credentials
5. Validate input sanitization

Provide a security assessment with severity levels for any findings.`;
    }

    private getTestGenerationInstructions(): string {
        return `### Task
Generate unit tests for the changes in this pull request:

1. Identify changed functions/methods that need tests
2. Generate comprehensive test cases covering:
   - Happy path scenarios
   - Edge cases
   - Error handling
   - Boundary conditions
3. Ensure tests follow project conventions

Provide complete, runnable test code.`;
    }

    private formatContextForCline(context: WorkflowContext): string {
        return JSON.stringify(context, null, 2);
    }

    public getAvailableWorkflows(): WorkflowDefinition[] {
        return Array.from(this.workflowDefinitions.values())
            .filter(w => w.enabled);
    }

    public async validateWorkflowPath(): Promise<boolean> {
        if (!this.config.workflowPath) {
            return true; // Empty path is valid (uses defaults only)
        }

        const workflowPath = this.resolveWorkflowPath();
        return fs.existsSync(workflowPath);
    }

    public refreshConfig(): void {
        this.config = this.loadConfig();
        this.workflowDefinitions.clear();
        this.loadWorkflowDefinitions();
    }

    public isEnabled(): boolean {
        return this.config.enabled;
    }
}
