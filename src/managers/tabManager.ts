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

    private constructor(llmManager: LLMManager, popupManager: PopupManager) {
        this.linkManager = new LinkManager(llmManager, this.handleStatusUpdate.bind(this));
        this.popupManager = popupManager;
        this.setupListeners();
    }

    private handleStatusUpdate(status: string): void {
        console.log(`[TabManager] Status update: ${status}`);
    }


    public static getInstance(llmManager: LLMManager, popupManager: PopupManager): TabManager {
        if (!TabManager.instance) {
            TabManager.instance = new TabManager(llmManager, popupManager);
        }
        return TabManager.instance;
    }


    private setupListeners(): void {
        chrome.tabs.onActivated.addListener(async (activeInfo) => {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            if (tab.url && tab.url !== this.lastAnalyzedUrl) {
                await this.analyzeCurrentPage(tab.url);
            }
        });
        chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url) {
                await this.analyzeCurrentPage(tab.url);
            }
        });
    }


    private async fetchPageContent(tabId: number): Promise<any> {
        const result = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                function getContextInfo(link: HTMLAnchorElement) {
                    const rect = link.getBoundingClientRect();
                    const parent = link.parentElement;
                    const text = parent?.textContent || '';
                    const linkText = link.textContent || '';
                    const linkIndex = text.indexOf(linkText);
                    const before = linkIndex >= 0 ? 
                        text.slice(Math.max(0, linkIndex - 50), linkIndex).trim() : '';
                    const after = linkIndex >= 0 ? 
                        text.slice(linkIndex + linkText.length, 
                                 linkIndex + linkText.length + 50).trim() : '';
                    return {
                        surrounding: `${before} ... ${after}`.trim(),
                        isInHeading: !!parent?.tagName.match(/^H[1-6]$/),
                        isInNav: !!link.closest('nav'),
                        isInMain: !!link.closest('main, article, [role="main"]'),
                        position: {
                            top: Math.round(rect.top),
                            isVisible: rect.top < window.innerHeight
                        }
                    };
                }
                return {
                    links: Array.from(document.getElementsByTagName('a'))
                        .filter(link => {
                            try {
                                const rect = link.getBoundingClientRect();
                                return link.href && 
                                       link.href.startsWith('http') && 
                                       !link.href.includes('#') &&
                                       rect.width > 0 && 
                                       rect.height > 0;
                            } catch {
                                return false;
                            }
                        })
                        .map((link, id) => ({
                            id,
                            text: (link.textContent || '').trim(),
                            href: link.href,
                            context: getContextInfo(link),
                            score: 0
                        }))
                        .filter(link => link.text.length > 0)
                        .slice(0, 20)};}
        });
        if (!result[0]?.result) {
            throw new Error('Failed to gather links');
        }
        return result[0].result;
    }


    public async analyzeCurrentPage(url: string): Promise<void> {
        const requestId = ++this.currentRequestId;
        console.log(`[TabManager] Starting analysis #${requestId} for:`, url);
        if (!this.shouldAnalyzeUrl(url)) {
            console.log(`[TabManager] Skipping analysis for ${url}`);
            return;
        }
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tab = tabs[0];
            if (!tab.id || requestId !== this.currentRequestId) return;
            this.currentTabId = tab.id;
            const { links } = await this.fetchPageContent(this.currentTabId);
            if (requestId !== this.currentRequestId) return;
            if (!links || links.length === 0) {
                await this.sendMessageToPopup(requestId, [], url, 'No links found');
                return;
            }
            const rankedLinks = await this.linkManager.rankLinks(links, requestId);
            if (requestId !== this.currentRequestId) return;
            this.lastAnalyzedUrl = url;
            await this.sendMessageToPopup(requestId, rankedLinks, url);
        } catch (error) {
            console.error(`[TabManager] Analysis error:`, error);
            await this.sendMessageToPopup(requestId, [], url, error instanceof Error ? error.message : 'Unknown error');
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


    private async sendMessageToPopup(requestId: number, links: Link[], url: string, error?: string): Promise<void> {
        try {
            await this.popupManager.handleNewLinks(links, url, requestId, error);
        } catch (error) {
            console.log(`[TabManager] Popup update failed:`, error);
        }
    }

}

export default TabManager;