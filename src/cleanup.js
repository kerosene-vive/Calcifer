(() => {
    // Create a permanent reset style
    const style = document.createElement('style');
    const css = `
      :root * {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        display: revert !important;
        position: revert !important;
        z-index: revert !important;
        clip: revert !important;
        clip-path: none !important;
        transform: none !important;
      }
    `;
    
    style.textContent = css;
    style.id = 'visibility-reset';
    document.documentElement.appendChild(style);
  
    // Remove all existing filtered styles
    const elements = document.querySelectorAll('[data-filtered], [style*="opacity"], [style*="visibility"]');
    elements.forEach(el => {
      el.removeAttribute('style');
      el.removeAttribute('data-filtered');
      el.className = el.className.replace(/filtered|extension/g, '');
    });
  
    // Remove any existing style elements from the extension
    document.querySelectorAll('style').forEach(style => {
      if (style.textContent.includes('filtered') || 
          style.textContent.includes('opacity') || 
          style.id.includes('content-filter')) {
        style.remove();
      }
    });
  })();