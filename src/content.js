import { isProbablyReaderable, Readability } from '@mozilla/readability';


class ContentExtractor {
  constructor() {
    this.DEFAULT_ERROR_MESSAGE = "Unable to extract content from this page.";
    this.MIN_CONTENT_LENGTH = 100;
    this.SEARCH_ENGINES = {
      google: {
        domain: 'google.com',
        selectors: [
          '#search',
          '#rso',
          '[role="main"] #center_col',
          '.g',
          '.MjjYud'
        ],
        unwantedSelectors: [
          '#botstuff',
          '#bottomplayer',
          '#topstuff',
          '.related-question-pair'
        ]
      },
      bing: {
        domain: 'bing.com',
        selectors: ['#b_results', '.b_algo'],
        unwantedSelectors: ['#b_footer', '#b_header']
      },
      duckduckgo: {
        domain: 'duckduckgo.com',
        selectors: ['.results', '.result'],
        unwantedSelectors: ['.badge-link']
      }
    };
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


  isSearchEngine(url) {
    return Object.values(this.SEARCH_ENGINES).some(engine => 
      url.includes(engine.domain)
    );
  }


  getSearchEngineConfig(url) {
    return Object.values(this.SEARCH_ENGINES).find(engine => 
      url.includes(engine.domain)
    );
  }


  async waitForDynamicContent(selectors, timeout = 3000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          return true;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }


  async extractSearchResults(engineConfig) {
    try {
      await this.waitForDynamicContent(engineConfig.selectors);
      let searchResults = [];
      for (const selector of engineConfig.selectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
          const elementClone = element.cloneNode(true);
          engineConfig.unwantedSelectors?.forEach(unwantedSelector => {
            elementClone.querySelectorAll(unwantedSelector)
              .forEach(el => el.remove());
          });
          const text = this.cleanText(elementClone.textContent);
          const links = Array.from(elementClone.querySelectorAll('a'))
            .map(a => ({
              text: this.cleanText(a.textContent),
              url: a.href
            }))
            .filter(link => link.text.length > 0);

          if (text.length > 0) {
            searchResults.push({ text, links });
          }
        });
      }
      if (searchResults.length > 0) {
        return searchResults.map(result => 
          `${result.text}${result.links.length ? '\nRelevant links:\n' + 
          result.links.map(link => `- ${link.text}: ${link.url}`).join('\n') : ''}`
        ).join('\n\n');
      }
      return null;
    } catch (error) {
      return null;
    }
  }


  async extractContent() {
    try {
      if (document.readyState !== 'complete') {
        await new Promise(resolve => {
          const timeout = setTimeout(() => resolve(), 5000);
          window.addEventListener('load', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      const url = window.location.href || '';
      const pageInfo = {
        url,
        title: document.title || '',
        timestamp: new Date().toISOString()
      };
      if (this.isSearchEngine(url)) {
        const engineConfig = this.getSearchEngineConfig(url);
        const searchContent = await this.extractSearchResults(engineConfig);
        if (searchContent) {
          return {
            ...pageInfo,
            content: searchContent,
            extractionMethod: 'search_results'
          };
        }
      }
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
  }catch (error) {
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
      await this.waitForDynamicContent(['main', 'article', '#content']);

      const content = await this.tryReadability() || 
                     await this.tryMainContent() || 
                     await this.tryDynamicContent() ||
                     await this.tryBodyContent();
      return content || this.DEFAULT_ERROR_MESSAGE;

    } catch (error) {
      return this.DEFAULT_ERROR_MESSAGE;
    }
  }


  async tryDynamicContent() {
    try {
      const dynamicSelectors = [
        '[data-content]',
        '[data-component]',
        '.dynamic-content',
        '#app',
        '#root',
        '.main-content',
        '[role="main"]'
      ];
      for (const selector of dynamicSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const cleanedContent = this.cleanText(element.textContent || '');
          const validContent = this.validateContent(cleanedContent);
          if (validContent) return validContent;
        }
      }
      const textNodes = Array.from(document.body.querySelectorAll('*'))
        .filter(el => {
          const text = this.cleanText(el.textContent || '');
          return text.length > this.MIN_CONTENT_LENGTH;
        })
        .sort((a, b) => 
          (b.textContent?.length || 0) - (a.textContent?.length || 0)
        );

      if (textNodes.length > 0) {
        const cleanedContent = this.cleanText(textNodes[0].textContent || '');
        return this.validateContent(cleanedContent);
      }
      return null;

    } catch (error) {
      return null;
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
      const unwantedSelectors = [
        'script', 'style', 'iframe', 'nav', 'header', 'footer',
        '.ads', '.comments', 'noscript', '[role="complementary"]',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        'meta', 'link', '#cookie-banner', '.cookie-notice',
        '.advertisement', '.social-share', '.related-posts'
      ];
      unwantedSelectors.forEach(selector => {
        try {
          bodyClone.querySelectorAll(selector).forEach(el => el.remove());
        } catch (e) {
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
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .replace(/[^\S\r\n]+/g, ' ')
      .replace(/^\s+|\s+$/g, '')
      .replace(/\t/g, ' ')
      .replace(/\u00A0/g, ' ')
      .replace(/\u200B/g, '')
      .replace(/^(?:[\t ]*(?:\r?\n|\r))+/, '')
      .replace(/(?:[\t ]*(?:\r?\n|\r))+$/, '')
      .trim();
  }


  validateContent(content) {
    if (!content || typeof content !== 'string') {
      return null;
    }
    const cleaned = this.cleanText(content);
    if (cleaned.length < this.MIN_CONTENT_LENGTH || cleaned.length > 1000000) {
      return null;
    }
    const words = cleaned.split(/\s+/);
    const uniqueWords = new Set(words.map(w => w.toLowerCase())); 
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

const contentExtractor = new ContentExtractor();
export { ContentExtractor, contentExtractor };