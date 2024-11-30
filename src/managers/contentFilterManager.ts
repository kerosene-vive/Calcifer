import { TabManager } from './tabManager.js';

export class ContentFilterManager {
  private observer: MutationObserver;
  
  constructor(private tabManager: TabManager) {
    this.observer = new MutationObserver(this.handleDOMChanges.bind(this));
    this.initializeObserver();
    this.setupTabListener();
  }

  private initializeObserver() {
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  private setupTabListener() {
    this.tabManager.onTabChange(async () => {
      this.filterContent();
    });
  }

  private handleDOMChanges() {
    this.filterContent();
  }

  private filterContent() {
    const elements = Array.from(document.body.querySelectorAll('*'))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width >= 100 && rect.height >= 100;
      });

    elements.forEach(el => {
      if (this.isClutter(el)) {
        (el as HTMLElement).style.visibility = 'hidden';
      } else if (this.shouldHide(el)) {
        (el as HTMLElement).style.visibility = 'hidden';
      }
    });
  }

  private isClutter(el: Element): boolean {
    return (
      el.matches('[id*="ad"], [class*="ad"], [id*="sponsor"]') ||
      el.matches('header, footer, [role="banner"]') ||
      el.matches('[class*="cookie"], [class*="popup"]')
    );
  }

  private shouldHide(el: Element): boolean {
    const score = this.getImportanceScore(el);
    return score < 0.3;
  }

  private getImportanceScore(el: Element): number {
    const rect = el.getBoundingClientRect();
    let score = (rect.width * rect.height) / (window.innerWidth * window.innerHeight);
    score += el.matches('main, article') ? 0.3 : 0;
    score += el.querySelector('video, img') ? 0.2 : 0;
    return score;
  }
}