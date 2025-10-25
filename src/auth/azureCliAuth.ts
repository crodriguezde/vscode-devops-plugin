import { execSync } from 'child_process';
import * as vscode from 'vscode';

/**
 * Azure CLI Authentication Provider
 * Uses Azure CLI to get access tokens for Azure DevOps
 */
export class AzureCliAuthProvider {
    private static readonly AZURE_DEVOPS_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

    /**
     * Get Azure DevOps access token from Azure CLI
     * @returns Access token string
     * @throws Error if Azure CLI is not installed or user is not logged in
     */
    async getToken(): Promise<string> {
        try {
            // Check if Azure CLI is installed
            try {
                execSync('az --version', { encoding: 'utf8', stdio: 'pipe' });
            } catch (error) {
                throw new Error(
                    'Azure CLI is not installed. Please install Azure CLI from https://aka.ms/azure-cli and run "az login"'
                );
            }

            // Check if user is logged in
            try {
                execSync('az account show', { encoding: 'utf8', stdio: 'pipe' });
            } catch (error) {
                throw new Error(
                    'You are not logged in to Azure CLI. Please run "az login" in your terminal'
                );
            }

            // Get access token for Azure DevOps
            const result = execSync(
                `az account get-access-token --resource ${AzureCliAuthProvider.AZURE_DEVOPS_RESOURCE_ID} --query "accessToken" --output tsv`,
                {
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe']
                }
            );

            const token = result.trim();
            
            if (!token) {
                throw new Error('No access token returned from Azure CLI');
            }

            return token;
        } catch (error: any) {
            // Provide helpful error messages
            if (error.message.includes('not installed')) {
                throw error;
            } else if (error.message.includes('not logged in')) {
                throw error;
            } else if (error.message.includes('AADSTS')) {
                throw new Error(
                    'Azure CLI authentication failed. Please run "az login" to re-authenticate'
                );
            } else {
                throw new Error(
                    `Failed to get Azure CLI token: ${error.message}\n\nPlease ensure:\n1. Azure CLI is installed\n2. You are logged in (run "az login")\n3. Your Azure account has access to Azure DevOps`
                );
            }
        }
    }

    /**
     * Check if Azure CLI is available and user is logged in
     * @returns true if ready, false otherwise
     */
    async isAvailable(): Promise<boolean> {
        try {
            execSync('az --version', { encoding: 'utf8', stdio: 'pipe' });
            execSync('az account show', { encoding: 'utf8', stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Prompt user to login with Azure CLI
     */
    async promptLogin(): Promise<void> {
        const action = await vscode.window.showInformationMessage(
            'Azure CLI authentication required. Please run "az login" in your terminal.',
            'Open Terminal',
            'I\'ve Logged In',
            'Cancel'
        );

        if (action === 'Open Terminal') {
            const terminal = vscode.window.createTerminal('Azure CLI Login');
            terminal.show();
            terminal.sendText('az login');
        } else if (action === 'I\'ve Logged In') {
            // Verify login
            const isAvailable = await this.isAvailable();
            if (isAvailable) {
                vscode.window.showInformationMessage('✓ Azure CLI authentication verified!');
            } else {
                vscode.window.showErrorMessage('Azure CLI login verification failed. Please try again.');
            }
        }
    }

    /**
     * Get account information from Azure CLI
     */
    async getAccountInfo(): Promise<{ name: string; id: string } | null> {
        try {
            const result = execSync('az account show --query "{name:name, id:id}" --output json', {
                encoding: 'utf8',
                stdio: 'pipe'
            });
            return JSON.parse(result.trim());
        } catch {
            return null;
        }
    }
}
