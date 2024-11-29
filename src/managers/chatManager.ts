import { TabManager, PageContent } from './tabManager';
import { LlmInference } from '../libs/genai_bundle.mjs';
import { MessageService, ChatMessage } from '../services/messageService';

export class ChatManager {
    private chatHistory: ChatMessage[] = [];
    private isGenerating = false;
    private isStreaming = false;
    private readonly maxTokens = 1000;
    private readonly maxCharsPerToken = 4;
    private readonly bufferSize = 100;

    constructor(
        private llmInference: LlmInference,
        private loraModel: any,
        private messageService: MessageService,
        private tabManager: TabManager
    ) {
        this.initialize();
    }

    private async initialize(): Promise<void> {
        await this.loadState();
        this.setupTabManager();
    }

    private async loadState(): Promise<void> {
        const { chatState } = await chrome.storage.local.get(['chatState']) as { chatState?: { chatHistory: ChatMessage[] } };
        if (chatState) this.chatHistory = chatState.chatHistory;
    }

    private async saveState(): Promise<void> {
        await chrome.storage.local.set({ chatState: { chatHistory: this.chatHistory } });
    }

    private setupTabManager(): void {
        this.tabManager.onTabChange(async (_, pageContent) => {
            await this.handleNewPage(pageContent);
        });
    }

    private async handleNewPage(pageContent: PageContent): Promise<void> {
        try {
            this.chatHistory = [{
                role: "system",
                content: `Summarize this webpage (${pageContent.title}): ${this.truncateContent(pageContent.content)}`
            }];

            await this.generateSummary(pageContent.content);
            await this.saveState();
        } catch (error) {
            this.messageService.showError(error instanceof Error ? error.message : 'Unknown error');
        }
    }

    private truncateContent(content: string): string {
        const maxChars = Math.floor(this.maxTokens * this.maxCharsPerToken * 0.8);
        if (content.length <= maxChars) return content;
        
        const firstPart = content.slice(0, Math.floor(maxChars * 0.6));
        const lastPart = content.slice(-Math.floor(maxChars * 0.2));
        return `${firstPart}\n\n[Content truncated...]\n\n${lastPart}`;
    }

    private formatPrompt(messages: ChatMessage[]): string {
        return messages.map(msg => 
            `${msg.role === 'system' ? 'System: ' : msg.role === 'user' ? 'Human: ' : 'Assistant: '}${msg.content}`
        ).join('\n\n');
    }

    private async generateResponse(prompt: string): Promise<string> {
        let response = '';
        let buffer = '';

        await this.llmInference.generateResponse(
            prompt,
            this.loraModel,
            (partial: string, done: boolean) => {
                buffer += partial;
                if (done || buffer.length > this.bufferSize) {
                    response += buffer;
                    this.messageService.updateAssistantMessage(response, true);
                    buffer = '';
                }
            }
        );

        return response || '';
    }

    private async generateSummary(content: string): Promise<void> {
        if (this.isGenerating) return;

        try {
            this.isGenerating = true;
            this.chatHistory.push({
                role: "user",
                content: "Please provide a brief, clear summary of the key points."
            });

            const summary = await this.generateResponse(this.formatPrompt(this.chatHistory));
            
            if (!summary) throw new Error("No summary generated");
            
            this.chatHistory.push({ role: "assistant", content: summary });
            await this.saveState();

        } catch (error) {
            if (error instanceof Error && error.message.includes('token limit')) {
                const shorterContent = this.truncateContent(content).slice(0, Math.floor(content.length * 0.3));
                this.chatHistory = [
                    { role: "system", content: `Quick summary of: ${shorterContent}` },
                    { role: "user", content: "Summarize briefly." }
                ];
                await this.generateSummary(shorterContent);
                return;
            }
            throw error;
        } finally {
            this.isGenerating = false;
        }
    }

    public async processUserMessage(message: string): Promise<void> {
        if (this.isGenerating || this.isStreaming) return;

        try {
            this.messageService.addUserMessage(message);
            this.chatHistory.push({ role: "user", content: message });

            const response = await this.generateResponse(this.formatPrompt(this.chatHistory));
            if (!response) throw new Error("No response generated");

            this.chatHistory.push({ role: "assistant", content: response });
            await this.saveState();

        } catch (error) {
            console.error("Error during chat processing:", error);
            this.messageService.showError("An error occurred while processing your message. Please try again.");
            throw error;
        }
    }

    public async clearContext(): Promise<void> {
        this.chatHistory = [];
        await this.saveState();
    }

    public async initializeWithContext(): Promise<void> {
        await this.loadState();
        await this.tabManager.refreshCurrentTab();
    }
}