/**
 * Types for inline comment system
 */

export interface InlineComment {
    id: number;
    threadId: number;
    content: string;
    author: {
        displayName: string;
        uniqueName: string;
        imageUrl?: string;
    };
    publishedDate: Date;
    filePath: string;
    lineNumber: number;
    isResolved: boolean;
    commentType: 'text' | 'system';
}

export interface CommentThread {
    id: number;
    comments: InlineComment[];
    status: 'active' | 'fixed' | 'closed' | 'pending';
    filePath: string;
    lineStart: number;
    lineEnd: number;
    isResolved: boolean;
}

export interface CommentDecoration {
    range: import('vscode').Range;
    thread: CommentThread;
    decoration: import('vscode').DecorationOptions;
}

export interface CommentActionContext {
    threadId: number;
    commentId?: number;
    filePath: string;
    lineNumber: number;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export interface ChatContext {
    threadId: number;
    messages: ChatMessage[];
    filePath: string;
    lineNumber: number;
}
