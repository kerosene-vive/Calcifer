import "./popup.css";
import { ChatManager } from './managers/chatManager.ts';
import { UIManager } from './managers/uiManager.ts';
import { LLMManager } from './managers/llmManager.ts';

export class PopupManager {
    private chatManager: ChatManager | null = null;
    private uiManager: UIManager;
    private llmManager: LLMManager;
    private isFirstLoad: boolean = true;
    private debug: HTMLElement;
    private status: HTMLElement;

    constructor() {
        this.uiManager = new UIManager();
        this.debug = document.getElementById('debug') || document.createElement('div');
        this.status = document.getElementById('status') || document.createElement('div');
        this.llmManager = new LLMManager(this.debug);
        this.initializeEventListeners();
        this.addStyles();
    }

    public async initialize(): Promise<void> {
        try {
            this.updateStatus("Starting initialization");
            this.isFirstLoad = true;
            
            const script = document.createElement('script');
            script.type = 'text/javascript';
            script.textContent = `
                if (typeof WebAssembly === 'object') {
                    WebAssembly.compileStreaming = WebAssembly.compileStreaming || 
                        async function(response) {
                            const buffer = await response.arrayBuffer();
                            return WebAssembly.compile(buffer);
                        };
                }
            `;
            document.head.appendChild(script);

            await this.llmManager.loadGenAIBundle();
            await this.llmManager.safeInitialize();

            const llmInference = this.llmManager.getLLMInference();
            const loraModel = this.llmManager.getLoraModel();

            if (!llmInference) {
                throw new Error("LLM initialization failed");
            }

            this.chatManager = new ChatManager(llmInference, loraModel);
            await this.chatManager.initializeWithContext();
            this.isFirstLoad = false;
            this.updateStatus("Ready", false);
        } catch (error) {
            console.error("Error initializing PopupManager:", error);
            this.updateStatus("Initialization failed", false);
            throw error;
        }
    }

    private addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .loading {
                color: #666;
                animation: pulse 1.5s infinite;
            }
            @keyframes pulse {
                0% { opacity: 0.6; }
                50% { opacity: 1; }
                100% { opacity: 0.6; }
            }
        `;
        document.head.appendChild(style);
    }

    private updateStatus(message: string, isLoading = true) {
        this.status.textContent = `Status: ${message}`;
        this.status.classList.toggle('loading', isLoading);
    }

    private async handleSubmit(): Promise<void> {
        if (!this.chatManager || this.isFirstLoad) return;

        const message = this.uiManager.getMessage();
        if (!message.trim()) return;

        this.uiManager.resetForNewMessage();
        this.updateStatus("Generating response...", true);

        try {
            await this.chatManager.processUserMessage(
                message,
                this.uiManager.updateAnswer.bind(this.uiManager)
            );
            this.updateStatus("Ready", false);
        } catch (error) {
            console.error("Error processing message:", error);
            this.updateStatus("Error generating response", false);
            this.uiManager.updateAnswer("An error occurred while generating the response.");
        }
    }

    private handleInputKeyup(event: KeyboardEvent): void {
        const input = event.target as HTMLInputElement;
        input.value ? this.uiManager.enableInputs() : this.uiManager.disableSubmit();
        
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            this.handleSubmit();
        }
    }

    private initializeEventListeners(): void {
        const elements = this.uiManager.getElements();
        elements.queryInput.addEventListener("keyup", this.handleInputKeyup.bind(this));
        elements.submitButton.addEventListener("click", this.handleSubmit.bind(this));
        elements.copyAnswer.addEventListener("click", () => this.uiManager.copyAnswer());
    }
}

window.onload = () => {
    const popup = new PopupManager();
    popup.initialize().catch(console.error);
};