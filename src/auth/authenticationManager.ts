import * as vscode from 'vscode';

export class AuthenticationManager {
    private static readonly TOKEN_KEY = 'azureDevOpsPAT';
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async saveToken(token: string): Promise<void> {
        await this.context.secrets.store(AuthenticationManager.TOKEN_KEY, token);
    }

    async getToken(): Promise<string | undefined> {
        return await this.context.secrets.get(AuthenticationManager.TOKEN_KEY);
    }

    async clearToken(): Promise<void> {
        await this.context.secrets.delete(AuthenticationManager.TOKEN_KEY);
    }

    async hasToken(): Promise<boolean> {
        const token = await this.getToken();
        return !!token;
    }

    async authenticate(): Promise<void> {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter your Azure DevOps Personal Access Token',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'Paste your PAT here',
            validateInput: (value: string): string | null => {
                if (!value || value.trim().length === 0) {
                    return 'PAT token cannot be empty';
                }
                // Basic validation - PAT tokens are typically 52 characters
                if (value.trim().length < 20) {
                    return 'PAT token appears to be too short. Please ensure you copied the complete token.';
                }
                // Check for common paste errors (spaces, newlines)
                if (value !== value.trim()) {
                    return 'PAT token contains leading or trailing whitespace. Please paste only the token.';
                }
                return null;
            }
        });

        if (token) {
            // Store trimmed token to avoid whitespace issues
            await this.saveToken(token.trim());
            vscode.window.showInformationMessage('PAT saved successfully! Make sure your token has "Code (Read & Write)" permissions.');
        }
    }
}
