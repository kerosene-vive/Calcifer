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
    private static instance: PopupManager | null = null;
    private uiManager: UIManager;
    private llmManager: LLMManager;
    private tabManager: TabManager;
    private debug: HTMLElement;
    private initialized = false;
    private activeTab: chrome.tabs.Tab | null = null;
    private currentRequestId: number | null = null;
    private initPromise: Promise<void> | null = null;
    public static getInstance(): PopupManager {
        if (!PopupManager.instance) {
            PopupManager.instance = new PopupManager();
        }
        return PopupManager.instance;
    }

    private constructor() {
        this.debug = document.getElementById('debug') || document.createElement('div');
        this.uiManager = new UIManager();
        // Use LLMManager's getInstance method
        this.llmManager = LLMManager.getInstance(this.debug, this.handleStatusUpdate.bind(this));
        this.tabManager = TabManager.getInstance(this.llmManager, this);
        this.setupListeners();
    }


    private setupListeners(): void {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const handleMessage = async () => {
                if (!this.initialized) {
                    await this.waitForInitialization();
                }
                switch (message.type) {
                    case 'NEW_LINKS':
                        await this.handleNewLinks(
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
            };
            handleMessage().catch(console.error);
            return false;
        });
    }


    private async waitForInitialization(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) {
            await this.initPromise;
            return;
        }
        await this.initialize();
    }


    public async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;
        this.initPromise = (async () => {
            try {
                this.handleStatusUpdate("Starting initialization...", true);
                this.handleStatusUpdate("Initializing AI model...", true);
                await this.llmManager.initialize();
                this.handleStatusUpdate("Getting active tab...", true);
                const [tab] = await chrome.tabs.query({ 
                    active: true, 
                    currentWindow: true 
                });
                if (!tab?.url) {
                    throw new Error("No active tab found");
                }
                this.activeTab = tab;
                this.initialized = true;
                this.handleStatusUpdate("Starting page analysis...", true);
                await this.updateUIForTab(tab);

            } catch (error) {
                this.initPromise = null;
                const message = error instanceof Error ? error.message : String(error);
                this.uiManager.handleLoadingError(message);
                throw error;
            }
        })();
        return this.initPromise;
    }


    private async updateUIForTab(tab: chrome.tabs.Tab): Promise<void> {
        if (!tab.url) return;
        try {
            this.uiManager.clearLinks();
            this.handleStatusUpdate("Analyzing page content...", true);
            await this.tabManager.analyzeCurrentPage(tab.url);
        } catch (error) {
            console.error("[PopupManager] Page analysis error:", error);
            this.handleStatusUpdate(
                `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 
                false
            );
        }
    }


    public async handleNewLinks(
        links: Link[], 
        url: string, 
        requestId: number, 
        error?: string
    ): Promise<void> {
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
            this.handleStatusUpdate("Processing links...", true);
        }
    }


    private handleStatusUpdate(message: string, isLoading = true): void {
        this.uiManager.handleLoadingStatus(message, isLoading);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const manager = PopupManager.getInstance();
        await manager.initialize();
    } catch (error) {
        console.error('[PopupManager] Failed to initialize:', error);
        const debug = document.getElementById('debug');
        if (debug) {
            debug.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
});