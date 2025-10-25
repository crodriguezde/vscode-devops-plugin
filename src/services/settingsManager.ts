import * as vscode from 'vscode';

export interface ExtensionSettings {
    // Authentication
    organizationUrl: string;
    project: string;
    repository: string;
    
    // PR Display
    autoRefresh: boolean;
    refreshInterval: number;
    maxPRsToShow: number;
    workItemGroupingLevel: number;
    
    // Cline Integration
    clineIntegration: {
        enabled: boolean;
        workflowPath: string;
        enabledWorkflows: string[];
        autoExecute: boolean;
    };
    
    // Diff Viewer
    diffViewer: {
        defaultCommitSelection: 'latest' | 'base' | 'custom';
        showCommitDropdowns: boolean;
    };
    
    // Comments
    comments: {
        inlineDisplay: boolean;
        showResolved: boolean;
        autoRefresh: boolean;
    };
}

export class SettingsManager {
    private static readonly CONFIG_SECTION = 'azureDevOpsPR';
    
    public static getSettings(): ExtensionSettings {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        
        return {
            organizationUrl: config.get<string>('organizationUrl', ''),
            project: config.get<string>('project', ''),
            repository: config.get<string>('repository', ''),
            autoRefresh: config.get<boolean>('autoRefresh', false),
            refreshInterval: config.get<number>('refreshInterval', 300),
            maxPRsToShow: config.get<number>('maxPRsToShow', 50),
            workItemGroupingLevel: config.get<number>('workItemGroupingLevel', 1),
            clineIntegration: {
                enabled: config.get<boolean>('clineIntegration.enabled', true),
                workflowPath: config.get<string>('clineIntegration.workflowPath', ''),
                enabledWorkflows: config.get<string[]>('clineIntegration.enabledWorkflows', [
                    'review-pr',
                    'analyze-quality',
                    'security-scan',
                    'generate-tests'
                ]),
                autoExecute: config.get<boolean>('clineIntegration.autoExecute', false)
            },
            diffViewer: {
                defaultCommitSelection: config.get<'latest' | 'base' | 'custom'>(
                    'diffViewer.defaultCommitSelection',
                    'latest'
                ),
                showCommitDropdowns: config.get<boolean>('diffViewer.showCommitDropdowns', true)
            },
            comments: {
                inlineDisplay: config.get<boolean>('comments.inlineDisplay', true),
                showResolved: config.get<boolean>('comments.showResolved', false),
                autoRefresh: config.get<boolean>('comments.autoRefresh', true)
            }
        };
    }
    
    public static async updateSetting(
        section: string,
        value: any,
        target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        await config.update(section, value, target);
    }
    
    public static validateSettings(settings: ExtensionSettings): string[] {
        const errors: string[] = [];
        
        // Validate organization URL
        if (!settings.organizationUrl) {
            errors.push('Organization URL is required');
        } else if (!this.isValidUrl(settings.organizationUrl)) {
            errors.push('Organization URL is not a valid URL');
        }
        
        // Validate project
        if (!settings.project) {
            errors.push('Project name is required');
        }
        
        // Validate repository
        if (!settings.repository) {
            errors.push('Repository name is required');
        }
        
        // Validate refresh interval
        if (settings.refreshInterval < 60) {
            errors.push('Refresh interval must be at least 60 seconds');
        }
        
        // Validate max PRs
        if (settings.maxPRsToShow < 1 || settings.maxPRsToShow > 200) {
            errors.push('Max PRs to show must be between 1 and 200');
        }
        
        // Validate work item grouping level
        if (settings.workItemGroupingLevel < 0 || settings.workItemGroupingLevel > 4) {
            errors.push('Work item grouping level must be between 0 and 4');
        }
        
        // Validate workflow path if custom workflows enabled
        if (settings.clineIntegration.workflowPath && 
            !this.isValidPath(settings.clineIntegration.workflowPath)) {
            errors.push('Custom workflow path is not valid');
        }
        
        return errors;
    }
    
    private static isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
    
    private static isValidPath(filePath: string): boolean {
        // Basic path validation
        return filePath.length > 0 && !filePath.includes('<') && !filePath.includes('>');
    }
    
    public static async resetToDefaults(): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        const keys = [
            'autoRefresh',
            'refreshInterval',
            'maxPRsToShow',
            'workItemGroupingLevel',
            'clineIntegration.enabled',
            'clineIntegration.autoExecute',
            'diffViewer.defaultCommitSelection',
            'diffViewer.showCommitDropdowns',
            'comments.inlineDisplay',
            'comments.showResolved',
            'comments.autoRefresh'
        ];
        
        for (const key of keys) {
            await config.update(key, undefined, vscode.ConfigurationTarget.Global);
        }
        
        vscode.window.showInformationMessage('Settings reset to defaults');
    }
    
    public static async exportSettings(): Promise<void> {
        const settings = this.getSettings();
        const json = JSON.stringify(settings, null, 2);
        
        const doc = await vscode.workspace.openTextDocument({
            content: json,
            language: 'json'
        });
        
        await vscode.window.showTextDocument(doc);
    }
    
    public static watchSettingsChanges(
        callback: (e: vscode.ConfigurationChangeEvent) => void
    ): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(this.CONFIG_SECTION)) {
                callback(e);
            }
        });
    }
}
