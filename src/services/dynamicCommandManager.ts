import * as vscode from 'vscode';

/**
 * Manages dynamic registration and unregistration of commands based on the current mode.
 * This eliminates the need for context keys that can cause "AbstractContextKeyService has been disposed" errors.
 */
export class DynamicCommandManager {
    private modeCommandDisposables: vscode.Disposable[] = [];
    private currentMode: 'people' | 'workitems' | 'manual' = 'people';

    /**
     * Switch to a new mode by unregistering old mode-specific commands and registering new ones
     */
    public switchToMode(
        mode: 'people' | 'workitems' | 'manual',
        callbacks: ModeCommandCallbacks
    ): void {
        // Only switch if mode actually changed
        if (this.currentMode === mode) {
            return;
        }

        // Unregister all current mode-specific commands
        this.unregisterModeCommands();

        // Register new mode-specific commands
        this.currentMode = mode;
        
        if (mode === 'manual') {
            this.registerManualModeCommands(callbacks);
        } else if (mode === 'workitems') {
            this.registerWorkItemsModeCommands(callbacks);
        }
        // 'people' mode has no mode-specific commands
    }

    /**
     * Register commands that are only available in manual mode
     */
    private registerManualModeCommands(callbacks: ModeCommandCallbacks): void {
        this.modeCommandDisposables.push(
            vscode.commands.registerCommand(
                'azureDevOpsPR.createManualGroup',
                callbacks.createManualGroup
            )
        );

        this.modeCommandDisposables.push(
            vscode.commands.registerCommand(
                'azureDevOpsPR.deleteAllManualGroups',
                callbacks.deleteAllManualGroups
            )
        );
    }

    /**
     * Register commands that are only available in work items mode
     */
    private registerWorkItemsModeCommands(callbacks: ModeCommandCallbacks): void {
        this.modeCommandDisposables.push(
            vscode.commands.registerCommand(
                'azureDevOpsPR.selectWorkItemLevel',
                callbacks.selectWorkItemLevel
            )
        );
    }

    /**
     * Unregister all mode-specific commands
     */
    private unregisterModeCommands(): void {
        this.modeCommandDisposables.forEach(disposable => disposable.dispose());
        this.modeCommandDisposables = [];
    }

    /**
     * Get the current mode
     */
    public getCurrentMode(): 'people' | 'workitems' | 'manual' {
        return this.currentMode;
    }

    /**
     * Dispose of all registered commands
     */
    public dispose(): void {
        this.unregisterModeCommands();
    }
}

/**
 * Callbacks for mode-specific commands
 */
export interface ModeCommandCallbacks {
    createManualGroup: () => Promise<void>;
    deleteAllManualGroups: () => Promise<void>;
    selectWorkItemLevel: () => Promise<void>;
}
