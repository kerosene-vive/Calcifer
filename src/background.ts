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

class BackgroundService {
    private modelLoader: IModelLoader;
    private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
    private activeContentScripts = new Map<number, boolean>();
    private readonly INFERENCE_TIMEOUT = 50000;
    constructor() {
        this.modelLoader = new ModelLoader() as IModelLoader;
        this.initialize();
    }

    private async initialize() {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        this.setupListeners();
        await this.injectExistingTabScripts();
    }

    private setupListeners() {
        chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
        chrome.tabs.onCreated.addListener(tab => tab.id && this.injectContentScript(tab.id));
        chrome.tabs.onUpdated.addListener((tabId, info) => info.status === 'loading' && this.injectContentScript(tabId));
    }

    private handleMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: Function) {
        const tabId = sender.tab?.id;

        if (message.type === 'CONTENT_SCRIPT_LOADED' && tabId) {
            this.activeContentScripts.set(tabId, true);
            sendResponse({ status: 'acknowledged' });
            return;
        }

        if (message.type === 'START_INFERENCE' && tabId) {
            this.handleInference(tabId, message, sendResponse);
            return true;
        }
    }

    private async handleInference(tabId: number, message: any, sendResponse: Function) {
        try {
            const response = await Promise.race([
                chrome.tabs.sendMessage(tabId, {
                    type: 'PROCESS_INFERENCE',
                    prompt: message.prompt,
                    requestId: message.requestId
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Inference timeout')), this.INFERENCE_TIMEOUT))
            ]);
            sendResponse(response);
        } catch (error) {
            sendResponse({ type: 'INFERENCE_ERROR', error: String(error) });
        }
    }

    private async injectContentScript(tabId: number) {
        if (this.activeContentScripts.get(tabId)) return;
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            });
        } catch (error) {
            console.error('[Background] Injection failed:', error);
        }
    }

    private async injectExistingTabScripts() {
        const tabs = await chrome.tabs.query({});
        await Promise.all(tabs.map(tab => tab.id && this.injectContentScript(tab.id)));
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
        // Extension lifecycle listeners only
        chrome.runtime.onSuspend.addListener(this.handleSuspend.bind(this));
        chrome.runtime.onInstalled.addListener(this.handleInstall.bind(this));
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