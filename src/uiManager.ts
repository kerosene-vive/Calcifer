export interface UIElements {
    queryInput: HTMLInputElement;
    submitButton: HTMLButtonElement;
    answerWrapper: HTMLElement;
    answer: HTMLElement;
    loadingIndicator: HTMLElement;
    copyAnswer: HTMLElement;
    timestamp: HTMLElement;
    loadingContainer: HTMLElement;
}

export class UIManager {
    private elements: UIElements;
    private lastProgress: number = 0;
    private readonly ANIMATION_DURATION: number = 500;

    constructor() {
        this.elements = {
            queryInput: document.getElementById("query-input") as HTMLInputElement,
            submitButton: document.getElementById("submit-button") as HTMLButtonElement,
            answerWrapper: document.getElementById("answerWrapper") as HTMLElement,
            answer: document.getElementById("answer") as HTMLElement,
            loadingIndicator: document.getElementById("loading-indicator") as HTMLElement,
            copyAnswer: document.getElementById("copyAnswer") as HTMLElement,
            timestamp: document.getElementById("timestamp") as HTMLElement,
            loadingContainer: document.getElementById("loadingContainer") as HTMLElement
        };

        // Validate all elements exist
        Object.entries(this.elements).forEach(([key, element]) => {
            if (!element) {
                throw new Error(`Required UI element not found: ${key}`);
            }
        });

        this.elements.submitButton.disabled = true;
        this.initializeStyles();
    }

    private initializeStyles(): void {
        // Add loading animation styles
        const style = document.createElement('style');
        style.textContent = `
            .loading-progress {
                transition: opacity ${this.ANIMATION_DURATION}ms ease;
            }
            .loading-progress.fade-out {
                opacity: 0;
            }
            .removing {
                pointer-events: none;
            }
            .progress-bar {
                background: #f0f0f0;
                border-radius: 4px;
                overflow: hidden;
                height: 8px;
                margin: 10px 0;
            }
            #progress-fill {
                background: #4CAF50;
                height: 100%;
                width: 0;
                transition: width 0.3s ease;
            }
            .alert {
                background: #e3f2fd;
                padding: 15px;
                border-radius: 4px;
                margin-bottom: 15px;
            }
            .init-message {
                margin-bottom: 15px;
            }
            .progress-stats {
                display: flex;
                justify-content: space-between;
                margin-bottom: 5px;
            }
            .progress-note {
                font-size: 0.9em;
                color: #666;
                margin-top: 10px;
            }
        `;
        document.head.appendChild(style);
    }

    public handleLoadingError(message: string): void {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.innerHTML = `
            <div class="alert alert-error">
                <h3>Error</h3>
                <p>${message}</p>
                <button onclick="location.reload()" class="retry-button">Retry</button>
            </div>
        `;
        
        this.elements.loadingContainer.innerHTML = '';
        this.elements.loadingContainer.appendChild(errorDiv);
    }

    public createLoadingUI(isFirstTime: boolean): void {
        // Your existing createLoadingUI implementation is correct
    }

    public updateProgressBar(progress: number, isFirstTime: boolean): void {
        // Your existing updateProgressBar implementation is correct
    }

    private animateProgress(start: number, end: number, isFirstTime: boolean): void {
        // Your existing animateProgress implementation is correct
    }

    private updateProgressText(progress: number, isFirstTime: boolean): void {
        // Your existing updateProgressText implementation is correct
    }

    public handleLoadingComplete(callback: () => void): void {
        const loadingProgress = document.querySelector('.loading-progress');
        if (loadingProgress) {
            loadingProgress.classList.add('fade-out');
            
            setTimeout(() => {
                this.elements.loadingContainer.classList.add('removing');
                setTimeout(() => {
                    if (this.elements.loadingContainer.parentElement) {
                        this.elements.loadingContainer.parentElement.removeChild(this.elements.loadingContainer);
                    }
                    callback();
                }, this.ANIMATION_DURATION);
            }, this.ANIMATION_DURATION);
        } else {
            callback(); // Call callback even if loading UI is not present
        }
    }

    public updateAnswer(answer: string): void {
        // Add fade-in animation
        this.elements.answerWrapper.style.opacity = '0';
        this.elements.answerWrapper.style.display = "block";
        this.elements.answer.innerHTML = answer.replace(/\n/g, "<br>");
        this.elements.loadingIndicator.style.display = "none";
        
        // Trigger reflow
        void this.elements.answerWrapper.offsetHeight;
        
        // Fade in
        this.elements.answerWrapper.style.opacity = '1';
        this.elements.answerWrapper.style.transition = 'opacity 0.3s ease';
        
        this.updateTimestamp();
    }

    public enableInputs(): void {
        this.elements.submitButton.disabled = false;
        this.elements.queryInput.disabled = false;
        this.elements.queryInput.focus();
    }

    public disableInputs(): void {
        this.elements.submitButton.disabled = true;
        this.elements.queryInput.disabled = true;
    }

    public updateTimestamp(): void {
        const options: Intl.DateTimeFormatOptions = {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        };
        this.elements.timestamp.innerText = new Date().toLocaleString("en-US", options);
    }

    public async copyAnswer(): Promise<void> {
        try {
            await navigator.clipboard.writeText(this.elements.answer.textContent || "");
            console.log("Answer text copied to clipboard");
        } catch (err) {
            console.error("Could not copy text: ", err);
        }
    }

    public resetForNewMessage(): void {
        this.elements.answer.innerHTML = "";
        this.elements.answerWrapper.style.display = "none";
        this.elements.loadingIndicator.style.display = "block";
    }

    public disableSubmit(): void {
        this.elements.submitButton.disabled = true;
    }

    public getMessage(): string {
        return this.elements.queryInput.value;
    }

    public getElements(): UIElements {
        return this.elements;
    }
}