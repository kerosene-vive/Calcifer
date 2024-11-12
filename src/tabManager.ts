import { ContentExtractor } from './content';

export interface TabState {
    tabId: number;
    url: string;
}

export interface PageContent {
    title: string;
    content: string;
}

export type TabChangeCallback = (tabState: TabState, pageContent: PageContent) => Promise<void>;

export class TabManager {
    private currentTabId?: number;
    private currentUrl?: string;
    private onTabChangeCallbacks: TabChangeCallback[] = [];
    private debugMode: boolean;

    constructor(debugMode = false) {
        this.debugMode = debugMode;
        this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            await this.setInitialTab();
            this.setupTabListeners();
            
            if (this.debugMode) {
                console.log("TabManager initialized");
            }
        } catch (error) {
            console.error("Error initializing TabManager:", error);
            throw error;
        }
    }

    private async setInitialTab(): Promise<void> {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && tab.url) {
            this.currentTabId = tab.id;
            this.currentUrl = tab.url;
            await this.handleTabChange();
        }
    }

    private setupTabListeners(): void {
        chrome.tabs.onActivated.addListener(this.handleTabActivated.bind(this));
        chrome.tabs.onUpdated.addListener(this.handleTabUpdated.bind(this));
    }

    private async handleTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab.url !== this.currentUrl) {
            this.currentTabId = activeInfo.tabId;
            this.currentUrl = tab.url;
            await this.handleTabChange();
        }
    }

    private async handleTabUpdated(
        tabId: number, 
        changeInfo: chrome.tabs.TabChangeInfo, 
        tab: chrome.tabs.Tab
    ): Promise<void> {
        if (changeInfo.status === 'complete' && tab.active && tab.url !== this.currentUrl) {
            this.currentTabId = tabId;
            this.currentUrl = tab.url;
            await this.handleTabChange();
        }
    }

    private async handleTabChange(): Promise<void> {
        if (!this.currentTabId || !this.currentUrl) return;

        try {
            const pageContent = await ContentExtractor.getPageContent();
            if (!pageContent) {
                throw new Error("No content extracted from page");
            }

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            const tabState: TabState = {
                tabId: this.currentTabId,
                url: this.currentUrl
            };

            const content: PageContent = {
                title: tab.title || "Untitled Page",
                content: pageContent
            };

            await Promise.all(
                this.onTabChangeCallbacks.map(callback => callback(tabState, content))
            );
        } catch (error) {
            console.error("Error handling tab change:", error);
            throw error;
        }
    }

    public onTabChange(callback: TabChangeCallback): void {
        this.onTabChangeCallbacks.push(callback);
    }

    public removeTabChangeListener(callback: TabChangeCallback): void {
        this.onTabChangeCallbacks = this.onTabChangeCallbacks.filter(cb => cb !== callback);
    }

    public getCurrentTabState(): TabState | undefined {
        if (!this.currentTabId || !this.currentUrl) return undefined;
        return { tabId: this.currentTabId, url: this.currentUrl };
    }

    public async refreshCurrentTab(): Promise<void> {
        await this.handleTabChange();
    }
}
