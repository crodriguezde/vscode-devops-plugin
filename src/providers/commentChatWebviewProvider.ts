import * as vscode from 'vscode';
import { AICommentEnhancer } from '../services/aiCommentEnhancer';

interface Comment {
    author: string;
    content: string;
    date: Date;
    isCurrentUser: boolean;
}

interface LineContext {
    fileName: string;
    lineNumber: number;
    lineText?: string;
}

export class CommentChatWebviewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private aiEnhancer: AICommentEnhancer;
    private currentComments: Comment[] = [];
    private currentThreadTitle: string = 'Select a line to comment';
    private currentLineContext?: LineContext;
    private currentThreadId?: number;
    private currentThreadIsResolved: boolean = false;
    private onReplySubmit?: (reply: string) => Promise<void>;
    private onResolve?: () => Promise<void>;
    private selectionChangeDisposable?: vscode.Disposable;

    constructor(
        private context: vscode.ExtensionContext
    ) {
        this.aiEnhancer = new AICommentEnhancer();
        
        // Set up selection listener to show context immediately
        this.setupSelectionListener();
    }

    private setupSelectionListener() {
        this.selectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection(async (e) => {
            const editor = e.textEditor;
            if (!editor) {
                return;
            }

            const selection = editor.selection;
            
            // Only show context for non-empty selections (when text is highlighted)
            if (selection.isEmpty) {
                return;
            }

            const startLine = selection.start.line + 1; // Convert to 1-based
            const endLine = selection.end.line + 1;
            const fileName = this.getFileName(editor.document.uri);

            // Get the selected text (limited to first line if multi-line)
            const selectedText = editor.document.getText(selection);
            const firstLineText = selectedText.split('\n')[0].trim();

            console.log(`[CommentChat] Selection changed: ${fileName} lines ${startLine}-${endLine}`);
            console.log(`[CommentChat] URI scheme: ${editor.document.uri.scheme}`);

            // Build line display
            const lineDisplay = startLine === endLine 
                ? `Line ${startLine}`
                : `Lines ${startLine}-${endLine}`;

            // Update the chat to show this context
            await this.showNewCommentForSelection(fileName, lineDisplay, startLine, endLine, firstLineText);
        });
    }

    private getFileName(uri: vscode.Uri): string {
        // Handle git:// scheme URIs (from diff editor)
        if (uri.scheme === 'git') {
            let gitPath = uri.path;
            if (gitPath.startsWith('/')) {
                gitPath = gitPath.substring(1);
            }
            
            // Try to get just the filename with relative path
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension) {
                const git = gitExtension.exports.getAPI(1);
                const repo = git.repositories[0];
                
                if (repo) {
                    const gitRootName = repo.rootUri.path.split('/').pop();
                    if (gitRootName && gitPath.startsWith(gitRootName + '/')) {
                        gitPath = gitPath.substring(gitRootName.length + 1);
                    }
                }
            }
            
            return gitPath.replace(/\\/g, '/');
        }
        
        // Handle regular file:// URIs
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
            return uri.fsPath.substring(workspaceFolder.uri.fsPath.length + 1)
                .replace(/\\/g, '/');
        }
        return uri.fsPath.split(/[\\/]/).pop() || 'Unknown';
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ): void | Thenable<void> {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'submitReply':
                    await this.handleReplySubmit(message.text);
                    break;
                case 'resolveThread':
                    await this.handleResolveThread();
                    break;
                case 'enhanceComment':
                    await this.handleEnhanceComment(message.text, message.action);
                    break;
                case 'getSuggestions':
                    await this.handleGetSuggestions(message.text);
                    break;
            }
        });

        // Initialize with empty state - show welcome message
        this.clear();
        this.updateView();
    }

    public clear() {
        this.currentComments = [];
        this.currentThreadTitle = 'Comment Chat';
        this.currentLineContext = undefined;
        this.currentThreadId = undefined;
        this.currentThreadIsResolved = false;
        this.onReplySubmit = undefined;
        this.onResolve = undefined;
    }

    async showNewCommentForLine(fileName: string, lineNumber: number, lineText?: string) {
        this.currentComments = [];
        this.currentLineContext = { fileName, lineNumber, lineText };
        this.currentThreadTitle = `${fileName} - Line ${lineNumber}`;
        
        // Set up the reply handler for new comments
        this.onReplySubmit = async (reply: string) => {
            // This will be updated by the calling code via the public method
            vscode.window.showInformationMessage('Comment added to line ' + lineNumber);
        };

        await this.updateView();
    }

    async showNewCommentForSelection(fileName: string, lineDisplay: string, startLine: number, endLine: number, lineText?: string) {
        this.currentComments = [];
        this.currentLineContext = { fileName, lineNumber: startLine, lineText };
        this.currentThreadTitle = `${fileName} - ${lineDisplay}`;
        
        // Set up the reply handler for new comments
        this.onReplySubmit = async (reply: string) => {
            // This will be updated by the calling code via the public method
            vscode.window.showInformationMessage(`Comment added to ${lineDisplay.toLowerCase()}`);
        };

        await this.updateView();
    }

    async showForNewComment(threadTitle: string, onReplySubmit: (reply: string) => Promise<void>) {
        return this.show([], threadTitle, onReplySubmit);
    }

    async show(comments: Comment[], threadTitle: string, onReplySubmit: (reply: string) => Promise<void>, threadId?: number, isResolved?: boolean) {
        this.currentComments = comments;
        this.currentThreadTitle = threadTitle;
        this.onReplySubmit = onReplySubmit;
        this.currentLineContext = undefined; // Clear line context when showing existing thread
        this.currentThreadId = threadId;
        this.currentThreadIsResolved = isResolved || false;
        
        await this.updateView();
    }

    public setCommentSubmitHandler(handler: (reply: string) => Promise<void>) {
        this.onReplySubmit = handler;
    }

    private async updateView() {
        if (!this.view) {
            return;
        }

        const aiAvailable = await this.aiEnhancer.isAvailable();
        this.view.webview.html = this.getHtmlContent(
            this.currentComments,
            aiAvailable,
            this.currentThreadTitle,
            this.currentLineContext
        );
    }

    private async handleReplySubmit(reply: string) {
        try {
            if (!this.onReplySubmit) {
                throw new Error('No reply handler configured');
            }
            
            await this.onReplySubmit(reply);
            
            // Add the new comment to the current comments list
            this.currentComments.push({
                author: 'You',
                content: reply,
                date: new Date(),
                isCurrentUser: true
            });
            
            // If this was a new comment (no existing comments before), enable the resolve button
            if (this.currentComments.length === 1) {
                this.currentThreadIsResolved = false;
            }
            
            // Refresh the entire view to show the new comment and update button states
            await this.updateView();
            
            // Also send success message to clear the input
            if (this.view) {
                this.view.webview.postMessage({
                    command: 'replySuccess',
                    comment: {
                        author: 'You',
                        content: reply,
                        date: new Date(),
                        isCurrentUser: true
                    }
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to submit reply: ${error}`);
            if (this.view) {
                this.view.webview.postMessage({
                    command: 'replyError',
                    error: String(error)
                });
            }
        }
    }

    private async handleResolveThread() {
        try {
            if (!this.onResolve) {
                vscode.window.showWarningMessage('No resolve handler configured');
                return;
            }
            
            await this.onResolve();
            vscode.window.showInformationMessage('✓ Comment thread resolved');
            
            // Optionally update the UI to show resolved state
            if (this.view) {
                this.view.webview.postMessage({
                    command: 'threadResolved'
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to resolve thread: ${error}`);
        }
    }

    private async handleEnhanceComment(text: string, action: string) {
        try {
            const enhanced = await this.aiEnhancer.enhanceComment(text, {
                action: action as any
            });
            
            if (this.view && enhanced) {
                this.view.webview.postMessage({
                    command: 'enhancedResult',
                    enhanced: enhanced
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`AI enhancement failed: ${error}`);
        }
    }

    private async handleGetSuggestions(text: string) {
        try {
            const suggestions = await this.aiEnhancer.suggestImprovements(text);
            
            if (this.view) {
                this.view.webview.postMessage({
                    command: 'suggestions',
                    suggestions: suggestions
                });
            }
        } catch (error) {
            console.error('Failed to get suggestions:', error);
        }
    }

    private getHtmlContent(comments: Comment[], aiAvailable: boolean, threadTitle: string, lineContext?: LineContext): string {
        const commentsHtml = comments.map(comment => {
            const alignment = comment.isCurrentUser ? 'right' : 'left';
            const bgColor = comment.isCurrentUser ? '#0e639c' : '#2d2d30';
            const timestamp = comment.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            // Sanitize HTML but allow safe tags
            const sanitizedContent = this.sanitizeHtml(comment.content);
            
            return `
                <div class="message ${alignment}">
                    <div class="message-bubble" style="background-color: ${bgColor};">
                        <div class="message-author">${this.escapeHtml(comment.author)}</div>
                        <div class="message-content">${sanitizedContent}</div>
                        <div class="message-time">${timestamp}</div>
                    </div>
                </div>
            `;
        }).join('');

        const aiButtons = aiAvailable ? `
            <button id="aiEnhanceBtn" class="ai-button" title="Enhance with AI">
                ✨ AI
            </button>
            <div id="aiMenu" class="ai-menu" style="display: none;">
                <button class="ai-menu-item" data-action="rephrase">
                    ✏️ Rephrase
                </button>
                <button class="ai-menu-item" data-action="expand">
                    ➕ Expand
                </button>
                <button class="ai-menu-item" data-action="simplify">
                    ✂️ Simplify
                </button>
                <button class="ai-menu-item" data-action="fix-grammar">
                    ✅ Fix Grammar
                </button>
            </div>
        ` : '';

        const lineContextHtml = lineContext ? `
            <div class="line-context">
                <div class="context-header">
                    <span class="codicon codicon-file-code"></span>
                    <span title="${this.escapeHtml(lineContext.fileName)}">${this.escapeHtml(lineContext.fileName)}</span>
                </div>
                <div class="context-line">
                    Line ${lineContext.lineNumber}${lineContext.lineText ? `: <code>${this.escapeHtml(lineContext.lineText.substring(0, 60))}${lineContext.lineText.length > 60 ? '...' : ''}</code>` : ''}
                </div>
            </div>
        ` : '';

        const emptyState = comments.length === 0 && !lineContext ? `
            <div style="text-align: center; padding: 40px 20px; color: var(--vscode-descriptionForeground);">
                <div style="font-size: 48px; margin-bottom: 16px;">💬</div>
                <div style="font-size: 14px; margin-bottom: 8px; font-weight: 600;">Comment Chat</div>
                <div style="font-size: 12px;">Select a line in the editor to start commenting</div>
            </div>
        ` : '';

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Comment Chat</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codiconcodicons/0.0.35/codicon.min.css">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    margin: 0;
                    padding: 0;
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                }
                
                .line-context {
                    padding: 12px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    border-bottom: 1px solid var(--vscode-panel-border);
                    margin-bottom: 8px;
                }
                
                .context-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-weight: 600;
                    font-size: 13px;
                    margin-bottom: 4px;
                }
                
                .context-line {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }
                
                .context-line code {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 2px 4px;
                    border-radius: 3px;
                    font-family: var(--vscode-editor-font-family);
                }
                
                #chatContainer {
                    flex: 1;
                    overflow-y: auto;
                    padding: 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                
                .message {
                    display: flex;
                    margin-bottom: 8px;
                }
                
                .message.left {
                    justify-content: flex-start;
                }
                
                .message.right {
                    justify-content: flex-end;
                }
                
                .message-bubble {
                    max-width: 85%;
                    padding: 10px 12px;
                    border-radius: 10px;
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
                }
                
                .message.left .message-bubble {
                    border-bottom-left-radius: 3px;
                }
                
                .message.right .message-bubble {
                    border-bottom-right-radius: 3px;
                }
                
                .message-author {
                    font-weight: 600;
                    font-size: 11px;
                    margin-bottom: 3px;
                    opacity: 0.9;
                }
                
                .message-content {
                    line-height: 1.4;
                    font-size: 12px;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                }
                
                .message-time {
                    font-size: 10px;
                    margin-top: 3px;
                    opacity: 0.7;
                    text-align: right;
                }
                
                #inputContainer {
                    padding: 12px;
                    background-color: var(--vscode-sideBar-background);
                    border-top: 1px solid var(--vscode-panel-border);
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                
                #replyInput {
                    width: 100%;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    padding: 8px 10px;
                    font-family: var(--vscode-font-family);
                    font-size: 12px;
                    resize: vertical;
                    min-height: 60px;
                    max-height: 150px;
                    box-sizing: border-box;
                }
                
                #replyInput:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                }
                
                .button-row {
                    display: flex;
                    gap: 6px;
                }
                
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    padding: 6px 12px;
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    flex: 1;
                }
                
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                
                .ai-button {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    flex: 0 0 auto;
                    position: relative;
                }
                
                .ai-button:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                
                .ai-menu {
                    position: absolute;
                    bottom: 40px;
                    right: 0;
                    background-color: var(--vscode-menu-background);
                    border: 1px solid var(--vscode-menu-border);
                    border-radius: 4px;
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
                    z-index: 1000;
                    min-width: 160px;
                }
                
                .ai-menu-item {
                    width: 100%;
                    text-align: left;
                    padding: 6px 10px;
                    background-color: transparent;
                    color: var(--vscode-menu-foreground);
                    border-radius: 0;
                    justify-content: flex-start;
                }
                
                .ai-menu-item:hover {
                    background-color: var(--vscode-menu-selectionBackground);
                    color: var(--vscode-menu-selectionForeground);
                }
                
                #loadingIndicator {
                    display: none;
                    text-align: center;
                    padding: 6px;
                    color: var(--vscode-descriptionForeground);
                    font-size: 11px;
                }
                
                #loadingIndicator.active {
                    display: block;
                }
                
                .codicon {
                    font-size: 14px;
                }
                
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                
                .spinning {
                    animation: spin 1s linear infinite;
                }
            </style>
        </head>
        <body>
            ${lineContextHtml}
            <div id="chatContainer">
                ${comments.length > 0 ? commentsHtml : emptyState}
            </div>
            
            <div id="loadingIndicator">
                <span class="codicon codicon-loading spinning"></span> Enhancing...
            </div>
            
            <div id="inputContainer">
                <textarea id="replyInput" placeholder="Type your comment..."></textarea>
                <div class="button-row">
                    ${aiButtons}
                    <button id="resolveBtn" class="resolve-button" ${comments.length === 0 || this.currentThreadIsResolved ? 'disabled' : ''} title="${comments.length === 0 ? 'Available after creating comment' : (this.currentThreadIsResolved ? 'Thread already resolved' : 'Resolve this thread')}">
                        <span class="codicon codicon-check"></span> ${this.currentThreadIsResolved ? 'Resolved' : 'Resolve'}
                    </button>
                    <button id="sendBtn">
                        <span class="codicon codicon-send"></span> Send
                    </button>
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                const replyInput = document.getElementById('replyInput');
                const sendBtn = document.getElementById('sendBtn');
                const aiEnhanceBtn = document.getElementById('aiEnhanceBtn');
                const aiMenu = document.getElementById('aiMenu');
                const chatContainer = document.getElementById('chatContainer');
                const loadingIndicator = document.getElementById('loadingIndicator');
                
                // Auto-scroll to bottom
                chatContainer.scrollTop = chatContainer.scrollHeight;
                
                // Focus input on load
                replyInput.focus();
                
                // Send button handler
                sendBtn.addEventListener('click', () => {
                    const text = replyInput.value.trim();
                    if (text) {
                        vscode.postMessage({
                            command: 'submitReply',
                            text: text
                        });
                        sendBtn.disabled = true;
                    }
                });
                
                // Resolve button handler
                const resolveBtn = document.getElementById('resolveBtn');
                if (resolveBtn) {
                    resolveBtn.addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'resolveThread'
                        });
                        resolveBtn.disabled = true;
                    });
                }
                
                // Enter to send (Shift+Enter for new line)
                replyInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendBtn.click();
                    }
                });
                
                // AI Enhancement menu
                if (aiEnhanceBtn) {
                    aiEnhanceBtn.addEventListener('click', () => {
                        aiMenu.style.display = aiMenu.style.display === 'none' ? 'block' : 'none';
                    });
                    
                    document.addEventListener('click', (e) => {
                        if (!aiEnhanceBtn.contains(e.target) && !aiMenu.contains(e.target)) {
                            aiMenu.style.display = 'none';
                        }
                    });
                    
                    document.querySelectorAll('.ai-menu-item').forEach(item => {
                        item.addEventListener('click', () => {
                            const action = item.getAttribute('data-action');
                            const text = replyInput.value.trim();
                            
                            if (text) {
                                loadingIndicator.classList.add('active');
                                vscode.postMessage({
                                    command: 'enhanceComment',
                                    text: text,
                                    action: action
                                });
                            }
                            
                            aiMenu.style.display = 'none';
                        });
                    });
                }
                
                // Handle messages from extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.command) {
                        case 'replySuccess':
                            replyInput.value = '';
                            sendBtn.disabled = false;
                            
                            // Add new message to chat
                            const msgDiv = document.createElement('div');
                            msgDiv.className = 'message right';
                            const sanitizedContent = sanitizeHtml(message.comment.content);
                            msgDiv.innerHTML = \`
                                <div class="message-bubble" style="background-color: #0e639c;">
                                    <div class="message-author">\${escapeHtml(message.comment.author)}</div>
                                    <div class="message-content">\${sanitizedContent}</div>
                                    <div class="message-time">\${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                </div>
                            \`;
                            chatContainer.appendChild(msgDiv);
                            chatContainer.scrollTop = chatContainer.scrollHeight;
                            break;
                            
                        case 'replyError':
                            sendBtn.disabled = false;
                            break;
                            
                        case 'enhancedResult':
                            loadingIndicator.classList.remove('active');
                            replyInput.value = message.enhanced;
                            replyInput.focus();
                            break;
                            
                        case 'suggestions':
                            loadingIndicator.classList.remove('active');
                            break;
                    }
                });
                
                function escapeHtml(text) {
                    const div = document.createElement('div');
                    div.textContent = text;
                    return div.innerHTML;
                }
                
                function sanitizeHtml(html) {
                    let sanitized = html;
                    sanitized = sanitized.replace(/<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>/gi, '');
                    sanitized = sanitized.replace(/\\son\\w+\\s*=\\s*["'][^"']*["']/gi, '');
                    sanitized = sanitized.replace(/\\son\\w+\\s*=\\s*[^\\s>]*/gi, '');
                    sanitized = sanitized.replace(/javascript:/gi, '');
                    const dangerousTags = ['iframe', 'object', 'embed', 'link', 'style', 'meta', 'base'];
                    dangerousTags.forEach(tag => {
                        const regex = new RegExp(\`<\${tag}\\\\b[^<]*(?:(?!</\${tag}>)<[^<]*)*</\${tag}>\`, 'gi');
                        sanitized = sanitized.replace(regex, '');
                        sanitized = sanitized.replace(new RegExp(\`<\${tag}[^>]*/>\`, 'gi'), '');
                    });
                    return sanitized;
                }
            </script>
        </body>
        </html>`;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private sanitizeHtml(html: string): string {
        let sanitized = html;
        sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        sanitized = sanitized.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
        sanitized = sanitized.replace(/\son\w+\s*=\s*[^\s>]*/gi, '');
        sanitized = sanitized.replace(/javascript:/gi, '');
        const dangerousTags = ['iframe', 'object', 'embed', 'link', 'style', 'meta', 'base'];
        dangerousTags.forEach(tag => {
            const regex = new RegExp(`<${tag}\\b[^<]*(?:(?!<\\/${tag}>)<[^<]*)*<\\/${tag}>`, 'gi');
            sanitized = sanitized.replace(regex, '');
            sanitized = sanitized.replace(new RegExp(`<${tag}[^>]*/>`, 'gi'), '');
        });
        return sanitized;
    }

    dispose() {
        this.selectionChangeDisposable?.dispose();
    }
}
