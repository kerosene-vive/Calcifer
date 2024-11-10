import "./popup.css";
import {
    CreateExtensionServiceWorkerMLCEngine,
    InitProgressReport,
} from "@mlc-ai/web-llm";
import { ChatManager } from './chatManager';
import { UIManager } from './uiManager';

class PopupManager {
    private chatManager: ChatManager | null = null;
    private uiManager: UIManager;
    private isLoadingParams: boolean = false;
    private isFirstLoad: boolean = true;

    constructor() {
        this.uiManager = new UIManager();
        this.initializeEventListeners();
    }

    private initializeEventListeners(): void {
        const elements = this.uiManager.getElements();
        elements.queryInput.addEventListener("keyup", this.handleInputKeyup.bind(this));
        elements.submitButton.addEventListener("click", this.handleSubmit.bind(this));
        elements.copyAnswer.addEventListener("click", () => this.uiManager.copyAnswer());
        this.setupTabListeners();
    }

    private setupTabListeners(): void {
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.active) {
                this.summarizeCurrentPage(tabId);
            }
        });
    }

    private async summarizeCurrentPage(tabId: number): Promise<void> {
        if (!this.isFirstLoad) return;

        try {
            const [result] = await chrome.scripting.executeScript({
                target: { tabId },
                files: ['/mnt/data/contentExtractor.ts']
            });

            if (result?.result) {
                const summarizationPrompt = `Summarize this page content: ${result.result}`;
                await this.chatManager?.processUserMessage(
                    summarizationPrompt,
                    this.uiManager.updateAnswer.bind(this.uiManager)
                );
                this.isFirstLoad = false;
            }
        } catch (error) {
            console.error("Failed to extract or summarize content:", error);
        }
    }

    private handleProgressUpdate = (report: InitProgressReport): void => {
        chrome.storage.local.get(['modelDownloaded'], (result) => {
            const isFirstTime = !result.modelDownloaded;
            if (!result.modelDownloaded) {
                chrome.storage.local.set({ modelDownloaded: true });
            }

            if (!this.uiManager.getElements().loadingContainer.hasChildNodes()) {
                this.uiManager.createLoadingUI(isFirstTime);
            }

            this.uiManager.updateProgressBar(report.progress, isFirstTime);

            if (report.progress >= 1.0) {
                this.uiManager.handleLoadingComplete(() => {
                    if (this.isLoadingParams) {
                        this.uiManager.enableInputs();
                        this.isLoadingParams = false;
                    }
                });
            }
        });
    };

    private async handleSubmit(): Promise<void> {
        if (this.isFirstLoad) return;

        const message = this.uiManager.getMessage();
        this.uiManager.resetForNewMessage();

        await this.chatManager?.processUserMessage(
            message,
            this.uiManager.updateAnswer.bind(this.uiManager)
        );
    }

    private handleInputKeyup(event: KeyboardEvent): void {
        const input = event.target as HTMLInputElement;
        input.value ? this.uiManager.enableInputs() : this.uiManager.disableSubmit();
        
        if (event.code === "Enter") {
            event.preventDefault();
            this.handleSubmit();
        }
    }

    public async initialize(): Promise<void> {
        console.log("Initializing application...");
        this.isFirstLoad = true;
        
        const engine = await CreateExtensionServiceWorkerMLCEngine(
            "Qwen2-0.5B-Instruct-q4f16_1-MLC",
            { initProgressCallback: this.handleProgressUpdate }
        );
        
        this.chatManager = new ChatManager(engine);
        await this.chatManager.initializeWithContext();
        
        this.isLoadingParams = true;
        console.log("Initialization complete");
    }
}

// Initialize popup when window loads
window.onload = () => {
    const popup = new PopupManager();
    popup.initialize();
}