// background.ts
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
import { ModelLoader } from './model/modelLoader.js';

interface IModelLoader {
    loadShardedWeights(): Promise<string>;
    loadLoraWeights(): Promise<string>;
}

interface ModelMessage {
    type: 'loadShardedWeights' | 'loadLoraWeights' | 'shardedWeightsLoaded' | 'loraWeightsLoaded';
    modelUrl?: string;
    loraUrl?: string;
}

interface Link {
    text: string;
    href: string;
    score: number;
}

class BackgroundService {
    private modelLoader: IModelLoader;
    private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
    private currentTabId: number | null = null;
    private lastAnalyzedUrl: string = '';
    private isAnalyzing: boolean = false;

    constructor() {
        this.modelLoader = new ModelLoader() as IModelLoader;
        this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
            await this.setupServiceWorker();
            this.setupEventListeners();

            // Initial tab analysis
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0]?.id) {
                this.currentTabId = tabs[0].id;
                await this.analyzeLinks(this.currentTabId);
            }
        } catch (error) {
            console.error("Error initializing background service:", error);
        }
    }

    private async setupServiceWorker(): Promise<void> {
        if ('serviceWorker' in navigator) {
            try {
                this.serviceWorkerRegistration = await navigator.serviceWorker.register(
                    this.getServiceWorkerURL(),
                    { type: 'module' }
                );
                if (this.serviceWorkerRegistration.active) {
                    await this.initializeModelLoading();
                }
                this.serviceWorkerRegistration.addEventListener('activate', () => {
                    this.initializeModelLoading();
                });
            } catch (error) {
                console.error('Service worker registration failed:', error);
            }
        }
    }

    private getServiceWorkerURL(): string {
        const serviceWorkerCode = `
            importScripts('modelLoader.js');
            const modelLoader = new ModelLoader();
            self.addEventListener('message', (event) => {
                const { type } = event.data;
                switch (type) {
                    case 'loadShardedWeights':
                        modelLoader.loadShardedWeights()
                            .then((modelUrl) => {
                                event.ports[0].postMessage({ type: 'shardedWeightsLoaded', modelUrl });
                            })
                            .catch((error) => {
                                console.error('Error loading sharded weights:', error);
                                event.ports[0].postMessage({ 
                                    type: 'shardedWeightsLoaded', 
                                    error: error.message 
                                });
                            });
                        break;
                    case 'loadLoraWeights':
                        modelLoader.loadLoraWeights()
                            .then((loraUrl) => {
                                event.ports[0].postMessage({ type: 'loraWeightsLoaded', loraUrl });
                            })
                            .catch((error) => {
                                console.error('Error loading LoRA weights:', error);
                                event.ports[0].postMessage({ 
                                    type: 'loraWeightsLoaded', 
                                    error: error.message 
                                });
                            });
                        break;
                }
            });
        `;
        const blob = new Blob([serviceWorkerCode], { type: 'application/javascript' });
        return URL.createObjectURL(blob);
    }

    private setupEventListeners(): void {
        // Tab and navigation listeners
        chrome.tabs.onActivated.addListener(async (activeInfo) => {
            this.currentTabId = activeInfo.tabId;
            await this.analyzeLinks(this.currentTabId);
        });

        chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            if (tabId === this.currentTabId && changeInfo.status === 'complete' && tab.url) {
                await this.analyzeLinks(tabId);
            }
        });

        chrome.webNavigation.onCompleted.addListener(async (details) => {
            if (details.frameId === 0 && details.tabId === this.currentTabId) {
                await this.analyzeLinks(details.tabId);
            }
        });

        // Extension lifecycle listeners
        chrome.runtime.onSuspend.addListener(this.handleSuspend.bind(this));
        chrome.runtime.onInstalled.addListener(this.handleInstall.bind(this));
    }

    private async analyzeLinks(tabId: number): Promise<void> {
        if (this.isAnalyzing) return;
        
        try {
            this.isAnalyzing = true;
            console.log("Analyzing links for tab:", tabId);

            const tab = await chrome.tabs.get(tabId);
            if (!tab.url || tab.url === this.lastAnalyzedUrl) {
                return;
            }

            // Wait for page to load
            await new Promise(resolve => setTimeout(resolve, 500));

            const results = await chrome.scripting.executeScript({
                target: { tabId },
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

            if (results && results[0]) {
                const links = results[0].result as Link[];
                this.lastAnalyzedUrl = tab.url;
                
                // Broadcast results to any open popups
                chrome.runtime.sendMessage({
                    type: 'NEW_LINKS',
                    data: {
                        links,
                        url: tab.url
                    }
                }).catch(() => {
                    // Popup might not be open, that's fine
                    console.log("No popup listening");
                });
            }
        } catch (error) {
            console.error("Error analyzing links:", error);
        } finally {
            this.isAnalyzing = false;
        }
    }

    private async initializeModelLoading(): Promise<void> {
        if (!this.serviceWorkerRegistration?.active) return;
        const channel = new MessageChannel();
        channel.port1.onmessage = (event: MessageEvent<ModelMessage & { error?: string }>) => {
            if (event.data.error) {
                console.error(`Error in service worker: ${event.data.error}`);
                return;
            }
            switch (event.data.type) {
                case 'shardedWeightsLoaded':
                    this.handleShardedWeightsLoaded(event.data.modelUrl);
                    break;
                case 'loraWeightsLoaded':
                    this.handleLoraWeightsLoaded(event.data.loraUrl);
                    break;
            }
        };
        
        const sw = this.serviceWorkerRegistration.active;
        sw.postMessage({ type: 'loadShardedWeights' }, [channel.port2]);
        sw.postMessage({ type: 'loadLoraWeights' }, [channel.port2]);
    }

    private async handleSuspend(): Promise<void> {
        try {
            const databases = await indexedDB.databases();
            for (const db of databases) {
                if (db.name === 'ModelCache') {
                    indexedDB.deleteDatabase('ModelCache');
                }
            }
        } catch (error) {
            console.error('Error cleaning up IndexedDB:', error);
        }
    }

    private handleInstall(details: chrome.runtime.InstalledDetails): void {
        if (details.reason === 'install' || details.reason === 'update') {
            this.initializeModelLoading().catch(console.error);
        }
    }

    private handleShardedWeightsLoaded(modelUrl?: string): void {
        if (!modelUrl) {
            console.error('No model URL received from sharded weights loading');
            return;
        }
        console.log('Sharded weights loaded:', modelUrl);
    }

    private handleLoraWeightsLoaded(loraUrl?: string): void {
        if (!loraUrl) {
            console.error('No LoRA URL received from weights loading');
            return;
        }
        console.log('LoRA weights loaded:', loraUrl);
    }
}

// Initialize the background service
const backgroundService = new BackgroundService();
export { backgroundService };