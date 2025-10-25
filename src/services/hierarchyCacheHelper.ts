import * as vscode from 'vscode';

// Helper to build work item hierarchy cache
export async function buildWorkItemHierarchyChain(
    azureDevOpsService: any,
    workItemId: number,
    maxLevel: number
): Promise<any[]> {
    const hierarchyChain: any[] = [];
    const config = vscode.workspace.getConfiguration('azureDevOpsPR');
    const debugEnabled = config.get<boolean>('debugWorkItemHierarchy', false);
    
    try {
        let currentWorkItem = await azureDevOpsService.getWorkItemDetails(workItemId);
        
        if (!currentWorkItem) {
            return hierarchyChain;
        }
        
        // Level 0: the work item itself
        hierarchyChain.push(currentWorkItem);
        
        // Traverse up to maxLevel
        for (let level = 1; level <= maxLevel; level++) {
            if (!currentWorkItem.parentId) {
                // No more parents, we've reached the top
                break;
            }
            
            const parent = await azureDevOpsService.getWorkItemDetails(currentWorkItem.parentId);
            if (!parent) {
                break;
            }
            
            hierarchyChain.push(parent);
            currentWorkItem = parent;
        }
        
        if (debugEnabled) {
            console.log(`[HierarchyCache] Built chain for WI #${workItemId}: ${hierarchyChain.length} levels`);
        }
        return hierarchyChain;
    } catch (error) {
        if (debugEnabled) {
            console.error(`[HierarchyCache] Failed to build chain for WI #${workItemId}:`, error);
        }
        return hierarchyChain;
    }
}
