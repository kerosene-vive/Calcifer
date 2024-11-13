import { isProbablyReaderable, Readability } from '@mozilla/readability';

class ContentExtractor {
  constructor() {
    this.DEFAULT_ERROR_MESSAGE = "Unable to extract content from this page.";
    this.MIN_CONTENT_LENGTH = 100;
    this.setupMessageHandling();
  }

  setupMessageHandling() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'EXTRACT_CONTENT') {
        this.extractContent()
          .then(result => {
            chrome.runtime.sendMessage({
              type: 'CONTENT_EXTRACTED',
              ...result,
              timestamp: new Date().toISOString()
            });
            sendResponse({ success: true });
          })
          .catch(error => {
            const errorResult = {
              type: 'EXTRACTION_ERROR',
              content: this.DEFAULT_ERROR_MESSAGE,
              error: error.message,
              timestamp: new Date().toISOString()
            };
            chrome.runtime.sendMessage(errorResult);
            sendResponse({ success: false, ...errorResult });
          });
        return true;
      }
    });
  }

  async extractContent() {
    try {
      // Wait for page to be fully loaded
      if (document.readyState !== 'complete') {
        await new Promise(resolve => {
          const timeout = setTimeout(() => resolve(), 5000); // 5s timeout
          window.addEventListener('load', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }

      // Get basic page info
      const pageInfo = {
        url: window.location.href || '',
        title: document.title || '',
        timestamp: new Date().toISOString()
      };

      // Try each extraction method
      const content = await this.safeExtract();

      if (!content) {
        return {
          ...pageInfo,
          content: this.DEFAULT_ERROR_MESSAGE,
          extractionMethod: 'failed'
        };
      }

      return {
        ...pageInfo,
        content,
        extractionMethod: 'success'
      };

    } catch (error) {
      return {
        url: window.location.href || '',
        title: document.title || '',
        content: this.DEFAULT_ERROR_MESSAGE,
        error: error.message,
        timestamp: new Date().toISOString(),
        extractionMethod: 'error'
      };
    }
  }

  async safeExtract() {
    try {
      // Try each method in sequence
      const content = await this.tryReadability() || 
                     await this.tryMainContent() || 
                     await this.tryBodyContent();

      return content || this.DEFAULT_ERROR_MESSAGE;
    } catch (error) {
      return this.DEFAULT_ERROR_MESSAGE;
    }
  }

  async tryReadability() {
    try {
      if (!document?.documentElement || !isProbablyReaderable(document)) {
        return null;
      }

      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone);
      const article = reader.parse();

      if (!article?.textContent) {
        return null;
      }

      const cleanedContent = this.cleanText(article.textContent);
      return this.validateContent(cleanedContent);

    } catch (error) {
      return null;
    }
  }

  async tryMainContent() {
    try {
      const selectors = [
        'main',
        'article',
        '[role="main"]',
        '#main-content',
        '.article-content',
        '.post-content',
        '#content',
        '.content'
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          const cleanedContent = this.cleanText(element.textContent || '');
          const validContent = this.validateContent(cleanedContent);
          if (validContent) return validContent;
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  async tryBodyContent() {
    try {
      if (!document?.body) return null;

      const bodyClone = document.body.cloneNode(true);
      
      // Remove unwanted elements
      const unwantedSelectors = [
        'script', 'style', 'iframe', 'nav', 'header', 'footer',
        '.ads', '.comments', 'noscript', '[role="complementary"]',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]'
      ];

      unwantedSelectors.forEach(selector => {
        try {
          bodyClone.querySelectorAll(selector).forEach(el => el.remove());
        } catch (e) {
          // Continue if selector fails
        }
      });

      const cleanedContent = this.cleanText(bodyClone.textContent || '');
      return this.validateContent(cleanedContent);

    } catch (error) {
      return null;
    }
  }

  cleanText(text) {
    if (!text || typeof text !== 'string') return '';

    return text
      .replace(/\s+/g, ' ')           // Replace multiple spaces with single space
      .replace(/\n\s*\n/g, '\n\n')    // Normalize line breaks
      .replace(/[^\S\r\n]+/g, ' ')    // Replace multiple whitespace with single space
      .replace(/^\s+|\s+$/g, '')      // Trim start and end
      .replace(/\t/g, ' ')            // Replace tabs with spaces
      .replace(/\u00A0/g, ' ')        // Replace non-breaking spaces
      .replace(/\u200B/g, '')         // Remove zero-width spaces
      .trim();
  }

  validateContent(content) {
    if (!content || typeof content !== 'string') {
      return null;
    }

    const cleaned = this.cleanText(content);
    
    // Check minimum length and maximum length
    if (cleaned.length < this.MIN_CONTENT_LENGTH || cleaned.length > 1000000) {
      return null;
    }

    // Check if content is mostly gibberish or repetitive
    const words = cleaned.split(/\s+/);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    
    // If there's very low word variety, it might be a menu/navigation
    if (words.length > 50 && uniqueWords.size < words.length * 0.1) {
      return null;
    }

    return cleaned;
  }

  static async getPageContent() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      
      if (!currentTab?.id) {
        return "Unable to access the current tab.";
      }

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: () => {
          const extractor = new ContentExtractor();
          return extractor.extractContent();
        }
      });

      return result?.content || "Unable to extract content from this page.";

    } catch (error) {
      return "Unable to extract content from this page.";
    }
  }
}

// Initialize and export
const contentExtractor = new ContentExtractor();
export { ContentExtractor, contentExtractor };