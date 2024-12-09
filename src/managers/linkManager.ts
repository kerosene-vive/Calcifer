// linkManager.ts
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
        const filteredLinks = this.filterLinks(links);
        return this.llmResponseHandler.rankLinks(filteredLinks, requestId);
    }
    public async fetchPageContent(tabId: number): Promise<{links: Array<Link>}> {
        try {
            const result = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    const getContextInfo = (link: HTMLAnchorElement) => ({
                        surrounding: (() => {
                            const rect = link.getBoundingClientRect();
                            const parent = link.parentElement;
                            const text = parent?.textContent || '';
                            const linkText = link.textContent || '';
                            const linkIndex = text.indexOf(linkText);
                            const before = linkIndex >= 0 ? 
                                text.slice(Math.max(0, linkIndex - 50), linkIndex).trim() : '';
                            const after = linkIndex >= 0 ? 
                                text.slice(linkIndex + linkText.length, 
                                         linkIndex + linkText.length + 50).trim() : '';
                            return `${before} ... ${after}`.trim();
                        })(),
                        isInHeading: !!link.parentElement?.tagName.match(/^H[1-6]$/),
                        isInNav: !!link.closest('nav'),
                        isInMain: !!link.closest('main, article, [role="main"]'),
                        position: {
                            top: Math.round(link.getBoundingClientRect().top),
                            isVisible: link.getBoundingClientRect().top < window.innerHeight
                        }
                    });

                    return {
                        links: Array.from(document.getElementsByTagName('a'))
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
                            }))
                            .filter(link => link.text.length > 0)
                            .slice(0, 20)
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
        
        if (text.match(/\b(ad|ads|advert|sponsor|promotion|banner)\b/i)) return true;
        if (text.match(/\b(€|£|\$)\s*\d+/)) return true;
        if (href.includes('googleadservices') || 
            href.includes('doubleclick') ||
            href.includes('analytics') ||
            href.includes('tracking') ||
            href.includes('utm_') ||
            href.includes('/ads/')) return true;
        if (text.match(/^(menu|nav|skip|home|back|next|previous)$/i)) return true;
        if (text.match(/(share|tweet|pin it|follow)/i)) return true;
        if (text.match(/\b(privacy|terms|cookie|copyright)\b/i)) return true;
        if (text.match(/^\d+:\d+$/) || text.match(/^\d+ (minutes|hours|days) ago$/)) return true;
        if (text.length > 150 || text.length < 3) return true;
        if (text.match(/\b(copy|duplicate|mirror)\b/i)) return true;
        
        return false;
    }

    public sanitizeTitle(text: string): string {
        return text.replace(/[»►▶→·|]/g, '')
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