// background.ts
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
import { ModelLoader } from './model/modelLoader.js';

interface IModelLoader {
    loadShardedWeights(): Promise<string>;
    loadLoraWeights(): Promise<string>;
}


class BackgroundService {
    private modelLoader: IModelLoader;
    constructor() {
        const element = document.createElement('div'); // create an HTMLElement
        this.modelLoader = new ModelLoader(element) as IModelLoader;
        this.initialize();
    }


    private async initialize() {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        this.setupListeners();
    }


    private setupListeners() {
        chrome.tabs.onUpdated.addListener((tabId, info) => info.status === 'loading')
    }

}

const backgroundService = new BackgroundService();
export { backgroundService };