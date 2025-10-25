import * as vscode from 'vscode';
import { SettingsManager, ExtensionSettings } from '../services/settingsManager';

export class SettingsWebviewProvider {
    private panel: vscode.WebviewPanel | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    public async showSettings(): Promise<void> {
        // Open the VSCode settings UI filtered to this extension's settings
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:your-publisher-name.azure-devops-pr-viewer');
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'updateSetting':
                await this.updateSetting(message.key, message.value);
                break;
            
            case 'validateSettings':
                await this.validateSettings(message.settings);
                break;
            
            case 'resetDefaults':
                await this.resetDefaults();
                break;
            
            case 'exportSettings':
                await SettingsManager.exportSettings();
                break;
        }
    }

    private async updateSetting(key: string, value: any): Promise<void> {
        try {
            await SettingsManager.updateSetting(key, value);
            this.panel?.webview.postMessage({
                command: 'settingUpdated',
                key,
                success: true
            });
        } catch (error) {
            this.panel?.webview.postMessage({
                command: 'settingUpdated',
                key,
                success: false,
                error: String(error)
            });
        }
    }

    private async validateSettings(settings: ExtensionSettings): Promise<void> {
        const errors = SettingsManager.validateSettings(settings);
        this.panel?.webview.postMessage({
            command: 'validationResult',
            errors
        });
    }

    private async resetDefaults(): Promise<void> {
        await SettingsManager.resetToDefaults();
        const settings = SettingsManager.getSettings();
        this.panel?.webview.postMessage({
            command: 'loadSettings',
            settings
        });
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Azure DevOps PR Settings</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        h2 {
            color: var(--vscode-foreground);
            margin-top: 30px;
            font-size: 1.2em;
        }
        .setting-group {
            margin-bottom: 30px;
        }
        .setting-item {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
        }
        input[type="text"],
        input[type="number"],
        select {
            width: 100%;
            padding: 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
        }
        input[type="checkbox"] {
            margin-right: 8px;
        }
        .checkbox-label {
            display: inline;
            font-weight: normal;
        }
        .description {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
        .button-group {
            margin-top: 30px;
            display: flex;
            gap: 10px;
        }
        button {
            padding: 8px 16px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .error-list {
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-errorForeground);
            padding: 10px;
            margin: 10px 0;
            border-radius: 2px;
        }
        .success-message {
            background-color: var(--vscode-testing-iconPassed);
            padding: 10px;
            margin: 10px 0;
            border-radius: 2px;
        }
    </style>
</head>
<body>
    <h1>⚙️ Azure DevOps PR Viewer Settings</h1>
    
    <div class="setting-group">
        <h2>Connection Settings</h2>
        <div class="setting-item">
            <label for="organizationUrl">Organization URL</label>
            <input type="text" id="organizationUrl" placeholder="https://dev.azure.com/your-org">
            <div class="description">Your Azure DevOps organization URL</div>
        </div>
        <div class="setting-item">
            <label for="project">Project Name</label>
            <input type="text" id="project" placeholder="MyProject">
            <div class="description">Azure DevOps project name</div>
        </div>
        <div class="setting-item">
            <label for="repository">Repository Name</label>
            <input type="text" id="repository" placeholder="my-repo">
            <div class="description">Repository to monitor for pull requests</div>
        </div>
    </div>

    <div class="setting-group">
        <h2>PR Display</h2>
        <div class="setting-item">
            <input type="checkbox" id="autoRefresh">
            <label for="autoRefresh" class="checkbox-label">Auto-refresh pull requests</label>
            <div class="description">Automatically refresh PR list on startup</div>
        </div>
        <div class="setting-item">
            <label for="refreshInterval">Refresh Interval (seconds)</label>
            <input type="number" id="refreshInterval" min="60" max="3600" value="300">
            <div class="description">How often to refresh PR data (minimum 60 seconds)</div>
        </div>
        <div class="setting-item">
            <label for="maxPRsToShow">Maximum PRs to Show</label>
            <input type="number" id="maxPRsToShow" min="1" max="200" value="50">
            <div class="description">Maximum number of PRs to display (1-200)</div>
        </div>
        <div class="setting-item">
            <label for="workItemGroupingLevel">Work Item Grouping Level</label>
            <select id="workItemGroupingLevel">
                <option value="0">Level 0 - Group by directly linked work item</option>
                <option value="1">Level 1 - Group by parent (1 level up)</option>
                <option value="2">Level 2 - Group by grandparent (2 levels up)</option>
                <option value="3">Level 3 - Group by 3 levels up from work item</option>
                <option value="4">Level 4 - Group by 4 levels up from work item</option>
            </select>
            <div class="description">Hierarchy level for grouping PRs when using "Group by Work Items" view</div>
        </div>
    </div>

    <div class="setting-group">
        <h2>Cline Integration</h2>
        <div class="setting-item">
            <input type="checkbox" id="clineEnabled">
            <label for="clineEnabled" class="checkbox-label">Enable Cline integration</label>
            <div class="description">Enable AI-powered PR review workflows with Cline</div>
        </div>
        <div class="setting-item">
            <input type="checkbox" id="clineAutoExecute">
            <label for="clineAutoExecute" class="checkbox-label">Auto-execute workflows</label>
            <div class="description">Automatically run selected workflow when opening PR</div>
        </div>
        <div class="setting-item">
            <label for="clineWorkflowPath">Custom Workflow Path</label>
            <input type="text" id="clineWorkflowPath" placeholder="path/to/workflows">
            <div class="description">Optional custom directory for Cline workflows</div>
        </div>
    </div>

    <div class="setting-group">
        <h2>Diff Viewer</h2>
        <div class="setting-item">
            <label for="defaultCommitSelection">Default Commit Selection</label>
            <select id="defaultCommitSelection">
                <option value="latest">Latest - Compare most recent with previous</option>
                <option value="base">Base - Compare first with latest</option>
                <option value="custom">Custom - User selects manually</option>
            </select>
            <div class="description">Default commits to compare in diff viewer</div>
        </div>
        <div class="setting-item">
            <input type="checkbox" id="showCommitDropdowns">
            <label for="showCommitDropdowns" class="checkbox-label">Show commit selection dropdowns</label>
            <div class="description">Display commit selectors in diff viewer</div>
        </div>
    </div>

    <div class="setting-group">
        <h2>Inline Comments</h2>
        <div class="setting-item">
            <input type="checkbox" id="inlineDisplay">
            <label for="inlineDisplay" class="checkbox-label">Show inline comments</label>
            <div class="description">Display PR comments directly in the editor</div>
        </div>
        <div class="setting-item">
            <input type="checkbox" id="showResolved">
            <label for="showResolved" class="checkbox-label">Show resolved comments</label>
            <div class="description">Display resolved comment threads</div>
        </div>
        <div class="setting-item">
            <input type="checkbox" id="autoRefreshComments">
            <label for="autoRefreshComments" class="checkbox-label">Auto-refresh comments</label>
            <div class="description">Automatically refresh comments when they change</div>
        </div>
    </div>

    <div id="errorContainer"></div>

    <div class="button-group">
        <button id="validateBtn">Validate Settings</button>
        <button id="resetBtn" class="secondary">Reset to Defaults</button>
        <button id="exportBtn" class="secondary">Export Settings</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Load settings
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.command === 'loadSettings') {
                loadSettings(message.settings);
            } else if (message.command === 'validationResult') {
                showValidationResult(message.errors);
            } else if (message.command === 'settingUpdated') {
                if (message.success) {
                    showSuccess('Setting updated successfully');
                } else {
                    showError(['Failed to update setting: ' + message.error]);
                }
            }
        });
        
        function loadSettings(settings) {
            document.getElementById('organizationUrl').value = settings.organizationUrl;
            document.getElementById('project').value = settings.project;
            document.getElementById('repository').value = settings.repository;
            document.getElementById('autoRefresh').checked = settings.autoRefresh;
            document.getElementById('refreshInterval').value = settings.refreshInterval;
            document.getElementById('maxPRsToShow').value = settings.maxPRsToShow;
            document.getElementById('workItemGroupingLevel').value = settings.workItemGroupingLevel || 1;
            document.getElementById('clineEnabled').checked = settings.clineIntegration.enabled;
            document.getElementById('clineAutoExecute').checked = settings.clineIntegration.autoExecute;
            document.getElementById('clineWorkflowPath').value = settings.clineIntegration.workflowPath;
            document.getElementById('defaultCommitSelection').value = settings.diffViewer.defaultCommitSelection;
            document.getElementById('showCommitDropdowns').checked = settings.diffViewer.showCommitDropdowns;
            document.getElementById('inlineDisplay').checked = settings.comments.inlineDisplay;
            document.getElementById('showResolved').checked = settings.comments.showResolved;
            document.getElementById('autoRefreshComments').checked = settings.comments.autoRefresh;
        }
        
        function getSettings() {
            return {
                organizationUrl: document.getElementById('organizationUrl').value,
                project: document.getElementById('project').value,
                repository: document.getElementById('repository').value,
                autoRefresh: document.getElementById('autoRefresh').checked,
                refreshInterval: parseInt(document.getElementById('refreshInterval').value),
                maxPRsToShow: parseInt(document.getElementById('maxPRsToShow').value),
                workItemGroupingLevel: parseInt(document.getElementById('workItemGroupingLevel').value),
                clineIntegration: {
                    enabled: document.getElementById('clineEnabled').checked,
                    autoExecute: document.getElementById('clineAutoExecute').checked,
                    workflowPath: document.getElementById('clineWorkflowPath').value,
                    enabledWorkflows: []
                },
                diffViewer: {
                    defaultCommitSelection: document.getElementById('defaultCommitSelection').value,
                    showCommitDropdowns: document.getElementById('showCommitDropdowns').checked
                },
                comments: {
                    inlineDisplay: document.getElementById('inlineDisplay').checked,
                    showResolved: document.getElementById('showResolved').checked,
                    autoRefresh: document.getElementById('autoRefreshComments').checked
                }
            };
        }
        
        function showValidationResult(errors) {
            const container = document.getElementById('errorContainer');
            if (errors.length === 0) {
                container.innerHTML = '<div class="success-message">✓ All settings are valid!</div>';
                setTimeout(() => { container.innerHTML = ''; }, 3000);
            } else {
                container.innerHTML = '<div class="error-list"><strong>Validation Errors:</strong><ul>' +
                    errors.map(e => '<li>' + e + '</li>').join('') +
                    '</ul></div>';
            }
        }
        
        function showSuccess(message) {
            const container = document.getElementById('errorContainer');
            container.innerHTML = '<div class="success-message">✓ ' + message + '</div>';
            setTimeout(() => { container.innerHTML = ''; }, 3000);
        }
        
        function showError(errors) {
            const container = document.getElementById('errorContainer');
            container.innerHTML = '<div class="error-list">' + errors.join('<br>') + '</div>';
        }
        
        // Auto-save on change
        document.querySelectorAll('input, select').forEach(element => {
            element.addEventListener('change', () => {
                const key = element.id;
                let value = element.type === 'checkbox' ? element.checked : element.value;
                if (element.type === 'number') {
                    value = parseInt(value);
                }
                
                // Map to correct setting path
                let settingPath = key;
                if (key.startsWith('cline')) {
                    settingPath = 'clineIntegration.' + key.replace('cline', '').charAt(0).toLowerCase() + key.replace('cline', '').slice(1);
                } else if (key === 'defaultCommitSelection' || key === 'showCommitDropdowns') {
                    settingPath = 'diffViewer.' + key;
                } else if (key === 'inlineDisplay' || key === 'showResolved' || key === 'autoRefreshComments') {
                    settingPath = 'comments.' + (key === 'autoRefreshComments' ? 'autoRefresh' : key);
                }
                
                vscode.postMessage({
                    command: 'updateSetting',
                    key: settingPath,
                    value
                });
            });
        });
        
        // Button handlers
        document.getElementById('validateBtn').addEventListener('click', () => {
            vscode.postMessage({
                command: 'validateSettings',
                settings: getSettings()
            });
        });
        
        document.getElementById('resetBtn').addEventListener('click', () => {
            if (confirm('Reset all settings to defaults?')) {
                vscode.postMessage({ command: 'resetDefaults' });
            }
        });
        
        document.getElementById('exportBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'exportSettings' });
        });
    </script>
</body>
</html>`;
    }
}
