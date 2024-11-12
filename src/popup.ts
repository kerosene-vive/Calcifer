import "./popup.css";
import { mlcEngineService, IProgressReport } from "./mlcEngineService";
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

    public async initialize(): Promise<void> {
        console.log("Initializing application...");
        this.isFirstLoad = true;
        
        const engine = await mlcEngineService.initializeEngine(this.handleProgressUpdate);
        
        this.chatManager = new ChatManager(engine);
        await this.chatManager.initializeWithContext();
        
        this.isLoadingParams = true;
        console.log("Initialization complete");
    }

    private handleProgressUpdate = (report: IProgressReport): void => {
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

    // Initializes event listeners for UI elements
    private initializeEventListeners(): void {
        const elements = this.uiManager.getElements();
        elements.queryInput.addEventListener("keyup", this.handleInputKeyup.bind(this));
        elements.submitButton.addEventListener("click", this.handleSubmit.bind(this));
        elements.copyAnswer.addEventListener("click", () => this.uiManager.copyAnswer());
        this.setupTabListeners();
    }

    // Sets up listeners for tab updates to trigger summarization
    private setupTabListeners(): void {
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.active) {
                this.summarizeCurrentPage(tabId);
            }
        });
    }

    // Summarizes the content of the current page
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

    // Handles the submission of user input
    private async handleSubmit(): Promise<void> {
        if (this.isFirstLoad) return;

        const message = this.uiManager.getMessage();
        this.uiManager.resetForNewMessage();

        await this.chatManager?.processUserMessage(
            message,
            this.uiManager.updateAnswer.bind(this.uiManager)
        );
    }

    // Handles keyup events in the input field
    private handleInputKeyup(event: KeyboardEvent): void {
        const input = event.target as HTMLInputElement;
        input.value ? this.uiManager.enableInputs() : this.uiManager.disableSubmit();
        
        if (event.code === "Enter") {
            event.preventDefault();
            this.handleSubmit();
        }
    }
}

// Initialize popup when window loads
window.onload = () => {
    const popup = new PopupManager();
    popup.initialize();
}