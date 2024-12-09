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