/**
 * Types for Cline workflow integration
 */

export interface WorkflowDefinition {
    name: string;
    displayName: string;
    description: string;
    enabled: boolean;
    icon?: string;
    category?: 'review' | 'analysis' | 'automation';
}

export interface WorkflowContext {
    pullRequestId: number;
    title: string;
    description: string;
    sourceRefName: string;
    targetRefName: string;
    author: string;
    files?: string[];
    reviewers?: string[];
}

export interface WorkflowResult {
    success: boolean;
    message?: string;
    output?: string;
    error?: string;
}

export interface ClineWorkflowConfig {
    enabled: boolean;
    workflowPath: string;
    enabledWorkflows: string[];
    autoExecute: boolean;
}
