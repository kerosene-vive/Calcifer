class ContentFilter {
  constructor(options = {}) {
    this.options = {
      minimumOpacity: 0.08,
      clutterOpacity: 0.15,
      lowImportanceOpacity: 0.35,
      transitionDuration: '0.3s',
      ...options
    };
    
    this.observer = new MutationObserver(this.handleDOMChanges.bind(this));
    this.originalStyles = new Map();
    this.isEnabled = true;
    
    // Listen for cleanup messages from the extension
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'cleanup') {
        this.cleanup();
      } else if (message.action === 'initialize') {
        this.initialize();
      }
    });

    this.initialize();
  }

  initialize() {
    if (!this.isEnabled) return;

    // Add global styles with a specific ID
    const styleEl = document.createElement('style');
    styleEl.id = 'content-filter-styles';
    styleEl.textContent = `
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
    document.head.appendChild(styleEl);
    this.styleElement = styleEl;

    // Start observing DOM changes
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    // Setup event listeners
    this.boundFilterContent = this.filterContent.bind(this);
    window.addEventListener('load', this.boundFilterContent);
    window.addEventListener('popstate', this.boundFilterContent);
    window.addEventListener('pushstate', this.boundFilterContent);
    window.addEventListener('replacestate', this.boundFilterContent);

    // Initial filtering
    this.filterContent();
  }

  handleDOMChanges(mutations) {
    if (!this.isEnabled) return;

    const significantChange = mutations.some(mutation => 
      mutation.addedNodes.length > 0 ||
      (mutation.type === 'attributes' && 
       mutation.target instanceof Element && 
       mutation.target.getBoundingClientRect().width > 100)
    );

    if (significantChange) {
      this.filterContent();
    }
  }

  filterContent() {
    if (!this.isEnabled) return;

    requestAnimationFrame(() => {
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
    });
  }

  applyFilter(el, filterType, opacity) {
    // Store original styles if not already stored
    if (!this.originalStyles.has(el)) {
      this.originalStyles.set(el, {
        opacity: el.style.opacity || '',
        visibility: el.style.visibility || '',
        pointerEvents: el.style.pointerEvents || '',
        transition: el.style.transition || ''
      });
    }

    const finalOpacity = Math.max(opacity, this.options.minimumOpacity);
    el.style.opacity = finalOpacity;
    el.style.visibility = 'visible';
    el.style.pointerEvents = 'none';
    el.setAttribute('data-filtered', filterType);
  }

  removeFilter(el) {
    if (el.hasAttribute('data-filtered')) {
      const originalStyle = this.originalStyles.get(el);
      if (originalStyle) {
        el.style.opacity = originalStyle.opacity;
        el.style.visibility = originalStyle.visibility;
        el.style.pointerEvents = originalStyle.pointerEvents;
        el.style.transition = originalStyle.transition;
      } else {
        // Default reset if original styles not found
        el.style.opacity = '';
        el.style.visibility = '';
        el.style.pointerEvents = '';
        el.style.transition = '';
      }
      el.removeAttribute('data-filtered');
      this.originalStyles.delete(el);
    }
  }

  isClutter(el) {
    const clutterPatterns = [
      '[id*="ad"]', '[class*="ad"]', '[id*="sponsor"]',
      'header', 'footer', '[role="banner"]',
      '[class*="cookie"]', '[class*="popup"]', '[class*="modal"]',
      'iframe[src*="ad"]', 'iframe[src*="sponsor"]'
    ];
    return clutterPatterns.some(pattern => el.matches(pattern)) ||
      /advert|sponsor|promo|banner/i.test(el.textContent || '');
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

  cleanup() {
    this.isEnabled = false;

    // Disconnect observer
    if (this.observer) {
      this.observer.disconnect();
    }

    // Remove event listeners
    if (this.boundFilterContent) {
      window.removeEventListener('load', this.boundFilterContent);
      window.removeEventListener('popstate', this.boundFilterContent);
      window.removeEventListener('pushstate', this.boundFilterContent);
      window.removeEventListener('replacestate', this.boundFilterContent);
    }

    // Remove style element
    if (this.styleElement && this.styleElement.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement);
      this.styleElement = null;
    }

    // Restore all elements with data-filtered attribute
    document.querySelectorAll('[data-filtered]').forEach(element => {
      const originalStyle = this.originalStyles.get(element);
      if (originalStyle) {
        element.style.opacity = originalStyle.opacity;
        element.style.visibility = originalStyle.visibility;
        element.style.pointerEvents = originalStyle.pointerEvents;
        element.style.transition = originalStyle.transition;
      } else {
        element.style.opacity = '';
        element.style.visibility = '';
        element.style.pointerEvents = '';
        element.style.transition = '';
      }
      element.removeAttribute('data-filtered');
    });

    // Clear stored styles
    this.originalStyles.clear();
  }
}

// Create instance
const contentFilter = new ContentFilter({
  minimumOpacity: 0.08,
  clutterOpacity: 0.15,
  lowImportanceOpacity: 0.35,
  transitionDuration: '0.3s'
});