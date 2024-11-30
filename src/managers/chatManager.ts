import { LlmInference } from '../libs/genai_bundle.mjs';
import { MessageService, ChatMessage } from '../services/messageService';

export class ChatManager {
    private chatHistory: ChatMessage[] = [];
    private isGenerating = false;
    private isStreaming = false;
    private readonly maxTokens = 1000;
    private readonly bufferSize = 100;

    constructor(
        private llmInference: LlmInference,
        private loraModel: any,
        private messageService: MessageService,
    ) {
        this.initialize();
    }

    private async initialize(): Promise<void> {
        await this.loadState();
    }

    private async loadState(): Promise<void> {
        const { chatState } = await chrome.storage.local.get(['chatState']) as { chatState?: { chatHistory: ChatMessage[] } };
        if (chatState) this.chatHistory = chatState.chatHistory;
    }

    private async saveState(): Promise<void> {
        await chrome.storage.local.set({ chatState: { chatHistory: this.chatHistory } });
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

}