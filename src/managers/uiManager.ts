export interface UIElements {
    queryInput: HTMLInputElement;
    answerWrapper: HTMLElement;
    answer: HTMLElement;
    loadingIndicator: HTMLElement;
    loadingContainer: HTMLElement;
    linkContainer: HTMLElement; // New element
}

export class UIManager {
    private elements: UIElements;
    private readonly ANIMATION_DURATION = 500;


    constructor() {
        this.elements = this.initializeElements();
        this.initializeStyles();
    }


    private initializeElements(): UIElements {
        const elements = {
            queryInput: document.getElementById("query-input") as HTMLInputElement,
            answerWrapper: document.getElementById("answerWrapper") as HTMLElement,
            answer: document.getElementById("answer") as HTMLElement,
            loadingIndicator: document.getElementById("loading-indicator") as HTMLElement,
            loadingContainer: document.getElementById("loadingContainer") as HTMLElement,
            linkContainer: document.getElementById("link-container") as HTMLElement
        };
        if (!elements.linkContainer) {
            elements.linkContainer = document.createElement('div');
            elements.linkContainer.id = 'link-container';
            document.body.appendChild(elements.linkContainer);
        }

        Object.entries(elements).forEach(([key, element]) => {
            if (!element) throw new Error(`Required UI element not found: ${key}`);
        });
        return elements;
    }


    private initializeStyles(): void {
        const style = document.createElement('style');
        style.textContent = `
       
            #link-container {
                margin-top: 20px;
                max-height: 300px;
                overflow-y: auto;
                padding: 10px;
            }
            
            .link-item {
                background: #ffffff;
                border: 1px solid #e0e0e0;
                border-radius: 4px;
                margin-bottom: 8px;
                padding: 10px;
                transition: all 0.2s ease;
            }
            
            .link-item:hover {
                background: #f5f8ff;
                border-color: #4a90e2;
            }
            
            .link-title {
                color: #2c3e50;
                font-size: 14px;
                font-weight: 500;
                margin-bottom: 4px;
                word-break: break-word;
            }
            
            .link-url {
                color: #7f8c8d;
                font-size: 12px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .link-score {
                background: #e8f5e9;
                border-radius: 12px;
                color: #388e3c;
                font-size: 12px;
                padding: 2px 8px;
                position: absolute;
                right: 10px;
                top: 10px;
            }
            .loading-progress {
                transition: opacity ${this.ANIMATION_DURATION}ms ease;
            }
            .loading-progress.fade-out { opacity: 0; }
            .removing { pointer-events: none; }
            .progress-bar {
                background: #f0f0f0;
                border-radius: 4px;
                height: 8px;
                margin: 10px 0;
                overflow: hidden;
            }
            #progress-fill {
                background: #4CAF50;
                height: 100%;
                width: 0;
                transition: width 0.3s ease;
            }
            .alert {
                background: #e3f2fd;
                border-radius: 4px;
                margin-bottom: 15px;
                padding: 15px;
            }
            .init-message { margin-bottom: 15px; }
            .progress-stats {
                display: flex;
                justify-content: space-between;
                margin-bottom: 5px;
            }
            .progress-note {
                color: #666;
                font-size: 0.9em;
                margin-top: 10px;
            }
            .message-wrapper {
                margin: 10px 0;
            }
            .message {
                border-radius: 8px;
                padding: 12px;
            }
            .user-message {
                background-color: #f0f2f5;
                margin-left: 20%;
            }
            .assistant-message {
                background-color: #e3f2fd;
                margin-right: 20%;
            }
            .message-header {
                align-items: center;
                display: flex;
                margin-bottom: 8px;
            }
            .message-icon {
                height: 24px;
                margin-right: 8px;
                width: 24px;
            }
            .timestamp {
                color: #666;
                font-size: 0.8em;
            }
            .message-content {
                line-height: 1.5;
                white-space: pre-wrap;
            }
        `;
        document.head.appendChild(style);
    }

    public handleLoadingStatus(message: string, isLoading = true): void {
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = `Status: ${message}`;
            statusElement.classList.toggle('loading', isLoading);
        }
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
        } else {
            callback();
        }
    }


    public updateAnswer(answer: string): void {
        this.elements.answerWrapper.style.opacity = '0';
        this.elements.answerWrapper.style.display = "block";
        this.elements.answer.innerHTML = answer.replace(/\n/g, "<br>");
        this.elements.loadingIndicator.style.display = "none";
        void this.elements.answerWrapper.offsetHeight;
    }


    public static addMessageToUI(content: string, role: 'user' | 'assistant', elements: UIElements, isUpdating = false): void {
        const chatHistoryContainer = document.querySelector('.chat-history');
        if (!chatHistoryContainer) throw new Error("Chat history container not found");
        let messageElement: HTMLElement;
        if (isUpdating) {
            messageElement = chatHistoryContainer.querySelector('.message-wrapper:last-child') as HTMLElement;
            if (!messageElement) {
                messageElement = this.createMessageElement(content, role, elements);
                chatHistoryContainer.appendChild(messageElement);
            } else {
                const messageContent = messageElement.querySelector('.message-content');
                if (messageContent) {
                    messageContent.innerHTML = this.sanitizeHTML(content);
                }
            }
        } else {
            messageElement = this.createMessageElement(content, role, elements);
            chatHistoryContainer.appendChild(messageElement);
        }

        elements.answerWrapper.style.display = 'block';
    }
    

    public static createMessageElement(content: string, role: 'user' | 'assistant', elements: UIElements): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        
        wrapper.innerHTML = `
            <div class="message ${role}-message">
                <div class="message-header">
                    ${role === 'assistant' ? '<img src="/icons/icon-128.png" alt="Bot Icon" class="message-icon" onerror="this.style.display=\'none\'">' : ''}
                    <span class="timestamp">${new Date().toLocaleTimeString()}</span>
                </div>
                <div class="message-content">${this.sanitizeHTML(content)}</div>
            </div>
        `;
        return wrapper;
    }


    public static sanitizeHTML(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/\n/g, '<br>');
    }


    public enableInputs(): void {
        this.elements.queryInput.disabled = false;
        this.elements.queryInput.focus();
    }


    public disableInputs(): void {
        this.elements.queryInput.disabled = true;
    }
    

    public resetForNewMessage(): void {
        this.elements.answer.innerHTML = "";
        this.elements.answerWrapper.style.display = "none";
        this.elements.loadingIndicator.style.display = "block";
    }


    public getMessage(): string {
        return this.elements.queryInput.value;
    }


    public getElements(): UIElements {
        return this.elements;
    }

    public displayLinks(links: Array<{ text: string; href: string; score: number }>): void {
        this.elements.linkContainer.innerHTML = '';
        
        if (links.length === 0) {
            const noLinks = document.createElement('div');
            noLinks.className = 'alert';
            noLinks.textContent = 'No relevant links found on this page.';
            this.elements.linkContainer.appendChild(noLinks);
            return;
        }

        links.forEach(link => {
            const linkElement = document.createElement('div');
            linkElement.className = 'link-item';
            linkElement.style.position = 'relative';
            
            linkElement.innerHTML = `
                <div class="link-title">${UIManager.sanitizeHTML(link.text)}</div>
                <div class="link-url">${UIManager.sanitizeHTML(link.href)}</div>
                <span class="link-score">Score: ${link.score}</span>
            `;

            linkElement.addEventListener('click', () => {
                window.open(link.href, '_blank');
            });

            this.elements.linkContainer.appendChild(linkElement);
        });
    }
}