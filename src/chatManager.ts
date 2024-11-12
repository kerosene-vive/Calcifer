import { ChatCompletionMessageParam, MLCEngineInterface } from "@mlc-ai/web-llm";
import { ContentExtractor } from './content';
import { addMessageToUI } from './chatUI';

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface CompletionChunk {
    choices: Array<{
        delta: {
            content?: string;
        };
    }>;
}

interface ChatState {
    chatHistory: ChatCompletionMessageParam[];
    currentTabId?: number;
    currentUrl?: string;
}

export class ChatManager {
    private engine: MLCEngineInterface;
    private chatHistory: ChatCompletionMessageParam[] = [];
    private debugMode: boolean;
    private currentTabId?: number;
    private currentUrl?: string;
    private maxTokens: number = 2000;
    private maxCharsPerToken: number = 4;

    constructor(engine: MLCEngineInterface, debugMode = true) {
        this.engine = engine;
        this.debugMode = debugMode;
        this.validateEngine();
        void this.loadState();
        void this.setupTabListener();
        
        if (this.debugMode) {
            console.log("ChatManager initialized");
        }
    }

    // Validates that the engine has the required methods for chat completions
    private validateEngine(): void {
        if (!this.engine?.chat?.completions?.create) {
            throw new Error("Invalid engine configuration: Missing required methods");
        }
    }

    // Loads the chat state from local storage
    private async loadState(): Promise<void> {
        try {
            const state = await chrome.storage.local.get(['chatState']) as { chatState?: ChatState };
            if (state.chatState) {
                this.chatHistory = state.chatState.chatHistory;
                this.currentTabId = state.chatState.currentTabId;
                this.currentUrl = state.chatState.currentUrl;
                
                if (this.debugMode) {
                    console.log("State loaded successfully");
                }
            }
        } catch (error) {
            console.error("Error loading state:", error);
        }
    }

    // Saves the current chat state to local storage
    private async saveState(): Promise<void> {
        try {
            const chatState: ChatState = {
                chatHistory: this.chatHistory,
                currentTabId: this.currentTabId,
                currentUrl: this.currentUrl
            };
            await chrome.storage.local.set({ chatState });
        } catch (error) {
            console.error("Error saving state:", error);
        }
    }

    // Sets up listeners for tab changes and updates the chat state accordingly
    private async setupTabListener(): Promise<void> {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id && tab.url !== this.currentUrl) {
                this.currentTabId = tab.id;
                this.currentUrl = tab.url;
                await this.handleNewPage();
            }

            chrome.tabs.onActivated.addListener(async (activeInfo) => {
                const tab = await chrome.tabs.get(activeInfo.tabId);
                if (tab.url !== this.currentUrl) {
                    this.currentTabId = activeInfo.tabId;
                    this.currentUrl = tab.url;
                    await this.handleNewPage();
                }
            });

            chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
                if (changeInfo.status === 'complete' && tab.active && tab.url !== this.currentUrl) {
                    this.currentTabId = tabId;
                    this.currentUrl = tab.url;
                    await this.handleNewPage();
                }
            });
        } catch (error) {
            console.error("Error setting up tab listener:", error);
        }
    }

    // Handles actions to be taken when a new page is loaded
    private async handleNewPage(): Promise<void> {
        try {
            const pageContent = await ContentExtractor.getPageContent();
            
            if (!pageContent) {
                throw new Error("No content extracted from page");
            }

            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const currentTab = tabs[0];

            this.chatHistory = [];

            let truncatedContent = this.truncateContent(pageContent);
            const systemMessage: ChatMessage = {
                role: "system",
                content: `Summarize this webpage (${currentTab.title}): ${truncatedContent}`
            };

            if (this.validateMessage(systemMessage)) {
                this.chatHistory.push(systemMessage);
                await this.generateSummary(truncatedContent);
                await this.saveState();
            }
        } catch (error) {
            console.error("Error in handleNewPage:", error);
            addMessageToUI(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`, 'assistant');
        }
    }

    // Truncates the content to fit within the maximum token limit
    private truncateContent(content: string): string {
        const maxCharacters = Math.floor(this.maxTokens * this.maxCharsPerToken * 0.8);
        
        if (content.length <= maxCharacters) {
            return content;
        }

        const firstPart = content.slice(0, Math.floor(maxCharacters * 0.6));
        const lastPart = content.slice(-Math.floor(maxCharacters * 0.2));

        return `${firstPart}\n\n[Content truncated...]\n\n${lastPart}`;
    }

    // Validates that a message has the required structure and content
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

    // Generates a summary of the provided content using the chat engine
    private async generateSummary(content: string): Promise<void> {
        const userMessage: ChatMessage = {
            role: "user",
            content: "Provide a brief, clear summary of the key points."
        };

        if (this.validateMessage(userMessage)) {
            this.chatHistory.push(userMessage);
        }

        let summaryMessage = "";

        try {
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
            } as ChatMessage);

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

            console.error("Error generating summary:", error);
            addMessageToUI(`Error generating summary: ${error instanceof Error ? error.message : 'Unknown error occurred'}`, 'assistant');
        }
    }

    // Processes a user message and generates a response using the chat engine
    public async processUserMessage(message: string, updateCallback: (text: string) => void): Promise<void> {
        try {
            addMessageToUI(message, 'user');
            
            this.chatHistory.push({ 
                role: "user", 
                content: message 
            } as ChatMessage);

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
            } as ChatMessage);

            await this.saveState();
        } catch (error) {
            console.error("Error during chat processing:", error);
            throw error;
        }
    }

    // Initializes the chat manager with the current context
    public async initializeWithContext(): Promise<void> {
        await this.loadState();
        await this.handleNewPage();
    }
}