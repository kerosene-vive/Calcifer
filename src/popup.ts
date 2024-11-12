import "./popup.css";
import { mlcEngineService, ProgressReport } from "./mlcEngineService";
import { ChatManager } from './chatManager';
import { UIManager } from './uiManager';

export class PopupManager {
    private chatManager: ChatManager | null = null;
    private uiManager: UIManager;
    private isLoadingParams: boolean = false;
    private isFirstLoad: boolean = true;

    constructor() {
        this.uiManager = new UIManager();
        this.initializeEventListeners();
    }

    public async initialize(): Promise<void> {
        try {
            console.log("Initializing application...");
            this.isFirstLoad = true;
            
            await mlcEngineService.initializeEngine(this.handleProgressUpdate);
            
            this.chatManager = new ChatManager();
            await this.chatManager.initializeWithContext();
            
            this.isLoadingParams = true;
            console.log("Initialization complete");
        } catch (error) {
            console.error("Error initializing PopupManager:", error);
            throw error;
        }
    }

    private handleProgressUpdate = (report: ProgressReport): void => {
        chrome.storage.local.get(['modelDownloaded'], (result) => {
            const isFirstTime = !result.modelDownloaded;
            if (isFirstTime) {
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

    private initializeEventListeners(): void {
        const elements = this.uiManager.getElements();
        elements.queryInput.addEventListener("keyup", this.handleInputKeyup.bind(this));
        elements.submitButton.addEventListener("click", this.handleSubmit.bind(this));
        elements.copyAnswer.addEventListener("click", () => this.uiManager.copyAnswer());
    }

    private async handleSubmit(): Promise<void> {
        if (!this.chatManager || this.isFirstLoad) return;

        const message = this.uiManager.getMessage();
        if (!message.trim()) return;

        this.uiManager.resetForNewMessage();

        await this.chatManager.processUserMessage(
            message,
            this.uiManager.updateAnswer.bind(this.uiManager)
        );
    }

    private handleInputKeyup(event: KeyboardEvent): void {
        const input = event.target as HTMLInputElement;
        input.value ? this.uiManager.enableInputs() : this.uiManager.disableSubmit();
        
        if (event.key === "Enter") {
            event.preventDefault();
            this.handleSubmit();
        }
    }
}

// Initialize popup when window loads
window.onload = () => {
    const popup = new PopupManager();
    popup.initialize().catch(console.error);
};