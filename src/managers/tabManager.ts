// src/managers/tabManager.ts

interface Link {
    text: string;
    href: string;
    score: number;
}

export class TabManager {
    private static instance: TabManager;
    private currentTabId: number | null = null;
    private analyzing: boolean = false;
    private pendingAnalysis: boolean = false;
    private lastAnalyzedUrl: string = '';

    private constructor() {
        this.setupListeners();
    }

    public static getInstance(): TabManager {
        if (!TabManager.instance) {
            TabManager.instance = new TabManager();
        }
        return TabManager.instance;
    }

    private setupListeners(): void {
        chrome.tabs.onActivated.addListener((activeInfo) => {
            this.handleTabChange(activeInfo.tabId);
        });

        chrome.webNavigation.onCompleted.addListener((details) => {
            if (details.frameId === 0) {
                this.handleURLChange(details.tabId, details.url);
            }
        });

        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url) {
                this.handleURLChange(tabId, tab.url);
            }
        });
    }

    private async handleTabChange(tabId: number): Promise<void> {
        this.currentTabId = tabId;
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && tab.url !== this.lastAnalyzedUrl) {
            await this.analyzeCurrentPage(tab.url);
        }
    }

    private async handleURLChange(tabId: number, url: string): Promise<void> {
        if (tabId === this.currentTabId && url !== this.lastAnalyzedUrl) {
            await this.analyzeCurrentPage(url);
        }
    }

    
private async analyzeCurrentPage(url: string): Promise<void> {
    if (this.analyzing) {
        this.pendingAnalysis = true;
        return;
    }

    try {
        this.analyzing = true;
        console.log("[TabManager] Analyzing page:", url);

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];

        if (!tab.id) {
            throw new Error('No active tab found');
        }

        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                return Array.from(document.getElementsByTagName('a'))
                    .filter(link => {
                        try {
                            return link.href && 
                                   link.href.startsWith('http') && 
                                   !link.href.includes('#') &&
                                   link.offsetParent !== null;
                        } catch {
                            return false;
                        }
                    })
                    .map(link => ({
                        text: (link.textContent || link.href).trim(),
                        href: link.href,
                        score: 1
                    }))
                    .filter(link => link.text.length > 0)
                    .slice(0, 10);
            }
        });

        if (!result || !result[0]) {
            throw new Error('Failed to analyze links');
        }

        const links = result[0].result as Link[];
        this.lastAnalyzedUrl = url;

        // Broadcast to all open popups
        chrome.runtime.sendMessage({
            type: 'NEW_LINKS',  // Changed from 'action' to 'type'
            data: {
                links: links,
                url: url
            }
        }).catch(error => {
            // It's okay if no popups are open to receive the message
            console.log("[TabManager] No popup available:", error);
        });

        console.log("[TabManager] Broadcasted links:", links);

    } catch (error) {
        console.error("[TabManager] Error analyzing page:", error);
    } finally {
        this.analyzing = false;
        
        if (this.pendingAnalysis) {
            this.pendingAnalysis = false;
            const currentTab = await chrome.tabs.query({ active: true, currentWindow: true });
            if (currentTab[0]?.url) {
                await this.analyzeCurrentPage(currentTab[0].url);
            }
        }
    }
}

    public async getCurrentPageLinks(): Promise<Link[]> {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tab = tabs[0];

            if (!tab?.id) {
                throw new Error('No active tab found');
            }

            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    return Array.from(document.getElementsByTagName('a'))
                        .filter(link => {
                            try {
                                return link.href && 
                                       link.href.startsWith('http') && 
                                       !link.href.includes('#') &&
                                       link.offsetParent !== null;
                            } catch {
                                return false;
                            }
                        })
                        .map(link => ({
                            text: (link.textContent || link.href).trim(),
                            href: link.href,
                            score: 1
                        }))
                        .filter(link => link.text.length > 0)
                        .slice(0, 10);
                }
            });

            if (!result?.[0]?.result) {
                throw new Error('Failed to analyze links');
            }

            return result[0].result as Link[];
        } catch (error) {
            console.error("Error getting current page links:", error);
            throw error;
        }
    }
}