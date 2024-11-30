// content.js
class ContentFilter {
  constructor() {
    this.observer = new MutationObserver(this.handleDOMChanges.bind(this));
    this.initialize();
  }

  initialize() {
    this.filterContent();
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    
    // Handle dynamic page changes
    window.addEventListener('load', () => this.filterContent());
    window.addEventListener('popstate', () => this.filterContent());
    window.addEventListener('pushstate', () => this.filterContent());
    window.addEventListener('replacestate', () => this.filterContent());
  }

  handleDOMChanges(mutations) {
    const significantChange = mutations.some(mutation => {
      return mutation.addedNodes.length > 0 || 
             (mutation.type === 'attributes' && mutation.target.getBoundingClientRect().width > 100);
    });
    if (significantChange) {
      this.filterContent();
    }
  }

  filterContent() {
    requestAnimationFrame(() => {
      const elements = Array.from(document.body.querySelectorAll('*'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width >= 100 && rect.height >= 100;
        });

      elements.forEach(el => {
        const id = el.id || `section-${Math.random().toString(36).slice(2)}`;
        if (!el.id) el.id = id;
        
        if (this.isClutter(el)) {
          el.style.visibility = 'hidden';
          el.setAttribute('data-filtered', 'clutter');
        } else if (this.shouldHide(el)) {
          el.style.visibility = 'hidden';
          el.setAttribute('data-filtered', 'low-importance');
        }
      });
    });
  }

  isClutter(el) {
    const clutterPatterns = [
      '[id*="ad"]', '[class*="ad"]', '[id*="sponsor"]',
      'header', 'footer', '[role="banner"]',
      '[class*="cookie"]', '[class*="popup"]', '[class*="modal"]',
      'iframe[src*="ad"]', 'iframe[src*="sponsor"]'
    ];
    return clutterPatterns.some(pattern => el.matches(pattern)) ||
           /advert|sponsor|promo|banner/i.test(el.textContent);
  }

  shouldHide(el) {
    return this.getImportanceScore(el) < 0.3;
  }

  getImportanceScore(el) {
    const rect = el.getBoundingClientRect();
    let score = (rect.width * rect.height) / (window.innerWidth * window.innerHeight);
    score += el.matches('main, article') ? 0.3 : 0;
    score += el.querySelector('video, img') ? 0.2 : 0;
    score += 1 - (rect.top / document.documentElement.scrollHeight);
    return score;
  }
}

new ContentFilter();