import * as vscode from 'vscode';
import { AICommentEnhancer } from '../services/aiCommentEnhancer';

interface Comment {
    author: string;
    content: string;
    date: Date;
    isCurrentUser: boolean;
}

export class CommentChatWebviewProvider {
    private currentPanel?: vscode.WebviewPanel;
    private aiEnhancer: AICommentEnhancer;
    private currentComments: Comment[] = [];
    private currentThreadTitle: string = '';
    private onReplySubmit?: (reply: string) => Promise<void>;

    constructor(
        private context: vscode.ExtensionContext
    ) {
        this.aiEnhancer = new AICommentEnhancer();
    }

    async showForNewComment(threadTitle: string, onReplySubmit: (reply: string) => Promise<void>) {
        return this.show([], threadTitle, onReplySubmit);
    }

    async show(comments: Comment[], threadTitle: string, onReplySubmit: (reply: string) => Promise<void>) {
        this.currentComments = comments;
        this.currentThreadTitle = threadTitle;
        this.onReplySubmit = onReplySubmit;
        
        // Create or show the panel
        if (this.currentPanel) {
            this.currentPanel.reveal(vscode.ViewColumn.Beside);
            await this.updateView();
        } else {
            this.currentPanel = vscode.window.createWebviewPanel(
                'azureDevOpsPRCommentChat',
                threadTitle || 'PR Comment Chat',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [this.context.extensionUri]
                }
            );

            // Handle panel disposal
            this.currentPanel.onDidDispose(() => {
                this.currentPanel = undefined;
            });

            // Handle messages from webview
            this.currentPanel.webview.onDidReceiveMessage(async message => {
                switch (message.command) {
                    case 'submitReply':
                        await this.handleReplySubmit(message.text);
                        break;
                    case 'enhanceComment':
                        await this.handleEnhanceComment(message.text, message.action);
                        break;
                    case 'getSuggestions':
                        await this.handleGetSuggestions(message.text);
                        break;
                }
            });
        }

        await this.updateView();
    }

    private async updateView() {
        if (!this.currentPanel) {
            return;
        }

        const aiAvailable = await this.aiEnhancer.isAvailable();
        this.currentPanel.webview.html = this.getHtmlContent(
            this.currentComments,
            aiAvailable,
            this.currentThreadTitle
        );
        
        // Update panel title
        if (this.currentThreadTitle) {
            this.currentPanel.title = this.currentThreadTitle;
        }
    }

    private async handleReplySubmit(reply: string) {
        try {
            if (!this.onReplySubmit) {
                throw new Error('No reply handler configured');
            }
            
            await this.onReplySubmit(reply);
            
            // Add the new comment to the chat
            if (this.currentPanel) {
                this.currentPanel.webview.postMessage({
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
            if (this.currentPanel) {
                this.currentPanel.webview.postMessage({
                    command: 'replyError',
                    error: String(error)
                });
            }
        }
    }

    private async handleEnhanceComment(text: string, action: string) {
        try {
            const enhanced = await this.aiEnhancer.enhanceComment(text, {
                action: action as any
            });
            
            if (this.currentPanel && enhanced) {
                this.currentPanel.webview.postMessage({
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
            
            if (this.currentPanel) {
                this.currentPanel.webview.postMessage({
                    command: 'suggestions',
                    suggestions: suggestions
                });
            }
        } catch (error) {
            console.error('Failed to get suggestions:', error);
        }
    }

    private getHtmlContent(comments: Comment[], aiAvailable: boolean, threadTitle: string): string {
        const commentsHtml = comments.map(comment => {
            const alignment = comment.isCurrentUser ? 'right' : 'left';
            const bgColor = comment.isCurrentUser ? '#0e639c' : '#2d2d30';
            const timestamp = comment.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            return `
                <div class="message ${alignment}">
                    <div class="message-bubble" style="background-color: ${bgColor};">
                        <div class="message-author">${comment.author}</div>
                        <div class="message-content">${this.escapeHtml(comment.content)}</div>
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

        const emptyState = comments.length === 0 ? `
            <div style="text-align: center; padding: 40px 20px; color: var(--vscode-descriptionForeground);">
                <div style="font-size: 48px; margin-bottom: 16px;">💬</div>
                <div style="font-size: 14px; margin-bottom: 8px; font-weight: 600;">${threadTitle}</div>
                <div style="font-size: 12px;">Type your comment below and press Send to add it</div>
            </div>
        ` : '';

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${threadTitle || 'PR Comment Chat'}</title>
            <link rel="stylesheet" href="https://code.visualstudio.com/assets/css/codicons.min.css">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    margin: 0;
                    padding: 0;
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                }
                
                #chatContainer {
                    flex: 1;
                    overflow-y: auto;
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
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
                    max-width: 70%;
                    padding: 12px 16px;
                    border-radius: 12px;
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
                }
                
                .message.left .message-bubble {
                    border-bottom-left-radius: 4px;
                }
                
                .message.right .message-bubble {
                    border-bottom-right-radius: 4px;
                }
                
                .message-author {
                    font-weight: 600;
                    font-size: 12px;
                    margin-bottom: 4px;
                    opacity: 0.9;
                }
                
                .message-content {
                    line-height: 1.5;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                }
                
                .message-time {
                    font-size: 10px;
                    margin-top: 4px;
                    opacity: 0.7;
                    text-align: right;
                }
                
                #inputContainer {
                    padding: 16px;
                    background-color: var(--vscode-input-background);
                    border-top: 1px solid var(--vscode-panel-border);
                    display: flex;
                    gap: 8px;
                    align-items: flex-end;
                }
                
                #replyInput {
                    flex: 1;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 6px;
                    padding: 10px 12px;
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                    resize: vertical;
                    min-height: 40px;
                    max-height: 200px;
                }
                
                #replyInput:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                }
                
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 6px;
                    padding: 10px 20px;
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
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
                    padding: 10px 12px;
                    position: relative;
                }
                
                .ai-button:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                
                .ai-menu {
                    position: absolute;
                    bottom: 50px;
                    right: 16px;
                    background-color: var(--vscode-menu-background);
                    border: 1px solid var(--vscode-menu-border);
                    border-radius: 6px;
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
                    z-index: 1000;
                    min-width: 180px;
                }
                
                .ai-menu-item {
                    width: 100%;
                    text-align: left;
                    padding: 8px 12px;
                    background-color: transparent;
                    color: var(--vscode-menu-foreground);
                    border-radius: 0;
                    justify-content: flex-start;
                }
                
                .ai-menu-item:hover {
                    background-color: var(--vscode-menu-selectionBackground);
                    color: var(--vscode-menu-selectionForeground);
                }
                
                .ai-menu-item:first-child {
                    border-top-left-radius: 6px;
                    border-top-right-radius: 6px;
                }
                
                .ai-menu-item:last-child {
                    border-bottom-left-radius: 6px;
                    border-bottom-right-radius: 6px;
                }
                
                #loadingIndicator {
                    display: none;
                    text-align: center;
                    padding: 8px;
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                }
                
                #loadingIndicator.active {
                    display: block;
                }
                
                .codicon {
                    font-size: 16px;
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
            ${comments.length > 0 ? `<div style="padding: 12px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600;">${threadTitle}</div>` : ''}
            <div id="chatContainer">
                ${comments.length > 0 ? commentsHtml : emptyState}
            </div>
            
            <div id="loadingIndicator">
                <span class="codicon codicon-loading spinning"></span> Enhancing with AI...
            </div>
            
            <div id="inputContainer">
                <textarea id="replyInput" placeholder="Type your reply..." rows="2"></textarea>
                ${aiButtons}
                <button id="sendBtn">
                    ➤ Send
                </button>
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
                    
                    // Click outside to close menu
                    document.addEventListener('click', (e) => {
                        if (!aiEnhanceBtn.contains(e.target) && !aiMenu.contains(e.target)) {
                            aiMenu.style.display = 'none';
                        }
                    });
                    
                    // AI menu items
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
                            msgDiv.innerHTML = \`
                                <div class="message-bubble" style="background-color: #0e639c;">
                                    <div class="message-author">\${message.comment.author}</div>
                                    <div class="message-content">\${escapeHtml(message.comment.content)}</div>
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
                            // Could show suggestions in a dropdown
                            break;
                    }
                });
                
                function escapeHtml(text) {
                    const div = document.createElement('div');
                    div.textContent = text;
                    return div.innerHTML;
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
}
