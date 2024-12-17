import { LLMManager } from './llmManager';
import { Link } from './types';
import { LLMResponseHandler } from './llmResponseHandler';

interface ClickableElement {
    id: number;
    text: string;
    href?: string;
    type: 'link' | 'button';
    context: {
        surrounding: string;
        isInHeading: boolean;
        isInNav: boolean;
        isInMain: boolean;
        isSearchResult?: boolean;
        isVideoLink?: boolean;
        isWikiLink?: boolean;
        position: {
            top: number;
            isVisible: boolean;
            width?: number;
            height?: number;
            centerScore?: number;
            areaScore?: number;
            titleScore?: number;
            urlScore?: number;
        }
    };
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

    public async fetchPageContent(tabId: number): Promise<{links: Array<Link>}> {
        try {
            const result = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    const getContextInfo = (link: HTMLAnchorElement) => {
                        const rect = link.getBoundingClientRect();
                        const pageType = determinePageType();
                        
                        return {
                            surrounding: extractSurroundingText(link),
                            isInHeading: !!link.parentElement?.tagName.match(/^H[1-6]$/),
                            isInNav: isNavigationalElement(link),
                            isInMain: isMainContent(link),
                            isSearchResult: pageType === 'search' && isSearchResult(link),
                            isVideoLink: pageType === 'youtube' && isYouTubeVideo(link),
                            isWikiLink: pageType === 'wikipedia' && isWikipediaArticleLink(link),
                            position: {
                                top: Math.round(rect.top),
                                isVisible: rect.top < window.innerHeight && rect.bottom > 0,
                                width: rect.width,
                                height: rect.height,
                                centerScore: calculateCenterScore(rect),
                                areaScore: calculateAreaScore(rect),
                                urlScore: calculateUrlScore(link.href)
                            }
                        };
                    };

                    const determinePageType = (): 'search' | 'youtube' | 'wikipedia' | 'general' => {
                        const host = window.location.hostname;
                        if (host.includes('google')) return 'search';
                        if (host.includes('youtube')) return 'youtube';
                        if (host.includes('wikipedia')) return 'wikipedia';
                        return 'general';
                    };

                    const extractSurroundingText = (link: HTMLAnchorElement): string => {
                        const container = link.closest('div, p, li, td') || link.parentElement;
                        if (!container) return '';
                        const text = container.textContent || '';
                        const linkText = link.textContent || '';
                        const linkIndex = text.indexOf(linkText);
                        const before = linkIndex >= 0 ? 
                            text.slice(Math.max(0, linkIndex - 50), linkIndex).trim() : '';
                        const after = linkIndex >= 0 ? 
                            text.slice(linkIndex + linkText.length, 
                                     linkIndex + linkText.length + 50).trim() : '';
                        return `${before} ... ${after}`.trim();
                    };

                    const isNavigationalElement = (link: HTMLAnchorElement): boolean => {
                        return !!(
                            link.closest('nav, header, footer, [role="navigation"]') ||
                            link.closest('[aria-label*="navigation"]') ||
                            link.closest('[class*="nav"], [class*="menu"], [class*="header"], [class*="footer"]')
                        );
                    };

                    const isMainContent = (link: HTMLAnchorElement): boolean => {
                        return !!(
                            link.closest('main, article, [role="main"]') ||
                            link.closest('.content, .article, #content, #main')
                        );
                    };

                    const isSearchResult = (link: HTMLAnchorElement): boolean => {
                        return !!(
                            link.closest('.g') ||
                            link.closest('[data-header-feature]') ||
                            link.closest('[data-hveid]')
                        );
                    };

                    const isYouTubeVideo = (link: HTMLAnchorElement): boolean => {
                        return !!(
                            link.href.includes('/watch?v=') ||
                            link.closest('ytd-video-renderer') ||
                            link.closest('ytd-grid-video-renderer')
                        );
                    };

                    const isWikipediaArticleLink = (link: HTMLAnchorElement): boolean => {
                        return !!(
                            link.href.match(/\/wiki\/[^:]+$/) &&
                            !link.closest('.navbox, .sidebar, .infobox') &&
                            !link.href.includes('Special:') &&
                            !link.href.includes('Talk:')
                        );
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
                        const optimalArea = 4000;
                        const maxArea = 90000;
                        
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

                    const findClickableElements = () => {
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

                    // Process all clickable elements
                    const elements = findClickableElements()
                        .map((element, id) => {
                            try {
                                if (element instanceof HTMLAnchorElement) {
                                    const rect = element.getBoundingClientRect();
                                    if (!element.href || 
                                        !element.href.startsWith('http') || 
                                        element.href.includes('#') ||
                                        rect.width === 0 || 
                                        rect.height === 0) {
                                        return null;
                                    }
                                    return {
                                        id,
                                        text: (element.textContent || '').trim(),
                                        href: element.href,
                                        context: getContextInfo(element),
                                        score: 0
                                    };
                                }
                                return null;
                            } catch {
                                return null;
                            }
                        })
                        .filter((link): link is Link => 
                            link !== null && 
                            link.text.length > 0);

                    // Filter and prioritize based on page type
                    const pageType = determinePageType();
                    let filteredLinks = elements;
                    
                    if (pageType === 'search') {
                        filteredLinks = elements.filter(link => link.context.isSearchResult);
                    } else if (pageType === 'youtube') {
                        filteredLinks = elements.filter(link => link.context.isVideoLink);
                    } else if (pageType === 'wikipedia') {
                        filteredLinks = elements.filter(link => link.context.isWikiLink);
                    }

                    return {
                        links: filteredLinks.slice(0, 30)
                    };
                }
            });
            return result[0]?.result || { links: [] };
        } catch (error) {
            console.error('Failed to gather links:', error);
            return { links: [] };
        }
    }

    public async fetchClickableElements(tabId: number): Promise<{elements: Array<ClickableElement>}> {
        const linkResult = await this.fetchPageContent(tabId);
        const links = linkResult.links.map(link => ({
            ...link,
            type: 'link' as const,
        }));
        return { elements: links as ClickableElement[] };
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
        if (href.length > 130) return true;
        
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
        return this.llmResponseHandler.rankElements(this.rankElements(filteredElements), requestId);
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
}