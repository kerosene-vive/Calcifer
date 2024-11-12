import { TabManager, PageContent } from './tabManager';
import { ContentExtractor } from './content';
import { addMessageToUI } from './chatUI';
import { 
    mlcEngineService, 
    MLCEngineInterface, 
    ChatCompletionMessageParam,
    ChatMessage,
    CompletionChunk
} from './mlcEngineService';

interface ChatState {
    chatHistory: ChatCompletionMessageParam[];
}

export class ChatManager {
    private engine: MLCEngineInterface;
    private chatHistory: ChatCompletionMessageParam[] = [];
    private tabManager: TabManager;
    private debugMode: boolean;
    private maxTokens: number = 2000;
    private maxCharsPerToken: number = 4;

    constructor(debugMode = false) {
        this.debugMode = debugMode;
        this.tabManager = new TabManager(debugMode);
        this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            this.engine = await mlcEngineService.initializeEngine();
            this.validateEngine();
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

    private validateEngine(): void {
        if (!this.engine?.chat?.completions?.create) {
            throw new Error("Invalid engine configuration");
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

            if (this.validateMessage(systemMessage)) {
                this.chatHistory.push(systemMessage);
                await this.generateSummary(truncatedContent);
                await this.saveState();
            }
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

    private validateMessage(message: ChatMessage): boolean {
        return Boolean(
            message &&
            typeof message === 'object' &&
            'role' in message &&
            'content' in message &&
            typeof message.content === 'string' &&
            message.content.length > 0
        );
    }

    private async generateSummary(content: string): Promise<void> {
        const userMessage: ChatMessage = {
            role: "user",
            content: "Provide a brief, clear summary of the key points."
        };

        if (this.validateMessage(userMessage)) {
            this.chatHistory.push(userMessage);
        }

        try {
            let summaryMessage = "";
            const completion = await this.engine.chat.completions.create({
                stream: true,
                messages: this.chatHistory,
            });

            for await (const chunk of completion as AsyncIterable<CompletionChunk>) {
                const curDelta = chunk.choices[0]?.delta?.content;
                if (curDelta) {
                    summaryMessage += curDelta;
                    addMessageToUI(summaryMessage, 'assistant', true);
                }
            }

            if (!summaryMessage) {
                throw new Error("No summary generated");
            }

            this.chatHistory.push({ 
                role: "assistant", 
                content: summaryMessage 
            });

            await this.saveState();
        } catch (error) {
            if (error instanceof Error && error.message.includes('ContextWindowSizeExceeded')) {
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
        }
    }

    public async processUserMessage(message: string, updateCallback: (text: string) => void): Promise<void> {
        try {
            addMessageToUI(message, 'user');
            
            this.chatHistory.push({ 
                role: "user", 
                content: message 
            });

            let curMessage = "";
            const completion = await this.engine.chat.completions.create({
                stream: true,
                messages: this.chatHistory,
            });

            for await (const chunk of completion as AsyncIterable<CompletionChunk>) {
                const curDelta = chunk.choices[0]?.delta?.content;
                if (curDelta) {
                    curMessage += curDelta;
                    updateCallback(curMessage);
                    addMessageToUI(curMessage, 'assistant', true);
                }
            }

            this.chatHistory.push({ 
                role: "assistant", 
                content: curMessage 
            });

            await this.saveState();
        } catch (error) {
            console.error("Error during chat processing:", error);
            throw error;
        }
    }

    public async initializeWithContext(): Promise<void> {
        await this.loadState();
        await this.tabManager.refreshCurrentTab();
    }
}