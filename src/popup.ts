/// <reference types="chrome"/>
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
    private currentRequestId: number | null = null;

    constructor() {
        this.debug = document.getElementById('debug') || document.createElement('div');
        this.uiManager = new UIManager();
        this.llmManager = new LLMManager(this.debug, this.handleStatusUpdate.bind(this));
        this.tabManager = TabManager.getInstance(this.llmManager, this);
        this.setupListeners();
    }


    private setupListeners(): void {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!this.initialized) return false;
            switch (message.type) {
                case 'NEW_LINKS':
                    this.handleNewLinks(
                        message.data?.links, 
                        message.data?.url, 
                        message.data?.requestId, 
                        message.data?.error
                    );
                    break;
                case 'PARTIAL_LINKS_UPDATE':
                    this.handlePartialUpdate(message.links, message.requestId);
                    break;
            }
            return false;
        });
    }


    private async updateUIForTab(tab: chrome.tabs.Tab): Promise<void> {
        if (!tab.url) return;
        this.uiManager.clearLinks();
        this.handleStatusUpdate("Analyzing page...", true);
        try {
            await this.tabManager.analyzeCurrentPage(tab.url);
        } catch (error) {
            console.error("[PopupManager] Error analyzing page:", error);
            this.handleStatusUpdate("Error analyzing page", false);
        }
    }

    public async handleNewLinks(links: Link[], url: string, requestId: number, error?: string): Promise<void> {
        this.currentRequestId = requestId;
        if (error) {
            this.uiManager.displayLinks([]);
            this.handleStatusUpdate(`Error: ${error}`, false);
            return;
        }
        if (!links?.length) {
            this.uiManager.displayLinks([]);
            this.handleStatusUpdate("No links found", false);
            return;
        }
        const sortedLinks = [...links]
            .filter(link => link.score > 0)
            .sort((a, b) => b.score - a.score);
        this.uiManager.displayLinks(sortedLinks);
        this.handleStatusUpdate(
            sortedLinks.length > 0 ? "Analysis complete" : "No relevant links found", 
            false
        );
    }


    private handlePartialUpdate(links: Link[], requestId: number): void {
        if (requestId !== this.currentRequestId) return;
        const sortedLinks = [...links]
            .filter(link => link.score > 0)
            .sort((a, b) => b.score - a.score);
        if (sortedLinks.length > 0) {
            this.uiManager.displayLinks(sortedLinks);
            this.handleStatusUpdate("Analyzing links...", true);
        }
    }

    public async initialize(): Promise<void> {
        try {
            this.handleStatusUpdate("Initializing...", true);
            await this.llmManager.initialize();
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.url) throw new Error("No active tab found");

            this.activeTab = tab;
            this.initialized = true;
            await this.updateUIForTab(tab);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.uiManager.handleLoadingError(message);
            throw error;
        }
    }


    private handleStatusUpdate(message: string, isLoading = true): void {
        this.uiManager.handleLoadingStatus(message, isLoading);
    }

}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const manager = new PopupManager();
        await manager.initialize();
    } catch (error) {
        console.error('[PopupManager] Failed to initialize:', error);
        const debug = document.getElementById('debug');
        if (debug) {
            debug.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
});