
import { LLMManager } from './llmManager';
import { PopupManager } from '../popup';

interface Link {
    id: number;
    text: string;
    href: string;
    context: {
        surrounding: string;
        isInHeading: boolean;
        isInNav: boolean;
        isInMain: boolean;
        position: {
            top: number;
            isVisible: boolean;
        };
    };
    score: number;
}

interface PageInfo {
    title: string;
    h1: string;
    keywords: string;
    description: string;
    url: string;
    isEcommerce: boolean;
    isSearch: boolean;
}

export class TabManager {
    private static instance: TabManager;
    private currentRequestId: number = 0;
    private currentTabId: number | null = null;
    private lastAnalyzedUrl: string = '';
    private llmManager: LLMManager;
    private popupManager: PopupManager;
    private readonly MAX_TOKENS = 1000;
    private readonly MAX_LINKS = 20;

    private constructor(llmManager: LLMManager, popupManager: PopupManager) {
        this.llmManager = llmManager;
        this.popupManager = popupManager;
        this.setupListeners();
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

    public async analyzeCurrentPage(url: string): Promise<void> {
        const requestId = ++this.currentRequestId;
        console.log(`[TabManager] Starting analysis #${requestId} for:`, url);

        const isCurrentRequest = () => requestId === this.currentRequestId;

        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tab = tabs[0];

            if (!tab.id || !isCurrentRequest()) {
                console.log(`[TabManager] Analysis #${requestId} cancelled - outdated or invalid tab`);
                return;
            }

            this.currentTabId = tab.id;
            const pageContent = await this.fetchPageContent(this.currentTabId);
            const { pageInfo, links } = this.processPageContent(pageContent);

            if (!isCurrentRequest()) {
                console.log(`[TabManager] Analysis #${requestId} cancelled - newer request in progress`);
                return;
            }

            if (links.length === 0) {
                console.log(`[TabManager] No links found for request #${requestId}`);
                const errorMessage = 'No links found';
                await this.sendMessageToPopup(requestId, [], url, errorMessage);
                return;
            }

            await this.rankLinks(links, pageInfo, requestId);

            if (!isCurrentRequest()) {
                console.log(`[TabManager] Analysis #${requestId} cancelled - rankings outdated`);
                return;
            }

            this.lastAnalyzedUrl = url;

            // Send ranked links to the popup
            console.log(`[TabManager] Broadcasting ${links.length} ranked links for request #${requestId}`);
            await this.sendMessageToPopup(requestId, links, url);
        } catch (error) {
            console.error(`[TabManager] Error in analysis #${requestId}:`, error);
            await this.sendMessageToPopup(requestId, [], url, error instanceof Error ? error.message : 'Unknown error');
        }
    }

    private async fetchPageContent(tabId: number): Promise<any> {
        const result = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                function getPageInfo() {
                    return {
                        title: document.title,
                        h1: document.querySelector('h1')?.textContent || '',
                        keywords: document.querySelector('meta[name="keywords"]')?.content || '',
                        description: document.querySelector('meta[name="description"]')?.content || '',
                        url: window.location.href,
                        isEcommerce: !!document.querySelector('[data-testid="price"], .price, .product, .buy, .cart'),
                        isSearch: window.location.href.includes('google.com/search') || 
                                window.location.href.includes('bing.com/search')
                    };
                }

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

                // Get all visible links
                const links = Array.from(document.getElementsByTagName('a'))
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
                        score: 0 // Initial score
                    }))
                    .filter(link => link.text.length > 0)
                    .slice(0, 20);  // Limit to prevent token overflow

                return {
                    pageInfo: getPageInfo(),
                    links
                };
            }
        });

        if (!result[0]?.result) {
            throw new Error('Failed to gather links');
        }

        return result[0].result;
    }

    private processPageContent(content: any): { pageInfo: PageInfo, links: Link[] } {
        const { pageInfo, links } = content;
        return { pageInfo, links };
    }

    
    
    private async rankLinks(links: Link[], pageInfo: PageInfo, requestId: number): Promise<void> {
        try {
            const rankedIds = await this.llmManager.getLLMRanking(links, requestId);

            if (rankedIds.length === 0) {
                // Fallback scoring based on position
                links.forEach((link, index) => {
                    link.score = 1 - (index / links.length);
                });
            } else {
                // Score ranked links
                links.forEach((link, index) => {
                    const id = rankedIds.indexOf(link.id);
                    link.score = id !== -1 ? 1 - (id / rankedIds.length) : 0.1 - (index / links.length);
                });
            }
        } catch (error) {
            console.warn(`[TabManager] Ranking process failed for #${requestId}:`, error);
        }
    }

    private async sendMessageToPopup(requestId: number, links: Link[], url: string, error?: string): Promise<void> {
        try {
            await this.popupManager.handleNewLinks(links, url, requestId, error);
        } catch (error) {
            console.log(`[TabManager] Could not send to popup (request #${requestId}):`, error);
        }
    }

   
}


export default TabManager;