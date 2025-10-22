import * as vscode from 'vscode';
import { AuthenticationManager } from './authenticationManager';
import { OAuthAuthenticationManager } from './oauthAuthenticationManager';

export enum AuthMethod {
    PAT = 'pat',
    OAuth = 'oauth'
}

export class AuthenticationProvider {
    private patManager: AuthenticationManager;
    private oauthManager: OAuthAuthenticationManager;
    private currentMethod: AuthMethod;

    constructor(context: vscode.ExtensionContext) {
        this.patManager = new AuthenticationManager(context);
        this.oauthManager = new OAuthAuthenticationManager();
        
        // Check config for preferred auth method
        const config = vscode.workspace.getConfiguration('azureDevOpsPR');
        const method = config.get<string>('authenticationMethod', 'oauth');
        this.currentMethod = method === 'pat' ? AuthMethod.PAT : AuthMethod.OAuth;
    }

    async authenticate(): Promise<void> {
        // Ask user which method they prefer
        const choice = await vscode.window.showQuickPick(
            [
                {
                    label: '$(mark-github) GitHub Account (OAuth)',
                    description: 'Sign in with your GitHub account - Recommended',
                    method: AuthMethod.OAuth
                },
                {
                    label: '$(key) Personal Access Token',
                    description: 'Use a PAT token',
                    method: AuthMethod.PAT
                }
            ],
            {
                placeHolder: 'Choose authentication method',
                title: 'Azure DevOps Authentication'
            }
        );

        if (!choice) {
            return;
        }

        this.currentMethod = choice.method;

        // Save preference
        const config = vscode.workspace.getConfiguration('azureDevOpsPR');
        await config.update('authenticationMethod', choice.method, vscode.ConfigurationTarget.Global);

        if (choice.method === AuthMethod.OAuth) {
            await this.oauthManager.authenticate();
        } else {
            await this.patManager.authenticate();
        }
    }

    async getToken(): Promise<string | undefined> {
        if (this.currentMethod === AuthMethod.OAuth) {
            const token = await this.oauthManager.getToken();
            if (!token) {
                // Try PAT as fallback
                return await this.patManager.getToken();
            }
            return token;
        } else {
            const token = await this.patManager.getToken();
            if (!token) {
                // Try OAuth as fallback
                return await this.oauthManager.getToken();
            }
            return token;
        }
    }

    async isAuthenticated(): Promise<boolean> {
        if (this.currentMethod === AuthMethod.OAuth) {
            const isAuth = await this.oauthManager.isAuthenticated();
            if (!isAuth) {
                // Check PAT as fallback
                const patToken = await this.patManager.getToken();
                return patToken !== undefined;
            }
            return isAuth;
        } else {
            const patToken = await this.patManager.getToken();
            if (!patToken) {
                // Check OAuth as fallback
                return await this.oauthManager.isAuthenticated();
            }
            return true;
        }
    }

    async signOut(): Promise<void> {
        await this.oauthManager.signOut();
        await this.patManager.clearToken();
        vscode.window.showInformationMessage('Signed out from Azure DevOps');
    }

    getAuthMethod(): AuthMethod {
        return this.currentMethod;
    }
}
