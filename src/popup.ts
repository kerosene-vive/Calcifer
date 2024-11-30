import "./popup.css";
import { ChatManager } from './managers/chatManager.js';
import { UIManager } from './managers/uiManager.js';
import { LLMManager } from './managers/llmManager.js';
import { MessageService } from './services/messageService.js';
import { TabManager } from './managers/tabManager.js';
import { ContentFilterManager } from './managers/contentFilterManager';

export class PopupManager {
    private contentFilter: ContentFilterManager;
    private chatManager: ChatManager | null = null;
    private uiManager: UIManager;
    private llmManager: LLMManager;
    private messageService: MessageService;
    private isFirstLoad = true;
    private debug: HTMLElement;

    constructor() {
        const tabManager = new TabManager();
        this.contentFilter = new ContentFilterManager(tabManager);
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

   

    private initializeEventListeners(): void {
        const elements = this.uiManager.getElements();
        elements.copyAnswer.addEventListener("click", () => this.uiManager.copyAnswer());
    }
}

window.onload = () => {
    new PopupManager().initialize().catch(console.error);
};