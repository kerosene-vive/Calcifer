import "./popup.css";
import { UIManager } from './managers/uiManager.js';
import { LLMManager } from './managers/llmManager.js';
import { TabManager } from './managers/tabManager.js';

interface Link {
    text: string;
    href: string;
    score: number;
}

export class PopupManager {
    private uiManager: UIManager;
    private llmManager: LLMManager;
    private tabManager: TabManager;
    private debug: HTMLElement;
    private port: chrome.runtime.Port;
    private initialized: boolean = false;

    constructor() {
        this.debug = document.getElementById('debug') || document.createElement('div');
        this.uiManager = new UIManager();
        this.llmManager = new LLMManager(this.debug, this.handleStatusUpdate.bind(this));
        this.tabManager = TabManager.getInstance();
        this.port = chrome.runtime.connect({ name: 'popup' });
        this.setupListeners();
    }

    private setupListeners(): void {
        // Global message listener
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!this.initialized) {
                console.log("[PopupManager] Waiting for initialization...");
                return;
            }

            console.log("[PopupManager] Received message:", message);
            
            if (message.type === 'NEW_LINKS' && message.data) {
                console.log("[PopupManager] Processing new links for:", message.data.url);
                this.handleNewLinks(message.data.links, message.data.url);
                return true;
            }
        });

        // Tab change listener
        chrome.tabs.onActivated.addListener(async (activeInfo) => {
            if (!this.initialized) return;
            
            const tab = await chrome.tabs.get(activeInfo.tabId);
            console.log("[PopupManager] Tab changed:", tab.url);
            this.refreshLinks();
        });

        // Tab update listener
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (!this.initialized) return;
            
            if (changeInfo.status === 'complete') {
                console.log("[PopupManager] Tab updated:", tab.url);
                this.refreshLinks();
            }
        });
    }

    private async refreshLinks(): Promise<void> {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0]?.url) {
                console.log("[PopupManager] Refreshing links for:", tabs[0].url);
                const links = await this.tabManager.getCurrentPageLinks();
                this.handleNewLinks(links, tabs[0].url);
            }
        } catch (error) {
            console.error("[PopupManager] Error refreshing links:", error);
        }
    }

    private handleNewLinks(links: Link[], url: string): void {
        console.log("[PopupManager] Handling new links for:", url, links);
        
        // Clear previous content
        const elements = this.uiManager.getElements();
        if (elements.linkContainer) {
            elements.linkContainer.innerHTML = '';
        }

        // Add URL message
        UIManager.addMessageToUI(
            `Analyzing links from: ${url}`,
            'assistant',
            elements,
            true
        );

        // Display links
        if (links && links.length > 0) {
            console.log("[PopupManager] Displaying links:", links);
            this.uiManager.displayLinks(links);
        } else {
            UIManager.addMessageToUI(
                "No relevant links found on this page.",
                'assistant',
                elements,
                true
            );
        }
    }

    public async initialize(): Promise<void> {
        try {
            this.handleStatusUpdate("Starting initialization");
            
            // Initialize LLM
            await this.llmManager.initialize();
            
            // Mark as initialized
            this.initialized = true;
            
            // Get initial links
            await this.refreshLinks();
            
            this.handleStatusUpdate("Ready", false);
        } catch (error) {
            console.error("[PopupManager] Error initializing:", error);
            this.handleStatusUpdate("Initialization failed", false);
            throw error;
        }
    }

    private handleStatusUpdate(message: string, isLoading = true): void {
        this.uiManager.handleLoadingStatus(message, isLoading);
    }
}

const initPopup = async () => {
    let manager: PopupManager | null = null;
    try {
        manager = new PopupManager();
        await manager.initialize();
    } catch (error) {
        console.error('[PopupManager] Failed to initialize:', error);
    }
};

// Initialize only after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log("[PopupManager] DOM loaded, initializing...");
    initPopup().catch(console.error);
});