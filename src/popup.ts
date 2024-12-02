// popup.ts
import "./popup.css";
import { UIManager } from './managers/uiManager';
import { LLMManager } from './managers/llmManager';
import { TabManager } from './managers/tabManager';

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
    private initialized: boolean = false;
    private activeTab: chrome.tabs.Tab | null = null;

    constructor() {
        this.debug = document.getElementById('debug') || document.createElement('div');
        this.uiManager = new UIManager();
        this.llmManager = new LLMManager(this.debug, this.handleStatusUpdate.bind(this));
        this.tabManager = TabManager.getInstance(this.llmManager, this);
        this.setupListeners();
    }

    private setupListeners(): void {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log("[PopupManager] Received message:", {
                type: message.type,
                dataPresent: !!message.data,
                url: message.data?.url,
                linksCount: message.data?.links?.length
            });

            if (!this.initialized) {
                console.log("[PopupManager] Not initialized yet, ignoring message");
                return false;
            }

            if (message.type === 'NEW_LINKS' && message.data) {
                this.handleNewLinks(message.data.links, message.data.url, message.data.requestId, message.data.error);
            }

            return false;
        });
    }
    
    public async handleNewLinks(links: Array<{ text: string; href: string; score: number }>, url: string, requestId: number, error?: string): Promise<void> {
        console.log("[PopupManager] Handling new links:", {
            count: links.length,
            url,
            requestId
        });

        try {
            if (error) {
                console.error("[PopupManager] Error received:", error);
                this.handleStatusUpdate(`Error: ${error}`, false);
                return;
            }

            if (!links?.length) {
                console.log("[PopupManager] No links to display");
                this.handleStatusUpdate("No links found", false);
                this.uiManager.displayLinks([]);
                return;
            }

            const sortedLinks = [...links].sort((a, b) => b.score - a.score);

            console.log("[PopupManager] Top ranked links:",
                sortedLinks.slice(0, 3).map(l => ({
                    text: l.text.substring(0, 30),
                    score: l.score
                }))
            );

            this.uiManager.displayLinks(sortedLinks);
            this.handleStatusUpdate("Analysis complete", false);
        } catch (error) {
            console.error("[PopupManager] Error displaying links:", error);
            this.handleStatusUpdate("Error displaying links", false);
        }
    }

    private async updateUIForTab(tab: chrome.tabs.Tab): Promise<void> {
        if (!tab.url) return;

        this.handleStatusUpdate("Analyzing page...", true);
        
        // Clear existing links while we wait
        const elements = this.uiManager.getElements();
        elements.linkContainer.innerHTML = '';

        try {
            await this.tabManager.analyzeCurrentPage(tab.url);
        } catch (error) {
            console.error("[PopupManager] Error analyzing page:", error);
            this.handleStatusUpdate("Error analyzing page", false);
        }
    }

    public async initialize(): Promise<void> {
        try {
            this.handleStatusUpdate("Initializing LLM...");
            await this.llmManager.initialize();
            
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const currentTab = tabs[0];
            
            if (!currentTab?.url) {
                throw new Error("No active tab found");
            }

            this.activeTab = currentTab;
            this.initialized = true;
            this.handleStatusUpdate("Analyzing current page...");

            console.log("[PopupManager] Starting initial analysis for:", currentTab.url);
            await this.updateUIForTab(currentTab);

        } catch (error) {
            console.error("[PopupManager] Initialization error:", error);
            this.handleStatusUpdate(`Error: ${error instanceof Error ? error.message : String(error)}`, false);
            throw error;
        }
    }

    private handleStatusUpdate(message: string, isLoading = true): void {
        console.log("[PopupManager] Status Update:", message, isLoading);
        this.uiManager.handleLoadingStatus(message, isLoading);
    }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
    console.log("[PopupManager] DOM loaded, initializing...");
    
    const initPopup = async () => {
        try {
            const manager = new PopupManager();
            await manager.initialize();
        } catch (error) {
            console.error('[PopupManager] Failed to initialize:', error);
            const debug = document.getElementById('debug');
            if (debug) {
                const message = error instanceof Error ? error.message : String(error);
                debug.textContent = `Error initializing: ${message}`;
            }
        }
    };

    initPopup().catch(console.error);
});