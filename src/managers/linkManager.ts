import { LLMManager } from './llmManager';
import { Link } from './types';
import { LLMResponseHandler } from './llmResponseHandler';

interface ClickableElement {
    id: number;
    text: string;
    href?: string;
    type: 'link' | 'button';
    context: Link['context'];
    score: number;
}


export class LinkManager {
    private llmResponseHandler: LLMResponseHandler;
    private readonly MAX_ELEMENTS = 10;
    private readonly MAX_CONTEXT_LENGTH = 500;
    private readonly CENTER_WEIGHT = 0.4;
    private readonly AREA_WEIGHT = 0.3;
    private readonly URL_LENGTH_WEIGHT = 0.2;
    private readonly VISIBILITY_WEIGHT = 0.1;
    private readonly MAX_URL_LENGTH = 130;
    private readonly MIN_TEXT_LENGTH = 2;

    constructor(llmManager: LLMManager, statusCallback: (message: string, isLoading?: boolean) => void) {
        this.llmResponseHandler = new LLMResponseHandler(llmManager, statusCallback);
    }

    public async fetchPageContent(tabId: number): Promise<{ links: Array<Link> }> {
        try {
            const result = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    const findClickableElements = (): HTMLElement[] => {
                        const selector = `
                            a,
                            button,
                            [role="button"],
                            [type="button"],
                            [type="submit"],
                            [onclick],
                            [class*="btn"],
                            [class*="button"],
                            input[type="button"],
                            input[type="submit"]
                        `;
                        
                        return Array.from(document.querySelectorAll(selector))
                            .filter((element): element is HTMLElement => 
                                element instanceof HTMLElement &&
                                getComputedStyle(element).display !== 'none' &&
                                getComputedStyle(element).visibility !== 'hidden' &&
                                element.offsetParent !== null);
                    };

                    const extractBestTitle = (element: HTMLElement): string => {
                        const candidates: string[] = [];
                        
                        // Special handling for YouTube
                        if (window.location.hostname.includes('youtube.com')) {
                            // Try to get the most reliable title elements first
                            const videoTitle = element.querySelector('#video-title')?.textContent?.trim();
                            if (videoTitle && !videoTitle.toLowerCase().includes('now playing')) {
                                candidates.push(videoTitle);
                            }
                    
                            // Check for title in video renderer
                            const rendererTitle = element.closest('ytd-video-renderer')?.querySelector('#video-title')?.textContent?.trim();
                            if (rendererTitle && !rendererTitle.toLowerCase().includes('now playing')) {
                                candidates.push(rendererTitle);
                            }
                    
                            // Check for title in grid renderer
                            const gridTitle = element.closest('ytd-grid-video-renderer')?.querySelector('#video-title')?.textContent?.trim();
                            if (gridTitle && !gridTitle.toLowerCase().includes('now playing')) {
                                candidates.push(gridTitle);
                            }
                    
                            // Try to get the title from the aria-label (often contains the full title)
                            const ariaLabel = element.getAttribute('aria-label');
                            if (ariaLabel) {
                                // Remove "now playing" and duration info from aria-label
                                const cleanedLabel = ariaLabel
                                    .replace(/now playing/i, '')
                                    .replace(/\d+:\d+$/, '')
                                    .replace(/^by .+? \d+ (minutes?|hours?|days?) ago/, '')
                                    .trim();
                                if (cleanedLabel.length > 0) {
                                    candidates.push(cleanedLabel);
                                }
                            }
                    
                            // Check for the metadata title
                            const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
                            if (metaTitle && element.href?.includes(metaTitle)) {
                                candidates.push(metaTitle);
                            }
                    
                            // Get text content but filter out unwanted patterns
                            const textContent = element.textContent?.trim();
                            if (textContent && !textContent.toLowerCase().includes('now playing')) {
                                candidates.push(textContent);
                            }
                        }
                        // Special handling for Google Search
                        else if (window.location.hostname.includes('google')) {
                            // Try to get the main heading first
                            const h3Title = element.closest('.g')?.querySelector('h3')?.textContent?.trim();
                            if (h3Title) {
                                candidates.push(h3Title);
                            }
                    
                            // Get the text content of the element itself
                            const linkText = element.textContent?.trim();
                            if (linkText) {
                                // Clean up common Google search result artifacts
                                const cleanedText = linkText
                                    .replace(/^https?:\/\/(www\.)?/, '')  // Remove protocol and www
                                    .replace(/\s*[-›»]\s*.*$/, '')        // Remove everything after arrows/bullets
                                    .replace(/\s+/g, ' ')                 // Normalize whitespace
                                    .trim();
                                
                                if (cleanedText.length > 0) {
                                    candidates.push(cleanedText);
                                }
                            }
                    
                            // Try to get structured data if available
                            const structuredTitle = element.closest('[data-hveid]')?.querySelector('[data-content-feature]')?.textContent?.trim();
                            if (structuredTitle) {
                                candidates.push(structuredTitle);
                            }
                        }
                        // General title extraction for other sites
                        else {
                            // Check ARIA attributes
                            const ariaLabel = element.getAttribute('aria-label');
                            if (ariaLabel) {
                                candidates.push(ariaLabel);
                            }
                            
                            // Check title attribute
                            if (element.title) {
                                candidates.push(element.title);
                            }
                            
                            // Get immediate text content
                            const directText = Array.from(element.childNodes)
                                .filter(node => node.nodeType === Node.TEXT_NODE)
                                .map(node => node.textContent?.trim())
                                .filter(text => text && 
                                       text.length > 0 && 
                                       !text.match(/^\d{2}:\d{2}$/) &&
                                       !text.match(/^(Play|Pause|Stop|Next|Previous)$/))
                                .join(' ');
                            
                            if (directText) {
                                candidates.push(directText);
                            }
                            
                            // Get text from immediate children
                            const childText = Array.from(element.children)
                                .filter(child => 
                                    !child.querySelector('a') &&
                                    !child.matches('.timestamp, .duration, .play-button, .control') &&
                                    !child.className.includes('time') &&
                                    !child.className.includes('duration'))
                                .map(child => child.textContent?.trim())
                                .filter(Boolean)
                                .join(' ');
                            
                            if (childText) {
                                candidates.push(childText);
                            }
                        }
                    
                        // Filter and clean candidates
                        const validCandidates = candidates
                            .filter(text => 
                                text && 
                                text.length >= 3 && 
                                text.length <= 150 &&
                                !text.match(/^\d+$/) &&
                                !text.match(/^(now playing|Play|Pause|Stop|Next|Previous)$/i) &&
                                !text.match(/^\d{1,2}:\d{2}$/) &&
                                !text.match(/^\d+ (seconds?|minutes?|hours?) ago$/i))
                            .map(text => sanitizeTitle(text));
                    
                        // Sort candidates by quality
                        return validCandidates
                            .sort((a, b) => {
                                // Prefer longer titles (but not too long)
                                const aLength = a.length;
                                const bLength = b.length;
                                const optimalLength = 60;
                                
                                // Calculate how close each length is to optimal
                                const aOptimalDiff = Math.abs(aLength - optimalLength);
                                const bOptimalDiff = Math.abs(bLength - optimalLength);
                                
                                // Prefer multi-word titles
                                const aWords = a.split(/\s+/).length;
                                const bWords = b.split(/\s+/).length;
                                
                                if (aWords !== bWords) return bWords - aWords;
                                return aOptimalDiff - bOptimalDiff;
                            })[0] || '';
                    };

                    const sanitizeTitle = (text: string): string => {
                        return text
                            .replace(/[»►▶→·|]/g, '')
                            .replace(/\[\d+\]/g, '')
                            .replace(/\s+/g, ' ')
                            .replace(/\b\d+[KkMm]?\s*(views?|subscribers?|followers?)\b/gi, '')
                            .replace(/\b(verified|sponsorizzato|•+)\b/gi, '')
                            .replace(/\b\d+:\d+\b/g, '')
                            .replace(/\b\d+ (minutes?|hours?|days?) ago\b/gi, '')
                            .slice(0, 100)
                            .trim();
                    };

                    const calculateCenterScore = (rect: DOMRect): number => {
                        const viewportHeight = window.innerHeight;
                        const viewportWidth = window.innerWidth;
                        const viewportCenterY = viewportHeight / 2;
                        const viewportCenterX = viewportWidth / 2;
                        
                        const elementCenterY = rect.top + (rect.height / 2);
                        const elementCenterX = rect.left + (rect.width / 2);
                        
                        const distanceY = Math.abs(viewportCenterY - elementCenterY) / (viewportHeight / 2);
                        const distanceX = Math.abs(viewportCenterX - elementCenterX) / (viewportWidth / 2);
                        
                        return 1 - (Math.sqrt(distanceX * distanceX + distanceY * distanceY) / Math.sqrt(2));
                    };

                    const calculateAreaScore = (rect: DOMRect): number => {
                        const area = rect.width * rect.height;
                        const optimalArea = 4000; // 40x100 pixels
                        const maxArea = 90000; // 300x300 pixels
                        
                        if (area <= optimalArea) {
                            return area / optimalArea;
                        } else {
                            return Math.max(0, 1 - ((area - optimalArea) / (maxArea - optimalArea)));
                        }
                    };

                    const calculateUrlScore = (url: string): number => {
                        if (!url) return 0;
                        const maxDesiredLength = 50;
                        return Math.max(0, 1 - (url.length / maxDesiredLength));
                    };

                    const determinePageType = (): 'search' | 'youtube' | 'wikipedia' | 'general' => {
                        const host = window.location.hostname;
                        if (host.includes('google')) return 'search';
                        if (host.includes('youtube')) return 'youtube';
                        if (host.includes('wikipedia')) return 'wikipedia';
                        return 'general';
                    };

                    const getContextInfo = (element: HTMLElement) => {
                        const rect = element.getBoundingClientRect();
                        const pageType = determinePageType();
                        
                        return {
                            surrounding: extractSurroundingText(element),
                            isInHeading: !!element.closest('h1,h2,h3,h4,h5,h6'),
                            isInNav: isNavigationalElement(element),
                            isInMain: isMainContent(element),
                            isSearchResult: pageType === 'search' && isSearchResult(element),
                            isVideoLink: pageType === 'youtube' && isYouTubeVideo(element),
                            isWikiLink: pageType === 'wikipedia' && isWikipediaArticleLink(element),
                            position: {
                                top: Math.round(rect.top),
                                isVisible: rect.top < window.innerHeight && rect.bottom > 0,
                                width: rect.width,
                                height: rect.height,
                                centerScore: calculateCenterScore(rect),
                                areaScore: calculateAreaScore(rect),
                                urlScore: element instanceof HTMLAnchorElement ? calculateUrlScore(element.href) : 1
                            }
                        };
                    };

                    const extractSurroundingText = (element: HTMLElement): string => {
                        const container = element.closest('div, p, li, td') || element.parentElement;
                        if (!container) return '';
                        const text = container.textContent || '';
                        const elementText = element.textContent || '';
                        const textIndex = text.indexOf(elementText);
                        const before = textIndex >= 0 ? 
                            text.slice(Math.max(0, textIndex - 50), textIndex).trim() : '';
                        const after = textIndex >= 0 ? 
                            text.slice(textIndex + elementText.length, 
                                     textIndex + elementText.length + 50).trim() : '';
                        return `${before} ... ${after}`.trim();
                    };

                    const isNavigationalElement = (element: HTMLElement): boolean => {
                        return !!(
                            element.closest('nav, header, footer, [role="navigation"]') ||
                            element.closest('[aria-label*="navigation"]') ||
                            element.closest('[class*="nav"], [class*="menu"], [class*="header"], [class*="footer"]')
                        );
                    };

                    const isMainContent = (element: HTMLElement): boolean => {
                        return !!(
                            element.closest('main, article, [role="main"]') ||
                            element.closest('.content, .article, #content, #main')
                        );
                    };

                    const isSearchResult = (element: HTMLElement): boolean => {
                        return !!(
                            element.closest('.g') ||
                            element.closest('[data-header-feature]') ||
                            element.closest('[data-hveid]')
                        );
                    };

                    const isYouTubeVideo = (element: HTMLElement): boolean => {
                        if (!(element instanceof HTMLAnchorElement)) return false;
                        return !!(
                            element.href.includes('/watch?v=') ||
                            element.closest('ytd-video-renderer') ||
                            element.closest('ytd-grid-video-renderer')
                        );
                    };

                    const isWikipediaArticleLink = (element: HTMLElement): boolean => {
                        if (!(element instanceof HTMLAnchorElement)) return false;
                        return !!(
                            element.href.match(/\/wiki\/[^:]+$/) &&
                            !element.closest('.navbox, .sidebar, .infobox') &&
                            !element.href.includes('Special:') &&
                            !element.href.includes('Talk:')
                        );
                    };

                    // Main link processing
                    let allLinks = findClickableElements()
                        .filter(element => element instanceof HTMLAnchorElement)
                        .map((element, id) => {
                            try {
                                const anchorElement = element as HTMLAnchorElement;
                                const title = extractBestTitle(anchorElement);
                                if (!title) return null;

                                return {
                                    id,
                                    text: title,
                                    href: anchorElement.href,
                                    context: getContextInfo(anchorElement),
                                    score: 0
                                };
                            } catch {
                                return null;
                            }
                        })
                        .filter((link): link is Link => 
                            link !== null && 
                            link.text.length > 0 &&
                            link.href.startsWith('http') &&
                            !link.href.includes('#'));

                    const pageType = determinePageType();
                    let filteredLinks = allLinks;
                    
                    // Page-specific filtering
                    if (pageType === 'search') {
                        const searchLinks = allLinks.filter(link => link.context.isSearchResult);
                        filteredLinks = searchLinks.length > 0 ? searchLinks : allLinks;
                    } else if (pageType === 'youtube') {
                        const videoLinks = allLinks.filter(link => link.context.isVideoLink);
                        filteredLinks = videoLinks.length > 0 ? videoLinks : allLinks;
                    } else if (pageType === 'wikipedia') {
                        const wikiLinks = allLinks.filter(link => link.context.isWikiLink);
                        filteredLinks = wikiLinks.length > 0 ? wikiLinks : allLinks;
                    }

                    // Score and sort links
                    filteredLinks = filteredLinks
                        .filter((link): link is Link => link !== null && link.id !== undefined)
                        .map(link => ({
                            ...link,
                            score: (
                                (link.context.position.centerScore || 0) * 0.4 +
                                (link.context.position.areaScore || 0) * 0.3 +
                                (link.context.position.urlScore || 0) * 0.3
                            )
                        }))
                        .sort((a, b) => b.score - a.score);

                    // Final filtering
                    let finalLinks = filteredLinks;
                    const targetLinkCount = 10;

                    if (finalLinks.length > targetLinkCount) {
                        // Try strict filtering first
                        const strictFiltered = finalLinks.filter(link => {
                            const href = link.href.toLowerCase();
                            return !href.includes('?') && // Clean URLs
                                   link.text.split(' ').length > 1 && // Multi-word titles
                                   !link.context.isInNav && // Non-navigation
                                   link.text.length >= 5; // Minimum length
                        });

                        if (strictFiltered.length >= targetLinkCount) {
                            finalLinks = strictFiltered;
                        } else {
                            // Fall back to lenient filtering
                            const lenientFiltered = finalLinks.filter(link => {
                                const href = link.href.toLowerCase();
                                return !href.includes('?utm_') && // No tracking
                                       !href.includes('/ajax/') && // No AJAX calls
                                       !href.includes('/api/') && // No API calls
                                       link.text.length >= 3; // Minimum length
                            });
                            
                            finalLinks = lenientFiltered.length >= targetLinkCount ? lenientFiltered : finalLinks;
                        }
                    }

                    return {
                        links: finalLinks
                            .slice(0, targetLinkCount)
                            .map(link => ({
                                ...link,
                                text: sanitizeTitle(link.text) // Final sanitization
                            }))
                    };
                }
            });

            return result[0]?.result || { links: [] };
        } catch (error) {
            console.error('Failed to gather links:', error);
            return { links: [] };
        }
    }

    public async fetchClickableElements(tabId: number): Promise<{ elements: Array<ClickableElement> }> {
        const linkResult = await this.fetchPageContent(tabId);
        const elements = linkResult.links.map(link => ({
            ...link,
            href: link.href || '',
            type: 'link' as const,
        }));
        return { elements };
    }

    private filterLinks(links: Link[]): Link[] {
        return links.filter(link => !this.isUnwantedLink(link));
    }

    private isUnwantedLink(link: Link): boolean {
        const text = (link.text || '').toLowerCase();
        const href = (link.href || '').toLowerCase();
        
        const unwantedPatterns = {
            ads: /\b(ad|ads|advert|sponsor|promotion|banner)\b/i,
            prices: /\b(€|£|\$)\s*\d+/,
            tracking: /(googleadservices|doubleclick|analytics|tracking|utm_|\/ads\/)/,
            navigation: /^(menu|nav|skip|home|back|next|previous)$/i,
            social: /(share|tweet|pin it|follow)/i,
            legal: /\b(privacy|terms|cookie|copyright)\b/i,
            timestamps: /^\d+:\d+$|^\d+ (minutes|hours|days) ago$/,
            utility: /\b(copy|duplicate|mirror)\b/i,
            engagement: /\b\d+[KkMm]?\s*(views?|subscribers?|followers?)\b/i
        };

        if (text.length > 150 || text.length < 3) return true;
        if (href.length > this.MAX_URL_LENGTH) return true;
        
        for (const pattern of Object.values(unwantedPatterns)) {
            if (text.match(pattern) || href.match(pattern)) return true;
        }

        if (link.context) {
            if (link.context.isInNav && !link.context.isInMain) return true;
            
            if (link.context.isSearchResult || 
                link.context.isVideoLink || 
                link.context.isWikiLink) return false;
        }

        return false;
    }

    private rankElements(elements: ClickableElement[]): ClickableElement[] {
        return elements
            .map(element => {
                const centerScore = (element.context.position.centerScore || 0) * this.CENTER_WEIGHT;
                const areaScore = (element.context.position.areaScore || 0) * this.AREA_WEIGHT;
                const urlScore = (element.context.position.urlScore || 1) * this.URL_LENGTH_WEIGHT;
                const visibilityScore = (element.context.position.isVisible ? 1 : 0) * this.VISIBILITY_WEIGHT;
                
                const score = centerScore + areaScore + urlScore + visibilityScore;
                
                return {
                    ...element,
                    score
                };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, this.MAX_ELEMENTS);
    }

    public async processElements(elements: ClickableElement[], requestId: number): Promise<ClickableElement[]> {
        const filteredElements = elements.filter(element => 
            element.type === 'link' ? !this.isUnwantedLink(element as Link) : true
        );
        const rankedElements = this.rankElements(filteredElements);
        const links: Link[] = rankedElements.map(element => ({
            id: element.id,
            text: element.text,
            href: element.href!,
            context: element.context,
            score: element.score
        }));
        const rankedLinks = await this.llmResponseHandler.rankLinks(links, requestId);
        return rankedLinks.map(link => ({
            ...link,
            type: 'link' as const
        }));
    }

    public sanitizeTitle(text: string): string {
        return text
            .replace(/[»►▶→·|]/g, '')
            .replace(/\[\d+\]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/\b\d+[KkMm]?\s*(views?|subscribers?|followers?)\b/gi, '')
            .replace(/\b(verified|sponsorizzato|•+)\b/gi, '')
            .replace(/\b\d+:\d+\b/g, '')
            .replace(/\b\d+ (minutes?|hours?|days?) ago\b/gi, '')
            .slice(0, 100)
            .trim();
    }

    public async processLinks(links: Link[], requestId: number): Promise<Link[]> {
        console.log(`Processing ${links.length} links...`);
        for (const link of links) {
            console.log(`- ${link.text} (${link.href})`);
        }
        const filteredLinks = this.filterLinks(links);
        for (const link of filteredLinks) {
           console.log(`- ${link.text} (${link.href})`);
        }
        return this.llmResponseHandler.rankLinks(filteredLinks, requestId);
    }


}