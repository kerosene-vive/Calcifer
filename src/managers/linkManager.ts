import { LLMManager } from './llmManager';
import { Link } from './types';
import { LLMResponseHandler } from './llmResponseHandler';

export class LinkManager {
    private llmResponseHandler: LLMResponseHandler;
    private readonly MAX_CONTEXT_LENGTH = 500;

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
                        const parent = link.parentElement;
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
                                isVisible: rect.top < window.innerHeight && rect.bottom > 0
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
                            link.closest('.g') || // Google search result container
                            link.closest('[data-header-feature]') || // Featured snippet
                            link.closest('[data-hveid]') // Standard search result
                        );
                    };

                    const isYouTubeVideo = (link: HTMLAnchorElement): boolean => {
                        return !!(
                            link.href.includes('/watch?v=') || // Video page
                            link.closest('ytd-video-renderer') || // Video in search/home
                            link.closest('ytd-grid-video-renderer') // Video in channel/playlist
                        );
                    };

                    const isWikipediaArticleLink = (link: HTMLAnchorElement): boolean => {
                        return !!(
                            link.href.match(/\/wiki\/[^:]+$/) && // Wiki article URL pattern
                            !link.closest('.navbox, .sidebar, .infobox') && // Exclude navigation elements
                            !link.href.includes('Special:') && // Exclude special pages
                            !link.href.includes('Talk:') // Exclude talk pages
                        );
                    };

                    const links = Array.from(document.getElementsByTagName('a'))
                        .filter(link => {
                            try {
                                const rect = link.getBoundingClientRect();
                                return link.href && 
                                       link.href.startsWith('http') && 
                                       !link.href.includes('#') &&
                                       rect.width > 0 && 
                                       rect.height > 0;
                            } catch {
                                return false;
                            }
                        })
                        .map((link, id) => ({
                            id,
                            text: (link.textContent || '').trim(),
                            href: link.href,
                            context: getContextInfo(link),
                            score: 0
                        }));

                    // Filter and prioritize based on page type
                    const pageType = determinePageType();
                    let filteredLinks = links;
                    
                    if (pageType === 'search') {
                        filteredLinks = links.filter(link => link.context.isSearchResult);
                    } else if (pageType === 'youtube') {
                        filteredLinks = links.filter(link => link.context.isVideoLink);
                    } else if (pageType === 'wikipedia') {
                        filteredLinks = links.filter(link => link.context.isWikiLink);
                    }

                    return {
                        links: filteredLinks
                            .filter(link => link.text.length > 0)
                            .slice(0, 30)
                    };
                }
            });
            return result[0]?.result || { links: [] };
        } catch (error) {
            console.error('Failed to gather links:', error);
            return { links: [] };
        }
    }

    private filterLinks(links: Link[]): Link[] {
        return links.filter(link => !this.isUnwantedLink(link));
    }

    private isUnwantedLink(link: Link): boolean {
        const text = (link.text || '').toLowerCase();
        const href = (link.href || '').toLowerCase();
        
        // Common patterns for unwanted links
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

        // Check text length
        if (text.length > 150 || text.length < 3) return true;
        if (href.length > 130) return true;
        // Check patterns
        for (const pattern of Object.values(unwantedPatterns)) {
            if (text.match(pattern) || href.match(pattern)) return true;
        }

        // Context-based filtering
        if (link.context) {
            // Filter out pure navigation links unless they're in main content
            if (link.context.isInNav && !link.context.isInMain) return true;
            
            // Keep search results, video links, and wiki articles regardless of other filters
            if (link.context.isSearchResult || 
                link.context.isVideoLink || 
                link.context.isWikiLink) return false;
        }

        return false;
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