import { TabManager } from './tabManager.js';

interface FilterOptions {
  minimumOpacity: number;
  clutterOpacity: number;
  lowImportanceOpacity: number;
  transitionDuration: string;
}

interface OriginalStyles {
  opacity: string;
  visibility: string;
  pointerEvents: string;
  transition: string;
}

export class ContentFilterManager {
  private observer: MutationObserver;
  private originalStyles: Map<Element, OriginalStyles>;
  private styleElement: HTMLStyleElement | null = null;
  private boundFilterContent: () => void;
  private isEnabled: boolean = true;
  private options: FilterOptions = {
    minimumOpacity: 0.08,
    clutterOpacity: 0.15,
    lowImportanceOpacity: 0.35,
    transitionDuration: '0.3s'
  };

  constructor(private tabManager: TabManager) {
    this.initialize();
  }

  private initialize(): void {
    this.originalStyles = new Map();
    this.boundFilterContent = this.filterContent.bind(this);
    this.observer = new MutationObserver(this.handleDOMChanges.bind(this));

    this.setupMessageListeners();
    this.initializeStyles();
    this.initializeObserver();
    this.setupTabListener();
    this.setupWindowListeners();
  }

  private setupMessageListeners(): void {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'cleanup') {
        this.cleanup();
      }
    });

    chrome.runtime.onSuspend?.addListener(() => {
      this.cleanup();
    });
  }

  private initializeStyles(): void {
    this.styleElement = document.createElement('style');
    this.styleElement.id = 'content-filter-styles';
    this.styleElement.textContent = `
      [data-filtered] {
        transition: opacity ${this.options.transitionDuration} ease-in-out !important;
        pointer-events: none !important;
      }
      [data-filtered="clutter"] {
        opacity: ${Math.max(this.options.clutterOpacity, this.options.minimumOpacity)} !important;
      }
      [data-filtered="low-importance"] {
        opacity: ${Math.max(this.options.lowImportanceOpacity, this.options.minimumOpacity)} !important;
      }
    `;
    document.head.appendChild(this.styleElement);
  }

  private initializeObserver(): void {
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  }

  private setupTabListener(): void {
    this.tabManager.onTabChange(async () => {
      if (this.isEnabled) {
        this.filterContent();
      }
    });
  }

  private setupWindowListeners(): void {
    window.addEventListener('load', this.boundFilterContent);
    window.addEventListener('popstate', this.boundFilterContent);
    window.addEventListener('pushstate', this.boundFilterContent);
    window.addEventListener('replacestate', this.boundFilterContent);
  }

  private handleDOMChanges(mutations: MutationRecord[]): void {
    if (!this.isEnabled) return;

    const significantChange = mutations.some(mutation => 
      mutation.addedNodes.length > 0 ||
      (mutation.type === 'attributes' && 
       mutation.target instanceof Element && 
       mutation.target.getBoundingClientRect().width > 100)
    );

    if (significantChange) {
      requestAnimationFrame(() => this.filterContent());
    }
  }

  private filterContent(): void {
    if (!this.isEnabled) return;

    const elements = Array.from(document.body.querySelectorAll('*'))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width >= 100 && rect.height >= 100;
      });

    elements.forEach(el => {
      if (this.isClutter(el)) {
        this.applyFilter(el, 'clutter', this.options.clutterOpacity);
      } else if (this.shouldHide(el)) {
        this.applyFilter(el, 'low-importance', this.options.lowImportanceOpacity);
      } else {
        this.removeFilter(el);
      }
    });
  }

  private applyFilter(el: Element, filterType: string, opacity: number): void {
    if (!this.originalStyles.has(el)) {
      const htmlEl = el as HTMLElement;
      this.originalStyles.set(el, {
        opacity: htmlEl.style.opacity || '',
        visibility: htmlEl.style.visibility || '',
        pointerEvents: htmlEl.style.pointerEvents || '',
        transition: htmlEl.style.transition || ''
      });

      htmlEl.style.opacity = Math.max(opacity, this.options.minimumOpacity).toString();
      htmlEl.style.visibility = 'visible';
      htmlEl.style.pointerEvents = 'none';
      htmlEl.setAttribute('data-filtered', filterType);
    }
  }

  private removeFilter(el: Element): void {
    if (el.hasAttribute('data-filtered')) {
      const originalStyle = this.originalStyles.get(el);
      const htmlEl = el as HTMLElement;
      
      if (originalStyle) {
        Object.assign(htmlEl.style, originalStyle);
      } else {
        htmlEl.style.opacity = '';
        htmlEl.style.visibility = '';
        htmlEl.style.pointerEvents = '';
        htmlEl.style.transition = '';
      }
      
      el.removeAttribute('data-filtered');
      this.originalStyles.delete(el);
    }
  }

  private isClutter(el: Element): boolean {
    const clutterPatterns = [
      '[id*="ad"]', '[class*="ad"]', '[id*="sponsor"]',
      'header', 'footer', '[role="banner"]',
      '[class*="cookie"]', '[class*="popup"]', '[class*="modal"]',
      'iframe[src*="ad"]', 'iframe[src*="sponsor"]'
    ];
    
    return clutterPatterns.some(pattern => el.matches(pattern)) ||
           /advert|sponsor|promo|banner/i.test(el.textContent || '');
  }

  private shouldHide(el: Element): boolean {
    return this.getImportanceScore(el) < 0.3;
  }

  private getImportanceScore(el: Element): number {
    const rect = el.getBoundingClientRect();
    let score = (rect.width * rect.height) / (window.innerWidth * window.innerHeight);
    score += el.matches('main, article') ? 0.3 : 0;
    score += el.querySelector('video, img') ? 0.2 : 0;
    score += 1 - (rect.top / document.documentElement.scrollHeight);
    return score;
  }

  public cleanup(): void {
    try {
      this.isEnabled = false;
      
      if (this.observer) {
        this.observer.disconnect();
      }

      this.removeEventListeners();
      this.removeStyles();
      this.restoreElements();
      
      this.originalStyles.clear();
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  private removeEventListeners(): void {
    window.removeEventListener('load', this.boundFilterContent);
    window.removeEventListener('popstate', this.boundFilterContent);
    window.removeEventListener('pushstate', this.boundFilterContent);
    window.removeEventListener('replacestate', this.boundFilterContent);
  }

  private removeStyles(): void {
    if (this.styleElement?.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement);
      this.styleElement = null;
    }
  }

  private restoreElements(): void {
    document.querySelectorAll('[data-filtered]').forEach(element => {
      if (element instanceof HTMLElement) {
        const originalStyle = this.originalStyles.get(element);
        if (originalStyle) {
          Object.assign(element.style, originalStyle);
        } else {
          element.style.cssText = '';
        }
        element.removeAttribute('data-filtered');
      }
    });
  }
}