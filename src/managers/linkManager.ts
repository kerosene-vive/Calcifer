// linkManager.ts
import { LLMManager } from './llmManager';
import { Link } from './types';

export class LinkManager {
    private llmManager: LLMManager;
    private onStatusUpdate: (message: string, isLoading?: boolean) => void;
    private currentRequestId: number | null = null;

    constructor(llmManager: LLMManager, statusCallback: (message: string, isLoading?: boolean) => void) {
        this.llmManager = llmManager;
        this.onStatusUpdate = statusCallback;
    }


    private async sendPartialUpdate(links: Link[], requestId: number): Promise<void> {
        chrome.runtime.sendMessage({
            type: 'PARTIAL_LINKS_UPDATE',
            links,
            requestId
        });
    }


    private updateLinksWithRanking(links: Link[], rankedIds: number[], requestId: number): Link[] {
        const sortedLinks = rankedIds.map(id => {
            const link = links.find(l => l.id === id);
            if (link) {
                link.score = 1 - (rankedIds.indexOf(id) / rankedIds.length);
                this.onStatusUpdate(`Ranked link: ${link.text.slice(0, 30)}...`, true);
            }
            return link;
        }).filter((link): link is Link => !!link);

        this.sendPartialUpdate(sortedLinks, requestId);
        return sortedLinks;
    }


    public async rankLinks(links: Link[], requestId: number): Promise<Link[]> {
        const filteredLinks = links.filter(link => !this.isUnwantedLink(link));
        const rankedIds = await this.getLLMRanking(filteredLinks, requestId);
        return this.updateLinksWithRanking(filteredLinks, rankedIds, requestId);
    }


    private async getLLMRanking(links: Link[], requestId: number): Promise<number[]> {
        this.currentRequestId = requestId;
        const prompt = this.buildRankingPrompt(links);
        const rankings = new Map<number, number>();
        let currentPartialResponse = '';
        return new Promise((resolve) => {
            this.llmManager.streamResponse(prompt, (partial) => {
                if (requestId !== this.currentRequestId) return;
                currentPartialResponse += partial;
                this.processRankingResponse(currentPartialResponse, links, rankings, requestId);
                currentPartialResponse = currentPartialResponse.split('\n').pop() || '';
            }).then(() => {
                resolve(this.getFinalRanking(rankings, links));
            }).catch(() => {
                resolve(this.getFallbackRanking(links));
            });
        });
    }


    private buildRankingPrompt(links: Link[]): string {
        return `Rank only the most relevant, content-rich links by importance (1-10).
Skip any promotional, sponsored, or duplicate content.
Links to rank:
${links.slice(0, 10).map(link => {
    const context = link.context.surrounding.slice(0, 100);
    const location = link.context.isInHeading ? '[heading]' : 
                    link.context.isInMain ? '[main]' : '';
    return `${link.id}: ${this.sanitizeTitle(link.text)} ${location}\nContext: ${context}\n`;
}).join('\n')}
Return each ranking immediately as: ID:RANK (e.g. "5:9")`;
    }


    private processRankingResponse(response: string, links: Link[], rankings: Map<number, number>, requestId: number): void {
        const patterns = [
            /(\d+):(\d+)/g,
            /ID[:\s]+(\d+)[:\s]+(\d+)/g,
            /^(\d+)[\s,]+(\d+)$/gm
        ];
        for (const pattern of patterns) {
            const matches = response.matchAll(pattern);
            for (const match of matches) {
                const id = parseInt(match[1]);
                const rank = parseInt(match[2]);
                if (this.isValidRanking(id, rank, links.length) && !rankings.has(id)) {
                    rankings.set(id, rank);
                    this.updateLinkScore(links, id, rank, requestId);
                }
            }
        }
    }


    private updateLinkScore(links: Link[], id: number, rank: number, requestId: number): void {
        const link = links.find(l => l.id === id);
        if (link) {
            link.score = rank / 10;
            this.onStatusUpdate(`Ranked link: ${link.text.slice(0, 30)}...`, true);
            this.sendPartialUpdate(links, requestId);
        }
    }


    private isValidRanking(id: number, rank: number, maxId: number): boolean {
        return !isNaN(id) && !isNaN(rank) && 
               id < maxId && 
               rank >= 1 && rank <= 10;
    }


    private getFinalRanking(rankings: Map<number, number>, links: Link[]): number[] {
        if (rankings.size === 0) {
            return this.getFallbackRanking(links);
        }
        return Array.from(rankings.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([id]) => id);
    }


    private isUnwantedLink(link: Link): boolean {
        const text = (link.text || '').toLowerCase();
        const href = (link.href || '').toLowerCase();
        // Promotional/ad content
        if (text.match(/\b(ad|ads|advert|sponsor|promotion|banner)\b/i)) return true;
        if (text.match(/\b(€|£|\$)\s*\d+/)) return true;
        // Tracking/analytics URLs
        if (href.includes('googleadservices') || 
            href.includes('doubleclick') ||
            href.includes('analytics') ||
            href.includes('tracking') ||
            href.includes('utm_') ||
            href.includes('/ads/')) return true;
        // UI elements
        if (text.match(/^(menu|nav|skip|home|back|next|previous)$/i)) return true;
        // Social media
        if (text.match(/(share|tweet|pin it|follow)/i)) return true;
        // Metadata
        if (text.match(/\b(privacy|terms|cookie|copyright)\b/i)) return true;
        // Timestamps
        if (text.match(/^\d+:\d+$/) || text.match(/^\d+ (minutes|hours|days) ago$/)) return true;
        // Length filters
        if (text.length > 150 || text.length < 3) return true;
        // Duplicates
        if (text.match(/\b(copy|duplicate|mirror)\b/i)) return true;
        return false;
    }


    private getFallbackRanking(links: Link[]): number[] {
        const scoredLinks = links.map((link, id) => ({
            id,
            score: this.calculateLinkScore(link)
        }));
    
        return scoredLinks
            .sort((a, b) => b.score - a.score)
            .map(link => link.id);
    }


    private calculateLinkScore(link: Link): number {
        let score = 0;
        // Position scoring
        if (link.context?.position?.isVisible) score += 0.3;
        if ((link.context?.position?.top ?? Infinity) < 500) score += 0.2;
        // Context scoring
        if (link.context?.isInHeading) score += 0.25;
        if (link.context?.isInMain) score += 0.15;
        if (!link.context?.isInNav) score += 0.1;
        // Content scoring
        if (link.text.length > 10) score += 0.1;
        if (link.context?.surrounding && link.context.surrounding.length > 50) score += 0.1;
        return score;
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