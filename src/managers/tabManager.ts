/// <reference types="node" />
import { LLMManager } from './llmManager';
import { PopupManager } from '../popup';
import { LinkManager } from './linkManager';
import { Link } from './types';

export class TabManager {
    private static instance: TabManager;
    private currentRequestId: number = 0;
    private currentTabId: number | null = null;
    private lastAnalyzedUrl: string = '';
    private linkManager: LinkManager;
    private popupManager: PopupManager;
    private isAnalyzing = false;

    private constructor(llmManager: LLMManager, popupManager: PopupManager) {
        this.linkManager = new LinkManager(llmManager, this.handleStatusUpdate.bind(this));
        this.popupManager = popupManager;
        this.setupListeners();
    }


    public static getInstance(llmManager: LLMManager, popupManager: PopupManager): TabManager {
        if (!TabManager.instance) {
            TabManager.instance = new TabManager(llmManager, popupManager);
        }
        return TabManager.instance;
    }


    private handleStatusUpdate(status: string): void {
        console.log(`[TabManager] Status update: ${status}`);
    }


    private setupListeners(): void {
        let debounceTimeout: NodeJS.Timeout;
        const handleTabChange = async (url: string) => {
            clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(() => {
                if (url && url !== this.lastAnalyzedUrl) {
                    this.analyzeCurrentPage(url).catch(console.error);
                }
            }, 300); // Debounce tab changes
        };
        chrome.tabs.onActivated.addListener(async (activeInfo) => {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            if (tab.url) handleTabChange(tab.url);
        });
        chrome.tabs.onUpdated.addListener(async (_, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url) {
                handleTabChange(tab.url);
            }
        });
    }


    public async analyzeCurrentPage(url: string): Promise<void> {
        if (this.isAnalyzing || !this.shouldAnalyzeUrl(url)) {
            return;
        }
        const requestId = ++this.currentRequestId;
        this.isAnalyzing = true;
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tab = tabs[0];
            if (!tab.id || requestId !== this.currentRequestId) return;
            this.currentTabId = tab.id;
            const { links } = await this.linkManager.fetchPageContent(this.currentTabId);
            if (requestId !== this.currentRequestId) return;
            if (!links?.length) {
                await this.sendMessageToPopup(requestId, [], url, 'No links found');
                return;
            }
            const rankedLinks = await this.linkManager.processLinks(links, requestId);
            if (requestId === this.currentRequestId) {
                this.lastAnalyzedUrl = url;
                await this.sendMessageToPopup(requestId, rankedLinks, url);
            }
        } catch (error) {
            console.error('[TabManager] Analysis error:', error);
            await this.sendMessageToPopup(
                requestId, 
                [], 
                url, 
                error instanceof Error ? error.message : 'Unknown error'
            );
        } finally {
            this.isAnalyzing = false;
        }
    }


    private shouldAnalyzeUrl(url: string): boolean {
        try {
            const urlObj = new URL(url);
            return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
        } catch {
            return false;
        }
    }


    private async sendMessageToPopup(
        requestId: number, 
        links: Link[], 
        url: string, 
        error?: string
    ): Promise<void> {
        try {
            await this.popupManager.handleNewLinks(links, url, requestId, error);
        } catch (error) {
            console.error('[TabManager] Popup update failed:', error);
        }
    }

}

export default TabManager;