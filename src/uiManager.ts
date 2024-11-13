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

        this.elements.submitButton.disabled = true;
    }

    public createLoadingUI(isFirstTime: boolean): void {
        this.elements.loadingContainer.innerHTML = `
            <div class="loading-progress">
                ${isFirstTime ? `
                    <div class="alert">
                        <h3>First-time Setup</h3>
                        <p>Downloading model files. This may take a few minutes.</p>
                    </div>
                ` : `
                    <div class="init-message">
                        <span>⚙️ Initializing model...</span>
                    </div>
                `}
                
                <div class="progress-stats">
                    <div class="progress-text">
                        <span id="progress-percentage">0%</span>
                        <span id="progress-status">${isFirstTime ? 'Downloading...' : 'Loading...'}</span>
                    </div>
                </div>
                
                <div class="progress-bar">
                    <div id="progress-fill"></div>
                </div>
                
                ${isFirstTime ? `
                    <p class="progress-note">This is a one-time download. Future startups will be much faster.</p>
                ` : ''}
            </div>
        `;
    }

    public updateProgressBar(progress: number, isFirstTime: boolean): void {
        const progressPercent = Math.round(progress * 100);
        const progressFill = document.getElementById('progress-fill');
        if (!progressFill) return;

        this.animateProgress(this.lastProgress, progressPercent, isFirstTime);
        this.lastProgress = progressPercent;
    }

    private animateProgress(start: number, end: number, isFirstTime: boolean): void {
        const progressFill = document.getElementById('progress-fill');
        if (!progressFill) return;

        const duration = 300;
        const startTime = performance.now();

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            const currentProgress = start + (end - start) * easeProgress;

            progressFill.style.width = `${currentProgress}%`;
            this.updateProgressText(currentProgress, isFirstTime);

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    }

    private updateProgressText(progress: number, isFirstTime: boolean): void {
        const percentageText = document.getElementById('progress-percentage');
        const statusText = document.getElementById('progress-status');

        if (percentageText) {
            percentageText.textContent = `${Math.round(progress)}%`;
        }

        if (statusText) {
            statusText.textContent = progress === 100 ? 'Complete!' :
                isFirstTime ? 'Downloading...' : 'Loading...';
        }
    }

    public handleLoadingComplete(callback: () => void): void {
        const loadingProgress = document.querySelector('.loading-progress');
        if (loadingProgress) {
            loadingProgress.classList.add('fade-out');
            
            setTimeout(() => {
                this.elements.loadingContainer.classList.add('removing');
                setTimeout(() => {
                    this.elements.loadingContainer.remove();
                    callback();
                }, this.ANIMATION_DURATION);
            }, this.ANIMATION_DURATION);
        }
    }

    public updateAnswer(answer: string): void {
        this.elements.answerWrapper.style.display = "block";
        this.elements.answer.innerHTML = answer.replace(/\n/g, "<br>");
        this.elements.loadingIndicator.style.display = "none";
        this.updateTimestamp();
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

    public enableInputs(): void {
        this.elements.submitButton.disabled = false;
        this.elements.queryInput.focus();
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