import "./popup.css";
import { ChatManager } from './managers/chatManager.js';
import { UIManager } from './managers/uiManager.js';
import { LLMManager } from './managers/llmManager.js';
import { MessageService } from './services/messageService.js';
import { TabManager } from './managers/tabManager.js';

export class PopupManager {
    private chatManager: ChatManager | null = null;
    private uiManager: UIManager;
    private llmManager: LLMManager;
    private messageService: MessageService;
    private isFirstLoad = true;
    private debug: HTMLElement;

    constructor() {
        this.debug = document.getElementById('debug') || document.createElement('div');
        this.uiManager = new UIManager();
        this.llmManager = new LLMManager(this.debug, this.handleStatusUpdate.bind(this));
        this.messageService = new MessageService(this.uiManager.addMessageToUI.bind(this.uiManager));
        this.initializeEventListeners();
    }

    public async initialize(): Promise<void> {
        try {
            this.handleStatusUpdate("Starting initialization");
            await this.llmManager.initialize();

            const tabManager = new TabManager();
            this.chatManager = new ChatManager(
                this.llmManager.getLLMInference(),
                this.llmManager.getLoraModel(),
                this.messageService,
                tabManager
            );
            
            await this.chatManager.initializeWithContext();
            this.isFirstLoad = false;
            this.handleStatusUpdate("Ready", false);
        } catch (error) {
            console.error("Error initializing PopupManager:", error);
            this.handleStatusUpdate("Initialization failed", false);
            throw error;
        }
    }

    private handleStatusUpdate(message: string, isLoading = true): void {
        this.uiManager.handleLoadingStatus(message, isLoading);
    }

    private async handleSubmit(): Promise<void> {
        if (!this.chatManager || this.isFirstLoad) return;

        const message = this.uiManager.getMessage();
        if (!message.trim()) return;

        this.uiManager.resetForNewMessage();
        this.handleStatusUpdate("Generating response...", true);

        try {
            await this.chatManager.processUserMessage(message);
            this.handleStatusUpdate("Ready", false);
        } catch (error) {
            console.error("Error processing message:", error);
            this.handleStatusUpdate("Error generating response", false);
        }
    }

    private handleInputKeyup(event: KeyboardEvent): void {
        const input = event.target as HTMLInputElement;
        input.value ? this.uiManager.enableInputs() : this.uiManager.disableSubmit();
        
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            this.handleSubmit();
        }
    }

    private initializeEventListeners(): void {
        const elements = this.uiManager.getElements();
        elements.queryInput.addEventListener("keyup", this.handleInputKeyup.bind(this));
        elements.submitButton.addEventListener("click", this.handleSubmit.bind(this));
        elements.copyAnswer.addEventListener("click", () => this.uiManager.copyAnswer());
    }
}

window.onload = () => {
    new PopupManager().initialize().catch(console.error);
};