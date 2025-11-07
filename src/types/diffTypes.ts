/**
 * Types for enhanced diff viewer
 */

export interface CommitSelection {
    leftCommitId: string;
    rightCommitId: string;
}

export interface CommitInfo {
    commitId: string;
    comment: string;
    author: {
        name: string;
        email: string;
        date: Date;
    };
    committer?: {
        name: string;
        email: string;
        date: Date;
    };
}

export interface DiffData {
    leftCommit: CommitInfo;
    rightCommit: CommitInfo;
    filePath: string;
    leftContent: string;
    rightContent: string;
    changes: DiffChange[];
}

export interface DiffChange {
    type: 'add' | 'delete' | 'modify';
    leftLineStart: number;
    leftLineEnd: number;
    rightLineStart: number;
    rightLineEnd: number;
    content: string;
}

export interface DiffViewerConfig {
    showCommitDropdowns: boolean;
    defaultCommitSelection: 'latest' | 'base' | 'custom';
    syntaxHighlighting: boolean;
    showLineNumbers: boolean;
}
