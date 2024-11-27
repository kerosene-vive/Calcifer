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

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));


class BackgroundService {
  private modelLoader: IModelLoader;
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
  constructor() {
    this.modelLoader = new ModelLoader() as IModelLoader;
    this.initialize();
  }


  private async initialize(): Promise<void> {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      await this.setupServiceWorker();
      this.setupEventListeners();
    } catch (error) {
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
      // Import the JS ModelLoader
      importScripts('modelLoader.js');
      // Initialize ModelLoader
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
    sw.postMessage(
      { type: 'loadShardedWeights' },
      [channel.port2]
    );
    sw.postMessage(
      { type: 'loadLoraWeights' },
      [channel.port2]
    );
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
    if (details.reason === 'install') {
      this.initializeModelLoading().catch(console.error);
    } else if (details.reason === 'update') {
      this.initializeModelLoading().catch(console.error);
    }
  }


  private handleShardedWeightsLoaded(modelUrl?: string): void {
    if (!modelUrl) {
      console.error('No model URL received from sharded weights loading');
      return;
    }
  }


  private handleLoraWeightsLoaded(loraUrl?: string): void {
    if (!loraUrl) {
      console.error('No LoRA URL received from weights loading');
      return;
    }
  }
}


const backgroundService = new BackgroundService();
export { backgroundService };