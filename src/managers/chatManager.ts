import { LlmInference } from '../libs/genai_bundle.mjs';
import { MessageService, ChatMessage } from '../services/messageService';
import { TabManager } from './tabManager';

interface ChatState {
  chatHistory: ChatMessage[];
}

export class ChatManager {
  private chatHistory: ChatMessage[] = [];
  private isGenerating = false;
  private isStreaming = false;
  private readonly bufferSize = 100;
  private abortController: AbortController | null = null;

  constructor(
    private llmInference: LlmInference,
    private loraModel: any,
    private messageService: MessageService,
    private tabManager: TabManager
  ) {
    this.initialize();
    this.setupTabListener();
  }

  private async initialize(): Promise<void> {
    try {
      await this.loadState();
    } catch (error) {
      console.error('Failed to initialize ChatManager:', error);
      throw error;
    }
  }

  private setupTabListener(): void {
    this.tabManager.onTabChange(async () => {
      await this.loadState();
    });
  }

  private async loadState(): Promise<void> {
    try {
      const { chatState } = await chrome.storage.local.get(['chatState']) as { chatState?: ChatState };
      if (chatState?.chatHistory) {
        this.chatHistory = chatState.chatHistory;
      }
    } catch (error) {
      console.error('Failed to load chat state:', error);
      this.chatHistory = [];
    }
  }

  private async saveState(): Promise<void> {
    try {
      await chrome.storage.local.set({ 
        chatState: { 
          chatHistory: this.chatHistory.slice(-50) // Keep last 50 messages
        } 
      });
    } catch (error) {
      console.error('Failed to save chat state:', error);
    }
  }

  private formatPrompt(messages: ChatMessage[]): string {
    return messages.map(msg => {
      const role = msg.role === 'system' ? 'System: ' : 
                  msg.role === 'user' ? 'Human: ' : 
                  'Assistant: ';
      return `${role}${msg.content}`;
    }).join('\n\n');
  }

  private async generateResponse(prompt: string): Promise<string> {
    this.abortController = new AbortController();
    let response = '';
    let buffer = '';

    try {
      await this.llmInference.generateResponse(
        prompt,
        (partial: string, done: boolean) => {
          if (this.abortController?.signal.aborted) {
            throw new Error('Generation aborted');
          }

          buffer += partial;
          if (done || buffer.length > this.bufferSize) {
            response += buffer;
            this.messageService.updateAssistantMessage(response, true);
            buffer = '';
          }
        },
        this.abortController?.signal
      );

      return response || '';
    } catch (error) {
      if (error instanceof Error && error.message === 'Generation aborted') {
        console.log('Generation was aborted');
        return response;
      }
      throw error;
    }
  }

  public async processUserMessage(message: string): Promise<void> {
    if (this.isGenerating || this.isStreaming) return;

    this.isGenerating = true;
    try {
      this.messageService.addUserMessage(message);
      this.chatHistory.push({ role: "user", content: message });

      const response = await this.generateResponse(this.formatPrompt(this.chatHistory));
      if (!response) throw new Error("No response generated");

      this.chatHistory.push({ role: "assistant", content: response });
      await this.saveState();
    } catch (error) {
      console.error("Error during chat processing:", error);
      this.messageService.showError(
        "An error occurred while processing your message. Please try again."
      );
      throw error;
    } finally {
      this.isGenerating = false;
    }
  }

  public async clearContext(): Promise<void> {
    try {
      this.chatHistory = [];
      await this.saveState();
    } catch (error) {
      console.error('Failed to clear context:', error);
      throw error;
    }
  }

  public cleanup(): void {
    try {
      // Abort any ongoing generation
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }

      // Reset states
      this.isGenerating = false;
      this.isStreaming = false;

      // Save final state
      this.saveState().catch(console.error);
    } catch (error) {
      console.error('Error during ChatManager cleanup:', error);
    }
  }
}