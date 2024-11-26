import { TabManager, PageContent } from './tabManager';
import { addMessageToUI } from './chatUI';
import { LlmInference } from './libs/genai_bundle.mjs';

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface ChatState {
    chatHistory: ChatMessage[];
}

export class ChatManager {
    private llmInference: LlmInference;
    private loraModel: any;
    private chatHistory: ChatMessage[] = [];
    private tabManager: TabManager;
    private debugMode: boolean;
    private maxTokens: number = 1000;
    private maxCharsPerToken: number = 4;
    private isGenerating: boolean = false;
    private isStreaming: boolean = false;
    private bufferSize: number = 100;

    constructor(llmInference: LlmInference, loraModel: any, debugMode = false) {
        this.llmInference = llmInference;
        this.loraModel = loraModel;
        this.debugMode = debugMode;
        this.tabManager = new TabManager(debugMode);
        this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            await this.loadState();
            this.setupTabManager();
            
            if (this.debugMode) {
                console.log("ChatManager initialized");
            }
        } catch (error) {
            console.error("Error initializing ChatManager:", error);
            throw error;
        }
    }

    private async loadState(): Promise<void> {
        try {
            const state = await chrome.storage.local.get(['chatState']) as { chatState?: ChatState };
            if (state.chatState) {
                this.chatHistory = state.chatState.chatHistory;
            }
        } catch (error) {
            console.error("Error loading state:", error);
            throw error;
        }
    }

    private async saveState(): Promise<void> {
        try {
            const chatState: ChatState = { chatHistory: this.chatHistory };
            await chrome.storage.local.set({ chatState });
        } catch (error) {
            console.error("Error saving state:", error);
        }
    }

    private setupTabManager(): void {
        this.tabManager.onTabChange(async (_, pageContent) => {
            await this.handleNewPage(pageContent);
        });
    }

    private async handleNewPage(pageContent: PageContent): Promise<void> {
        try {
            this.chatHistory = [];
            const truncatedContent = this.truncateContent(pageContent.content);
            
            const systemMessage: ChatMessage = {
                role: "system",
                content: `Summarize this webpage (${pageContent.title}): ${truncatedContent}`
            };

            this.chatHistory.push(systemMessage);
            await this.generateSummary(truncatedContent);
            await this.saveState();
        } catch (error) {
            console.error("Error in handleNewPage:", error);
            addMessageToUI(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'assistant');
        }
    }

    private truncateContent(content: string): string {
        const maxCharacters = Math.floor(this.maxTokens * this.maxCharsPerToken * 0.8);
        
        if (content.length <= maxCharacters) return content;

        const firstPart = content.slice(0, Math.floor(maxCharacters * 0.6));
        const lastPart = content.slice(-Math.floor(maxCharacters * 0.2));

        return `${firstPart}\n\n[Content truncated...]\n\n${lastPart}`;
    }

    private formatPrompt(messages: ChatMessage[]): string {
        return messages.map(msg => 
            `${msg.role === 'system' ? 'System: ' : msg.role === 'user' ? 'Human: ' : 'Assistant: '}${msg.content}`
        ).join('\n\n');
    }

    private async generateSummary(content: string): Promise<void> {
        if (this.isGenerating) return;

        const userMessage: ChatMessage = {
            role: "user",
            content: "Please provide a brief, clear summary of the key points."
        };

        this.chatHistory.push(userMessage);

        try {
            this.isGenerating = true;
            let summaryMessage = "";
            let textBuffer = "";

            await this.llmInference.generateResponse(
                this.formatPrompt(this.chatHistory),
                this.loraModel,
                (partialResult: string, done: boolean) => {
                    textBuffer += partialResult;
                    if (done || textBuffer.length > this.bufferSize) {
                        summaryMessage += textBuffer;
                        addMessageToUI(summaryMessage, 'assistant', true);
                            textBuffer = "";
                        }
                    }
                );
    
                if (!summaryMessage) {
                    throw new Error("No summary generated");
                }
    
                this.chatHistory.push({ 
                    role: "assistant", 
                    content: summaryMessage 
                });
    
                await this.saveState();
            } catch (error) {
                if (error instanceof Error && error.message.includes('token limit')) {
                    const shorterContent = this.truncateContent(content).slice(0, Math.floor(content.length * 0.3));
                    this.chatHistory = [
                        {
                            role: "system",
                            content: `Quick summary of: ${shorterContent}`
                        },
                        {
                            role: "user",
                            content: "Summarize briefly."
                        }
                    ];
                    await this.generateSummary(shorterContent);
                    return;
                }
                throw error;
            } finally {
                this.isGenerating = false;
            }
        }
    
        private async streamResponse(prompt: string, updateCallback: (text: string) => void): Promise<string> {
            if (this.isStreaming) return '';
            
            try {
                this.isStreaming = true;
                let fullResponse = '';
                let textBuffer = '';
                
                await this.llmInference.generateResponse(
                    prompt,
                    this.loraModel,
                    (partialResult: string, done: boolean) => {
                        textBuffer += partialResult;
                        if (done || textBuffer.length > this.bufferSize) {
                            fullResponse += textBuffer;
                            updateCallback(fullResponse);
                            textBuffer = '';
                        }
                    }
                );
    
                return fullResponse;
            } catch (error) {
                console.error('Streaming error:', error);
                throw error;
            } finally {
                this.isStreaming = false;
            }
        }
    
        public async processUserMessage(message: string, updateCallback: (text: string) => void): Promise<void> {
            try {
                if (this.isGenerating || this.isStreaming) return;
                
                addMessageToUI(message, 'user');
                
                this.chatHistory.push({ 
                    role: "user", 
                    content: message 
                });
    
                const prompt = this.formatPrompt(this.chatHistory);
                const response = await this.streamResponse(prompt, updateCallback);
    
                if (!response) {
                    throw new Error("No response generated");
                }
    
                this.chatHistory.push({ 
                    role: "assistant", 
                    content: response 
                });
    
                await this.saveState();
            } catch (error) {
                console.error("Error during chat processing:", error);
                addMessageToUI("An error occurred while processing your message. Please try again.", 'assistant');
                throw error;
            }
        }
    
        public async clearContext(): Promise<void> {
            this.chatHistory = [];
            await this.saveState();
        }
    
        public async initializeWithContext(): Promise<void> {
            try {
                await this.loadState();
                await this.tabManager.refreshCurrentTab();
            } catch (error) {
                console.error("Error initializing context:", error);
                throw error;
            }
        }
    
        public getDebugInfo(): string {
            return JSON.stringify({
                historyLength: this.chatHistory.length,
                isGenerating: this.isGenerating,
                isStreaming: this.isStreaming,
                maxTokens: this.maxTokens,
                bufferSize: this.bufferSize
            }, null, 2);
        }
    }