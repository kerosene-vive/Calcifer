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

    public async rankLinks(links: Link[], requestId: number): Promise<Link[]> {
        console.log('[LinkManager] Starting ranking process');
        this.currentRequestId = requestId;

        try {
            // Get visible links
            const visibleLinks = this.getVisibleLinks(links);
            console.log('[LinkManager] Found visible links:', visibleLinks.length);

            // Filter unwanted links
            const filteredLinks = visibleLinks
                .filter(link => !this.isUnwantedLink(link))
                .slice(0, 10);

            if (filteredLinks.length === 0) {
                console.log('[LinkManager] No valid links found');
                return [];
            }

            // Get LLM rankings
            const rankedIds = await this.getLLMRanking(filteredLinks, requestId);
            return this.updateLinksWithRanking(filteredLinks, rankedIds, requestId);

        } catch (error) {
            console.error('[LinkManager] Error in rankLinks:', error);
            return links;
        }
    }

    private getVisibleLinks(links: Link[]): Link[] {
        return links.filter(link => {
            if (!link.text?.trim()) return false;
            if (!link.context?.position?.isVisible) return false;
            if (!link.href || link.href.startsWith('#')) return false;
            const top = link.context?.position?.top ?? Infinity;
            return top <= 1000;
        });
    }

    private async getLLMRanking(links: Link[], requestId: number): Promise<number[]> {
        this.currentRequestId = requestId;
        const prompt = this.buildRankingPrompt(links);
        console.log('[LinkManager] LLM prompt:', prompt);
        const rankings = new Map<number, number>();
        let currentPartialResponse = '';

        return new Promise((resolve) => {
            this.llmManager.streamResponse(
                prompt,
                (partial) => {
                    if (requestId !== this.currentRequestId) return;
                    currentPartialResponse += partial;
                    console.log('[LinkManager] Partial response:', currentPartialResponse);
                    this.processRankingResponse(currentPartialResponse, links, rankings, requestId);
                    currentPartialResponse = currentPartialResponse.split('\n').pop() || '';
                },
                (error) => {
                    console.error('[LinkManager] LLM error:', error);
                    resolve(this.getFallbackRanking(links));
                }
            ).then(() => {
                if (rankings.size > 0) {
                    const finalRanking = Array.from(rankings.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([id]) => id);
                    resolve(finalRanking);
                } else {
                    console.log('[LinkManager] No valid rankings, using fallback');
                    resolve(this.getFallbackRanking(links));
                }
            });
        });
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
                    console.log('[LinkManager] Valid ranking:', id, rank);
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
            this.onStatusUpdate(`Ranked: ${link.text.slice(0, 30)}`, true);
            
            // Sort links and update UI
            const sortedLinks = [...links].sort((a, b) => (b.score || 0) - (a.score || 0));
            this.sendPartialUpdate(sortedLinks, requestId);
        }
    }

    private updateLinksWithRanking(links: Link[], rankedIds: number[], requestId: number): Link[] {
        const sortedLinks = rankedIds.map(id => {
            const link = links.find(l => l.id === id);
            if (link) {
                link.score = 1 - (rankedIds.indexOf(id) / rankedIds.length);
                this.onStatusUpdate(`Ranked: ${link.text.slice(0, 30)}`, true);
            }
            return link;
        }).filter((link): link is Link => !!link);

        sortedLinks.sort((a, b) => b.score - a.score);
        this.sendPartialUpdate(sortedLinks, requestId);
        return sortedLinks;
    }

    private async sendPartialUpdate(links: Link[], requestId: number): Promise<void> {
        if (this.currentRequestId !== requestId) return;
        
        try {
            await chrome.runtime.sendMessage({
                type: 'PARTIAL_LINKS_UPDATE',
                links,
                requestId
            });
        } catch (error) {
            console.error('[LinkManager] Update error:', error);
        }
    }

    private buildRankingPrompt(links: Link[]): string {
        return `For each link below, respond with ONLY an ID:RANK pair on each line (e.g. "5:9").
Do not include any other text or instructions.
Rank from 1-10 where 10 is most relevant.
Links:
${links.map(link => {
    const location = link.context.isInHeading ? '[heading]' : 
                    link.context.isInMain ? '[main]' : '[other]';
    return `${link.id}: ${this.sanitizeTitle(link.text)} ${location}\nURL: ${link.href}`;
}).join('\n\n')}`;
    }

    private isValidRanking(id: number, rank: number, maxId: number): boolean {
        return !isNaN(id) && !isNaN(rank) && 
               id < maxId && 
               rank >= 1 && rank <= 10;
    }

    private getFallbackRanking(links: Link[]): number[] {
        return links
            .map((link, id) => ({
                id,
                score: this.calculateLinkScore(link)
            }))
            .sort((a, b) => b.score - a.score)
            .map(link => link.id);
    }

    private calculateLinkScore(link: Link): number {
        let score = 0;
        if (link.context?.position?.isVisible) score += 0.3;
        if ((link.context?.position?.top ?? Infinity) < 500) score += 0.2;
        if (link.context?.isInHeading) score += 0.25;
        if (link.context?.isInMain) score += 0.15;
        if (!link.context?.isInNav) score += 0.1;
        if (link.text.length > 10) score += 0.1;
        if (link.context?.surrounding?.length > 50) score += 0.1;
        return score;
    }

    private isUnwantedLink(link: Link): boolean {
        const text = (link.text || '').toLowerCase();
        const href = (link.href || '').toLowerCase();

        return (
            text.match(/\b(ad|ads|advert|sponsor|promotion|banner)\b/i) ||
            text.match(/\b(€|£|\$)\s*\d+/) ||
            href.includes('googleadservices') ||
            href.includes('doubleclick') ||
            href.includes('analytics') ||
            href.includes('tracking') ||
            href.includes('utm_') ||
            href.includes('/ads/') ||
            href.length > 120 ||
            text.match(/^(menu|nav|skip|home|back|next|previous)$/i) ||
            text.match(/(share|tweet|pin it|follow)/i) ||
            text.match(/\b(privacy|terms|cookie|copyright)\b/i) ||
            text.match(/^\d+:\d+$/) ||
            text.match(/^\d+ (minutes|hours|days) ago$/) ||
            text.match(/\b(copy|duplicate|mirror)\b/i)
        );
    }

    private sanitizeTitle(text: string): string {
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