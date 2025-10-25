import * as vscode from 'vscode';
import { PRTreeItem } from './prTreeDataProvider';

export class PRDragAndDropController implements vscode.TreeDragAndDropController<PRTreeItem> {
    dropMimeTypes = ['application/vnd.code.tree.azureDevOpsPRExplorer'];
    dragMimeTypes = ['application/vnd.code.tree.azureDevOpsPRExplorer'];

    public async handleDrag(
        source: readonly PRTreeItem[],
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Allow dragging both PR items and person groups
        const prItems = source.filter(item => item.type === 'pullRequest' && item.pr);
        const personGroups = source.filter(item => item.type === 'personGroup');
        
        if (prItems.length > 0) {
            // Store the PR IDs and their original group info for the drag operation
            const dragData = prItems.map(item => ({
                prId: item.pr!.pullRequestId,
                prTitle: item.pr!.title,
                sourceGroupId: item.manualGroupId
            }));
            
            dataTransfer.set(
                'application/vnd.code.tree.azureDevOpsPRExplorer',
                new vscode.DataTransferItem(dragData)
            );
            
            console.log('[DragDrop] Dragging PRs:', dragData.map(d => `#${d.prId}`).join(', '));
        } else if (personGroups.length > 0) {
            // Dragging person groups - need to pass person name and source group ID
            const dragData = personGroups.map(item => ({
                type: 'personGroup',
                personName: item.personName!,
                sourceGroupId: item.manualGroupId
            }));
            
            dataTransfer.set(
                'application/vnd.code.tree.azureDevOpsPRExplorer',
                new vscode.DataTransferItem(dragData)
            );
            
            console.log('[DragDrop] Dragging person groups:', dragData.map(d => d.personName).join(', '));
        }
    }

    public async handleDrop(
        target: PRTreeItem | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        const transferItem = dataTransfer.get('application/vnd.code.tree.azureDevOpsPRExplorer');
        if (!transferItem) {
            console.log('[DragDrop] No transfer item found');
            return;
        }

        const dragData: Array<any> = transferItem.value;
        
        // Check if we're dragging person groups
        if (dragData.length > 0 && dragData[0].type === 'personGroup') {
            console.log('[DragDrop] Detected person group drag');
            // Call the person group drop callback
            if (this.onPersonGroupDropCallback) {
                await this.onPersonGroupDropCallback(dragData, target);
            }
            return;
        }
        
        // Otherwise handle as PR drag
        const prDragData: Array<{ prId: number; prTitle: string; sourceGroupId?: string }> = dragData;
        
        // Determine target group ID
        let targetGroupId: string | undefined;
        let targetLabel = 'Unassigned';
        
        if (target?.type === 'manualFolder') {
            // Dropped directly on a manual folder
            targetGroupId = target.manualGroupId;
            targetLabel = target.label?.toString() || 'Unknown Group';
            console.log('[DragDrop] Drop target: Manual folder', targetGroupId);
        } else if (target?.type === 'personGroup' && target.manualGroupId && target.manualGroupId !== 'ungrouped') {
            // Dropped on a person group within a manual folder
            targetGroupId = target.manualGroupId;
            targetLabel = 'group (via person)';
            console.log('[DragDrop] Drop target: Person group in manual folder', targetGroupId);
        } else if (target?.type === 'ungroupedFolder' || target?.groupKey === 'ungrouped') {
            // Dropped on ungrouped section - remove from groups
            targetGroupId = undefined;
            targetLabel = 'Unassigned';
            console.log('[DragDrop] Drop target: Ungrouped section');
        } else if (target?.type === 'personGroup' && target.manualGroupId === 'ungrouped') {
            // Dropped on a person in ungrouped section
            targetGroupId = undefined;
            targetLabel = 'Unassigned';
            console.log('[DragDrop] Drop target: Person in ungrouped section');
        } else {
            // Invalid drop target
            vscode.window.showWarningMessage('Cannot drop here. Drop on a folder or the Unassigned section.');
            console.log('[DragDrop] Invalid drop target:', target?.type);
            return;
        }

        console.log(`[DragDrop] Moving ${dragData.length} PR(s) to: ${targetLabel}`);
        
        // Signal the move operation - we'll need to call back to the tree data provider
        // This will be handled by registering a callback
        if (this.onDropCallback) {
            await this.onDropCallback(dragData, targetGroupId);
        }
    }

    // Callback to be set by PRTreeDataProvider
    private onDropCallback?: (
        items: Array<{ prId: number; prTitle: string; sourceGroupId?: string }>,
        targetGroupId: string | undefined
    ) => Promise<void>;
    
    private onPersonGroupDropCallback?: (
        items: Array<{ type: string; personName: string; sourceGroupId?: string }>,
        target: PRTreeItem | undefined
    ) => Promise<void>;

    public setDropCallback(
        callback: (
            items: Array<{ prId: number; prTitle: string; sourceGroupId?: string }>,
            targetGroupId: string | undefined
        ) => Promise<void>
    ): void {
        this.onDropCallback = callback;
    }
    
    public setPersonGroupDropCallback(
        callback: (
            items: Array<{ type: string; personName: string; sourceGroupId?: string }>,
            target: PRTreeItem | undefined
        ) => Promise<void>
    ): void {
        this.onPersonGroupDropCallback = callback;
    }
}
