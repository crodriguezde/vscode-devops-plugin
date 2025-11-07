export interface PullRequest {
    pullRequestId: number;
    title: string;
    description: string;
    createdBy: {
        displayName: string;
        uniqueName: string;
        imageUrl?: string;
    };
    creationDate: Date;
    status: string | number; // Azure DevOps API returns numeric status codes
    sourceRefName: string;
    targetRefName: string;
    reviewers: Reviewer[];
    labels?: Label[];
    mergeStatus?: string;
    isDraft?: boolean;
    workItemRefs?: WorkItemRef[];
    completionOptions?: CompletionOptions;
}

export interface Reviewer {
    displayName: string;
    uniqueName: string;
    vote: number;
    isRequired: boolean;
}

export interface Label {
    id: string;
    name: string;
    active?: boolean;
}

export interface WorkItemRef {
    id: string;
    url?: string;
}

export interface CompletionOptions {
    deleteSourceBranch?: boolean;
    squashMerge?: boolean;
    mergeCommitMessage?: string;
    bypassPolicy?: boolean;
    transitionWorkItems?: boolean;
}

export interface PRFile {
    path: string;
    changeType: string;
    objectId?: string;
    originalObjectId?: string;
}

export interface PRComment {
    id: number;
    content: string;
    author: {
        displayName: string;
        uniqueName: string;
    };
    publishedDate: Date;
    threadId: number;
    isDeleted: boolean;
    commentType: string;
}

export interface PRThread {
    id: number;
    comments: PRComment[];
    status: string;
    threadContext?: {
        filePath: string;
        rightFileStart?: {
            line: number;
            offset: number;
        };
        rightFileEnd?: {
            line: number;
            offset: number;
        };
    };
}

export interface AzureDevOpsConfig {
    organization: string;
    project: string;
    repository?: string;
    personalAccessToken?: string;
}

export interface PRIteration {
    id: number;
    author: {
        displayName: string;
        uniqueName: string;
    };
    createdDate: Date;
    description?: string;
    sourceRefCommit: {
        commitId: string;
    };
    targetRefCommit: {
        commitId: string;
    };
}

export interface BuildStatus {
    id: number;
    buildNumber: string;
    status: string;
    result?: string;
    url: string;
    definition: {
        name: string;
    };
}

export interface PolicyEvaluation {
    policyId: string;
    policyName: string;
    status: string;
    isBlocking: boolean;
}

export interface MergeConflict {
    conflictId: number;
    conflictPath: string;
    conflictType: string;
    mergeSourceCommit: {
        commitId: string;
    };
    mergeTargetCommit: {
        commitId: string;
    };
}

// Azure DevOps API response types
export interface AzureDevOpsApiResponse<T = unknown> {
    count: number;
    value: T[];
}

export interface GitItem {
    objectId: string;
    gitObjectType: string;
    commitId: string;
    path: string;
    url: string;
    isFolder?: boolean;
    content?: string;
}

export interface GitCommitRef {
    commitId: string;
    author: {
        name: string;
        email: string;
        date: string;
    };
    committer: {
        name: string;
        email: string;
        date: string;
    };
    comment: string;
    url: string;
}

export interface ThreadContext {
    filePath: string;
    rightFileStart?: { line: number; offset: number };
    rightFileEnd?: { line: number; offset: number };
    leftFileStart?: { line: number; offset: number };
    leftFileEnd?: { line: number; offset: number };
}

export interface CommentPosition {
    line: number;
    offset: number;
}

export interface PRPolicy {
    id: string;
    type: {
        id: string;
        displayName: string;
    };
    isEnabled: boolean;
    isBlocking: boolean;
    settings: Record<string, unknown>;
}

export interface TeamContext {
    project: string;
    projectId?: string;
    team?: string;
    teamId?: string;
}

export interface IdentityRef {
    id: string;
    displayName: string;
    uniqueName: string;
    imageUrl?: string;
    url?: string;
}

export interface WebApiTeam {
    id: string;
    name: string;
    url: string;
    description?: string;
    identityUrl?: string;
}

export interface WebApiCreatePatchOperation {
    op: string;
    path: string;
    value: unknown;
    from?: string;
}
