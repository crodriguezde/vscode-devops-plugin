import * as vscode from 'vscode';

export interface CommentEnhancementOptions {
    tone?: 'professional' | 'friendly' | 'constructive';
    action?: 'rephrase' | 'expand' | 'simplify' | 'fix-grammar';
}

export class AICommentEnhancer {
    private languageModel: vscode.LanguageModelChat | undefined;

    constructor() {
        this.initializeLanguageModel();
    }

    private async initializeLanguageModel() {
        try {
            // Try to get a language model (requires GitHub Copilot or similar)
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });
            
            if (models && models.length > 0) {
                this.languageModel = models[0];
            }
        } catch (error) {
            console.log('[AICommentEnhancer] Language model not available:', error);
        }
    }

    async isAvailable(): Promise<boolean> {
        if (!this.languageModel) {
            await this.initializeLanguageModel();
        }
        return this.languageModel !== undefined;
    }

    async enhanceComment(
        originalText: string,
        options: CommentEnhancementOptions = {}
    ): Promise<string | undefined> {
        if (!this.languageModel) {
            await this.initializeLanguageModel();
            if (!this.languageModel) {
                throw new Error('AI language model not available. Please ensure GitHub Copilot or a similar extension is installed and activated.');
            }
        }

        const tone = options.tone || 'professional';
        const action = options.action || 'rephrase';

        let prompt = '';
        
        switch (action) {
            case 'rephrase':
                prompt = `Rephrase the following code review comment to be more ${tone} and clear. Keep it concise but complete. Return only the rephrased comment without any explanation:\n\n${originalText}`;
                break;
            case 'expand':
                prompt = `Expand the following code review comment to be more detailed and ${tone}. Add helpful context and suggestions. Return only the expanded comment:\n\n${originalText}`;
                break;
            case 'simplify':
                prompt = `Simplify the following code review comment to be more concise while maintaining its ${tone} tone. Return only the simplified comment:\n\n${originalText}`;
                break;
            case 'fix-grammar':
                prompt = `Fix any grammar, spelling, or punctuation issues in the following code review comment while maintaining its ${tone} tone. Return only the corrected comment:\n\n${originalText}`;
                break;
        }

        try {
            const messages = [
                vscode.LanguageModelChatMessage.User(prompt)
            ];

            const response = await this.languageModel.sendRequest(
                messages,
                {},
                new vscode.CancellationTokenSource().token
            );

            let enhancedText = '';
            for await (const fragment of response.text) {
                enhancedText += fragment;
            }

            return enhancedText.trim();
        } catch (error) {
            console.error('[AICommentEnhancer] Enhancement failed:', error);
            throw error;
        }
    }

    async suggestImprovements(originalText: string): Promise<string[]> {
        if (!this.languageModel) {
            await this.initializeLanguageModel();
            if (!this.languageModel) {
                return [];
            }
        }

        const prompt = `Analyze this code review comment and suggest 3 alternative phrasings (one professional, one friendly, one constructive). Format as numbered list:\n\n${originalText}`;

        try {
            const messages = [
                vscode.LanguageModelChatMessage.User(prompt)
            ];

            const response = await this.languageModel.sendRequest(
                messages,
                {},
                new vscode.CancellationTokenSource().token
            );

            let suggestionText = '';
            for await (const fragment of response.text) {
                suggestionText += fragment;
            }

            // Parse the numbered list into array
            const lines = suggestionText.split('\n').filter(line => line.trim());
            const suggestions = lines
                .filter(line => /^\d+\./.test(line.trim()))
                .map(line => line.replace(/^\d+\.\s*/, '').trim());

            return suggestions;
        } catch (error) {
            console.error('[AICommentEnhancer] Suggestions failed:', error);
            return [];
        }
    }
}
