import * as vscode from 'vscode';

export class OAuthAuthenticationManager {
    private static readonly AUTH_TYPE = 'github';
    private static readonly SCOPES = ['repo', 'user:email', 'read:org'];

    async getSession(): Promise<vscode.AuthenticationSession | undefined> {
        try {
            // Try to get existing session silently
            const session = await vscode.authentication.getSession(
                OAuthAuthenticationManager.AUTH_TYPE,
                OAuthAuthenticationManager.SCOPES,
                { silent: true }
            );
            
            return session;
        } catch (error) {
            console.log('No existing authentication session found');
            return undefined;
        }
    }

    async authenticate(): Promise<vscode.AuthenticationSession> {
        try {
            // Prompt user to sign in
            const session = await vscode.authentication.getSession(
                OAuthAuthenticationManager.AUTH_TYPE,
                OAuthAuthenticationManager.SCOPES,
                { createIfNone: true }
            );

            vscode.window.showInformationMessage('Successfully authenticated with Azure DevOps!');
            return session;
        } catch (error) {
            vscode.window.showErrorMessage(`Authentication failed: ${error}`);
            throw error;
        }
    }

    async getToken(): Promise<string | undefined> {
        const session = await this.getSession();
        return session?.accessToken;
    }

    async signOut(): Promise<void> {
        const session = await this.getSession();
        if (session) {
            // VSCode will handle the sign out
            vscode.window.showInformationMessage('Signed out from Azure DevOps');
        }
    }

    // Check if user is currently authenticated
    async isAuthenticated(): Promise<boolean> {
        const session = await this.getSession();
        return session !== undefined;
    }
}
