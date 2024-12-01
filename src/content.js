// content.js

class LinkAnalyzer {
    constructor() {
        this.stopWords = new Set([
            'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
            'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
            'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
            'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there',
            'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get',
            'which', 'go', 'me'
        ]);

        this.domain = window.location.hostname.toLowerCase();
        this.url = window.location.href.toLowerCase();
        this.keywords = this.extractPageKeywords();
    }

    extractPageKeywords() {
        const title = document.title;
        const metaKeywords = document.querySelector('meta[name="keywords"]')?.content || '';
        const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
        const h1Text = Array.from(document.querySelectorAll('h1')).map(h => h.textContent || '').join(' ');
        const h2Text = Array.from(document.querySelectorAll('h2')).map(h => h.textContent || '').join(' ');

        const combinedText = `${title} ${metaKeywords} ${metaDescription} ${h1Text} ${h2Text}`.toLowerCase();
        
        return combinedText
            .split(/[\s,.-]+/)
            .filter(word => word.length > 3)
            .filter(word => !this.stopWords.has(word))
            .filter(word => word.match(/^[a-z0-9]+$/));
    }

    calculateRelevance(link) {
        let score = 0;
        const linkText = link.textContent?.toLowerCase() || '';
        const linkHref = link.href.toLowerCase();
        const rect = link.getBoundingClientRect();

        // Visibility score (0-3)
        if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
            score += 3; // Fully visible
        } else if (rect.top >= 0 && rect.top <= window.innerHeight) {
            score += 2; // Partially visible (top)
        } else if (rect.bottom >= 0 && rect.bottom <= window.innerHeight) {
            score += 1; // Partially visible (bottom)
        }

        // Keyword matching (0-5)
        const textWords = new Set(linkText.split(/\s+/));
        this.keywords.forEach(keyword => {
            if (textWords.has(keyword)) score += 2;
            if (linkHref.includes(keyword)) score += 1;
        });

        // Link attributes (0-3)
        if (link.title) score += 1;
        if (link.hasAttribute('aria-label')) score += 1;
        if (link.hasAttribute('role')) score += 1;

        // Content quality (0-3)
        if (linkText.length > 10 && linkText.length < 100) score += 2;
        if (linkText.match(/^[A-Z]/)) score += 1;

        // Structural importance (0-4)
        const parentElement = link.parentElement;
        if (parentElement) {
            if (parentElement.tagName.match(/^H[1-6]$/)) score += 2;
            if (parentElement.tagName === 'NAV') score += 1;
            if (parentElement.tagName === 'MAIN') score += 1;
        }

        // Internal/external link (0-2)
        if (linkHref.includes(this.domain)) {
            score += 1; // Internal link
            if (linkHref !== this.url) score += 1; // Not current page
        }

        return score;
    }

    analyzeLinks() {
        return Array.from(document.getElementsByTagName('a'))
            .filter(link => {
                try {
                    return link.href && 
                           link.href.startsWith('http') && 
                           !link.href.includes('#') &&
                           link.offsetParent !== null;
                } catch {
                    return false;
                }
            })
            .map(link => ({
                text: (link.textContent || link.href).trim(),
                href: link.href,
                score: this.calculateRelevance(link)
            }))
            .filter(link => link.text.length > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
    }
}

// Initialize
let analyzer = null;

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
        switch (request.action) {
            case 'ping':
                sendResponse({ success: true });
                break;

            case 'analyzeLinks':
                if (!analyzer) {
                    analyzer = new LinkAnalyzer();
                }
                const results = analyzer.analyzeLinks();
                sendResponse({ success: true, links: results });
                break;

            case 'cleanup':
                analyzer = null;
                sendResponse({ success: true });
                break;

            default:
                sendResponse({ success: false, error: 'Unknown action' });
        }
    } catch (error) {
        console.error('Error in content script:', error);
        sendResponse({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
    return true; // Keep channel open for async response
});

// Notify that content script is ready
chrome.runtime.sendMessage({ 
    action: 'contentScriptReady',
    url: window.location.href 
}).catch(() => {
    // Ignore any errors during initialization notification
});