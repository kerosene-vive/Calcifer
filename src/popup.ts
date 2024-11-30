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
    private port: chrome.runtime.Port;
    private boundCleanup: () => void;

    constructor() {
        // Bind cleanup method once
        this.boundCleanup = this.cleanup.bind(this);
        
        const tabManager = new TabManager();
        this.contentFilter = new ContentFilterManager(tabManager);
        this.debug = document.getElementById('debug') || document.createElement('div');
        this.uiManager = new UIManager();
        this.llmManager = new LLMManager(this.debug, this.handleStatusUpdate.bind(this));
        this.messageService = new MessageService(this.uiManager.addMessageToUI.bind(this.uiManager));
        
        // Connect to background script
        this.port = chrome.runtime.connect({ name: 'popup' });
        
        this.setupListeners();
    }

    private setupListeners(): void {
        // Setup UI event listeners
        this.initializeEventListeners();
        
        // Setup cleanup listeners
        window.addEventListener('unload', this.boundCleanup);
        window.addEventListener('beforeunload', this.boundCleanup);
        chrome.runtime.onSuspend?.addListener(this.boundCleanup);

        // Listen for port disconnect
        this.port.onDisconnect.addListener(() => {
            this.cleanup();
        });

        // Listen for errors
        this.port.onMessage.addListener((message) => {
            if (message.error) {
                console.error('Background script error:', message.error);
                this.handleStatusUpdate(message.error, false);
            }
        });
    }

    public cleanup(): void {
        try {
            // Remove event listeners first
            window.removeEventListener('unload', this.boundCleanup);
            window.removeEventListener('beforeunload', this.boundCleanup);

            // Notify content script to cleanup
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: 'cleanup' })
                        .catch(err => console.error('Failed to send cleanup message:', err));
                }
            });

            // Cleanup managers
            if (this.contentFilter) {
                this.contentFilter.cleanup();
            }

            if (this.chatManager) {
                this.chatManager.cleanup();
            }

            // Disconnect port last
            if (this.port) {
                this.port.disconnect();
            }

        } catch (error) {
            console.error('Error during cleanup:', error);
        }
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
    }
}

// Initialize popup with proper error handling
const initPopup = async () => {
    let manager: PopupManager | null = null;
    try {
        manager = new PopupManager();
        await manager.initialize();
    } catch (error) {
        console.error('Failed to initialize PopupManager:', error);
        if (manager) {
            manager.cleanup();
        }
    }
};

// Use DOMContentLoaded instead of load for faster initialization
document.addEventListener('DOMContentLoaded', () => {
    initPopup().catch(console.error);
});