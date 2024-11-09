// content.js
import { isProbablyReaderable, Readability } from '@mozilla/readability';

class ContentExtractor {
  constructor() {
    console.log("ContentExtractor: Initializing...");
    this.setupMessageHandling();
    this.printPageInfo();
  }

  printPageInfo() {
    console.log("ContentExtractor: Page Info:", {
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      hasBody: !!document.body
    });
  }

  setupMessageHandling() {
    console.log("ContentExtractor: Setting up message handlers");

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log("ContentExtractor: Received message:", message);
      
      if (message.type === 'EXTRACT_CONTENT') {
        console.log("ContentExtractor: Starting extraction process");
        this.extractContent()
          .then(content => {
            console.log("ContentExtractor: Extraction successful:", {
              contentLength: content?.length,
              sample: content?.substring(0, 100)
            });
            chrome.runtime.sendMessage({
              type: 'CONTENT_EXTRACTED',
              content: content,
              timestamp: new Date().toISOString()
            });
            sendResponse({ success: true });
          })
          .catch(error => {
            console.error("ContentExtractor: Extraction failed:", error);
            chrome.runtime.sendMessage({
              type: 'EXTRACTION_ERROR',
              error: error.message,
              timestamp: new Date().toISOString()
            });
            sendResponse({ success: false, error: error.message });
          });
        return true; // Keep channel open for async response
      }
    });
  }

  async extractContent() {
    console.log("ContentExtractor: Starting content extraction");
    
    if (document.readyState !== 'complete') {
      console.log("ContentExtractor: Waiting for page load");
      await new Promise(resolve => window.addEventListener('load', resolve));
    }

    // Try each method in sequence
    const content = await this.tryReadability() || 
                   await this.tryMainContent() || 
                   await this.getBodyContent();

    if (!content) {
      throw new Error("No readable content found on page");
    }

    console.log("ContentExtractor: Content extracted successfully", {
      length: content.length,
      sample: content.substring(0, 100)
    });

    return content;
  }

  async tryReadability() {
    try {
      console.log("ContentExtractor: Attempting Readability");
      
      if (!isProbablyReaderable(document)) {
        console.log("ContentExtractor: Page not readable by Readability");
        return null;
      }

      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone, {
        charThreshold: 20,
        classesToPreserve: ['content', 'article']
      });
      
      const article = reader.parse();
      if (article?.textContent) {
        const text = this.cleanText(article.textContent);
        console.log("ContentExtractor: Readability extraction successful:", {
          length: text.length,
          sample: text.substring(0, 100)
        });
        return text;
      }
    } catch (error) {
      console.error("ContentExtractor: Readability failed:", error);
    }
    return null;
  }

  async tryMainContent() {
    console.log("ContentExtractor: Trying main content selectors");
    
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
        console.log(`ContentExtractor: Found element with selector: ${selector}`);
        const text = this.cleanText(element.textContent || '');
        if (text.length > 100) {
          console.log("ContentExtractor: Main content extracted:", {
            selector,
            length: text.length,
            sample: text.substring(0, 100)
          });
          return text;
        }
      }
    }
    
    console.log("ContentExtractor: No main content found");
    return null;
  }

  getBodyContent() {
    console.log("ContentExtractor: Attempting body content extraction");
    
    if (!document.body) {
      console.log("ContentExtractor: No body element found");
      return null;
    }

    const bodyClone = document.body.cloneNode(true);
    const unwantedSelectors = [
      'script', 
      'style', 
      'iframe', 
      'nav', 
      'header', 
      'footer',
      '.ads', 
      '.comments', 
      'noscript'
    ];

    unwantedSelectors.forEach(selector => {
      bodyClone.querySelectorAll(selector).forEach(el => el.remove());
    });

    const text = this.cleanText(bodyClone.textContent || '');
    console.log("ContentExtractor: Body content extraction:", {
      length: text.length,
      sample: text.substring(0, 100)
    });
    
    return text.length > 100 ? text : null;
  }

  cleanText(text) {
    if (!text) return '';
    
    const cleaned = text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    return cleaned;
  }

  static async getPageContent() {
    console.log("ContentExtractor: Static getPageContent called");
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      
      if (!currentTab.id) return null;

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: () => {
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

          // Try to get content from main selectors first
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element?.textContent) {
              return {
                content: element.textContent,
                url: window.location.href,
                title: document.title
              };
            }
          }

          // Fallback to body content
          if (document.body) {
            const bodyClone = document.body.cloneNode(true);
            // Remove unwanted elements
            ['script', 'style', 'iframe', 'nav', 'header', 'footer'].forEach(tag => {
              bodyClone.querySelectorAll(tag).forEach(el => el.remove());
            });
            
            return {
              content: bodyClone.textContent,
              url: window.location.href,
              title: document.title
            };
          }

          return null;
        }
      });

      console.log("ContentExtractor: Static method succeeded:", {
        contentLength: result?.content?.length,
        sample: result?.content?.substring(0, 100)
      });

      return result?.content || null;
    } catch (error) {
      console.error("ContentExtractor: Static method failed:", error);
      return null;
    }
  }
}

// Initialize
console.log("ContentExtractor: Creating instance...");
const contentExtractor = new ContentExtractor();

// Export both class and instance
export { ContentExtractor, contentExtractor };

// Make available for debugging
window.contentExtractor = contentExtractor;