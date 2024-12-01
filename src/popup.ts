import "./popup.css";
import { UIManager } from './managers/uiManager.js';
import { LLMManager } from './managers/llmManager.js';

interface Link {
    text: string;
    href: string;
    score: number;
}

class LinkAnalyzerManager {
    public async analyzeCurrentPage(): Promise<Link[]> {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                try {
                    const tab = tabs[0];
                    if (!tab.id) {
                        throw new Error('No active tab found');
                    }

                    console.log("DEBUG: Starting link analysis for tab:", tab.url);

                    const result = await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: () => {
                            const links = Array.from(document.getElementsByTagName('a'))
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
                            
                            console.log("Page context: Found links:", links.length);
                            return links;
                        }
                    });

                    console.log("DEBUG: Script execution result:", result);

                    if (!result || !result[0]) {
                        throw new Error('Failed to analyze links');
                    }

                    const links = result[0].result as Link[];
                    console.log("DEBUG: Processed links:", links);
                    resolve(links);

                } catch (error) {
                    console.error("DEBUG: Error during link analysis:", error);
                    reject(new Error('Could not analyze links. Please make sure you are on a valid webpage.'));
                }
            });
        });
    }
}

export class PopupManager {
    private uiManager: UIManager;
    private llmManager: LLMManager;
    private debug: HTMLElement;
    private linkAnalyzer: LinkAnalyzerManager;
    private port: chrome.runtime.Port;

    constructor() {
        this.debug = document.getElementById('debug') || document.createElement('div');
        this.uiManager = new UIManager();
        this.llmManager = new LLMManager(this.debug, this.handleStatusUpdate.bind(this));
        this.linkAnalyzer = new LinkAnalyzerManager();
        this.port = chrome.runtime.connect({ name: 'popup' });
        this.setupListeners();
    }

    private setupListeners(): void {
        this.initializeEventListeners();
        this.port.onMessage.addListener((message) => {
            if (message.error) {
                console.error('Background script error:', message.error);
                this.handleStatusUpdate(message.error, false);
            }
        });
    }

    public async initialize(): Promise<void> {
        try {
            this.handleStatusUpdate("Starting initialization");
            
            await this.llmManager.initialize();
            
            try {
                this.handleStatusUpdate("Analyzing page links");
                const links = await this.linkAnalyzer.analyzeCurrentPage();
                console.log("DEBUG: About to display links:", links);
                
                // First, display the message in chat using static method
                const welcomeMessage = "I've analyzed the page and found some relevant links:";
                UIManager.addMessageToUI(welcomeMessage, 'assistant', this.uiManager.getElements());
                
                // Then display the links in the dedicated container
                this.uiManager.displayLinks(links);
                
                // Make sure the link container is visible and styled properly
                const linkContainer = document.getElementById('link-container');
                if (linkContainer) {
                    linkContainer.style.display = 'block';
                    linkContainer.style.marginTop = '20px';
                }
                
            } catch (error) {
                console.error("DEBUG: Error in initialize:", error);
                const errorMessage = error instanceof Error ? error.message : 'Failed to analyze links';
                UIManager.addMessageToUI(`Error: ${errorMessage}`, 'assistant', this.uiManager.getElements());
            }
            
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

const initPopup = async () => {
    let manager: PopupManager | null = null;
    try {
        manager = new PopupManager();
        await manager.initialize();
    } catch (error) {
        console.error('Failed to initialize PopupManager:', error);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    initPopup().catch(console.error);
});