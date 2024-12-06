export interface UIElements {
    answerWrapper: HTMLElement;
    answer: HTMLElement;
    loadingIndicator: HTMLElement;
    loadingContainer: HTMLElement;
    linkContainer: HTMLElement;
    chatHistory: HTMLElement;
}

export class UIManager {
    private elements: UIElements;
    private readonly ANIMATION_DELAY = 150; // Delay between each link animation

    constructor() {
        this.elements = this.initializeElements();
    }


    private initializeElements(): UIElements {
        const elements = {
            answerWrapper: document.getElementById("answerWrapper") as HTMLElement,
            answer: document.getElementById("answer") as HTMLElement,
            loadingIndicator: document.getElementById("loading-indicator") as HTMLElement,
            loadingContainer: document.getElementById("loadingContainer") as HTMLElement,
            linkContainer: document.createElement('div'),
            chatHistory: document.querySelector('.chat-history') as HTMLElement,
        };
        elements.linkContainer.id = 'link-container';
        elements.chatHistory.appendChild(elements.linkContainer);
        this.verifyElements(elements);
        return elements;
    }


    private verifyElements(elements: UIElements): void {
        Object.entries(elements).forEach(([key, element]) => {
            if (!element) throw new Error(`Required UI element not found: ${key}`);
        });
    }

    
    public clearLinks(): void {
        if (this.elements.linkContainer) {
            this.elements.linkContainer.innerHTML = '';
            const loadingElement = document.createElement('div');
            loadingElement.className = 'loading-placeholder';
            loadingElement.textContent = 'Analyzing links...';
            this.elements.linkContainer.appendChild(loadingElement);
            this.handleLoadingStatus('Analyzing links...', true);
        }
    }


    public displayLinks(links: Array<{ text: string; href: string; score: number }>): void {
        console.log("[UIManager] Displaying links:", links.length);
        this.handleLoadingStatus('Analysis complete', false);

        const container = this.elements.linkContainer;
        container.innerHTML = '';
        if (!links?.length) {
            this.displayNoLinksMessage();
            return;
        }
        const logoContainer = document.createElement('div');
        logoContainer.className = 'logo-container';
        const logo = document.createElement('div');
        logo.className = 'logo';
        logoContainer.appendChild(logo);
        container.appendChild(logoContainer);
        const linksWrapper = document.createElement('div');
        linksWrapper.className = 'links-wrapper';
        const validLinks = links.filter(link => link.score > 0)
                              .sort((a, b) => b.score - a.score);
        validLinks.forEach((link, index) => {
            const linkElement = this.createLinkElement(link);
            linkElement.style.animationDelay = `${(index + 1) * this.ANIMATION_DELAY}ms`;
            linksWrapper.appendChild(linkElement);
        });

        container.appendChild(linksWrapper);
        container.style.display = 'block';

    }


    private createLinkElement(link: { text: string; href: string; score: number }): HTMLElement {
        const linkElement = document.createElement('div');
        linkElement.className = 'link-item';
        const header = document.createElement('div');
        header.className = 'link-header';
        const title = document.createElement('div');
        title.className = 'link-title';
        title.textContent = link.text;
        const score = document.createElement('span');
        score.className = 'link-score';
        score.textContent = `${Math.round(link.score * 100)}%`;
        const url = document.createElement('div');
        url.className = 'link-url';
        url.textContent = link.href;
        header.appendChild(title);
        header.appendChild(score);
        linkElement.appendChild(header);
        linkElement.appendChild(url);
        linkElement.addEventListener('click', (e) => {
            e.preventDefault();
            this.openLink(link.href);
        });
        return linkElement;
    }


    private displayNoLinksMessage(): void {
        const noLinks = document.createElement('div');
        noLinks.className = 'alert';
        noLinks.textContent = 'No relevant links found on this page.';
        this.elements.linkContainer.appendChild(noLinks);
    }


    private openLink(url: string): void {
        console.log('[UIManager] Opening link:', url);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.update(tabs[0].id, { url });
            }
        });
    }


    public handleLoadingStatus(message: string, isLoading = true): void {
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = `Status: ${message}`;
            statusElement.classList.toggle('loading', isLoading);
            // Add or remove complete class based on loading state
            statusElement.classList.toggle('complete', !isLoading);
            
            // Show/hide loading container
            if (this.elements.loadingContainer) {
                this.elements.loadingContainer.style.display = isLoading ? 'flex' : 'none';
            }
        }
    }


    public handleLoadingError(message: string): void {
        this.handleLoadingStatus('Error occurred', false);

        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        const alert = document.createElement('div');
        alert.className = 'alert alert-error';
        const title = document.createElement('h3');
        title.textContent = 'Error';
        const content = document.createElement('p');
        content.textContent = message;
        const retryButton = document.createElement('button');
        retryButton.className = 'retry-button';
        retryButton.textContent = 'Retry';
        retryButton.onclick = () => location.reload();
        alert.appendChild(title);
        alert.appendChild(content);
        alert.appendChild(retryButton);
        errorDiv.appendChild(alert);
        this.elements.loadingContainer.innerHTML = '';
        this.elements.loadingContainer.appendChild(errorDiv);
    }


    public getElements(): UIElements {
        return this.elements;
    }

}