// linkManager.ts
import { LLMManager } from './llmManager';
import { Link } from './types';

export class LinkManager {
    private llmManager: LLMManager;
    private onStatusUpdate: (message: string, isLoading?: boolean) => void;
    private currentRequestId: number | null = null;
    private readonly MAX_LINKS_PER_BATCH = 5; // Process fewer links at a time
    private readonly MAX_CONTEXT_LENGTH = 500; // Limit context size
    constructor(llmManager: LLMManager, statusCallback: (message: string, isLoading?: boolean) => void) {
        this.llmManager = llmManager;
        this.onStatusUpdate = statusCallback;
    }

    public async rankLinks(links: Link[], requestId: number): Promise<Link[]> {
        const filteredLinks = links.filter(link => !this.isUnwantedLink(link));
        
        // Process links in smaller batches to stay within token limits
        const allRankedIds: number[] = [];
        for (let i = 0; i < filteredLinks.length; i += this.MAX_LINKS_PER_BATCH) {
            const batch = filteredLinks.slice(i, i + this.MAX_LINKS_PER_BATCH);
            const rankedIds = await this.getLLMRanking(batch, requestId);
            allRankedIds.push(...rankedIds);
            
            // Update UI with partial results
            const partialResults = this.updateLinksWithRanking(
                filteredLinks, 
                allRankedIds, 
                requestId
            );
            await this.sendPartialUpdate(partialResults, requestId);
        }

        return this.updateLinksWithRanking(filteredLinks, allRankedIds, requestId);
    }

    private async getLLMRanking(links: Link[], requestId: number): Promise<number[]> {
        this.currentRequestId = requestId;
        const prompt = this.buildRankingPrompt(links);
        const rankings = new Map<number, number>();
        let fullResponse = '';

        return new Promise((resolve, reject) => {
            this.llmManager.streamResponse(
                prompt,
                (partial, isDone) => {
                    if (requestId !== this.currentRequestId) return;
                    
                    fullResponse += partial;
                    this.processRankingResponse(fullResponse, links, rankings, requestId);
                    
                    if (isDone) {
                        resolve(this.getFinalRanking(rankings, links));
                    }
                },
                (error) => {
                    console.error('Ranking error:', error);
                    resolve(this.getFallbackRanking(links));
                }
            );
        });
    }

    private buildRankingPrompt(links: Link[]): string {
        const linkDescriptions = links.map(link => {
            // Limit context length to stay within token budget
            const context = link.context.surrounding.slice(0, this.MAX_CONTEXT_LENGTH);
            const location = link.context.isInHeading ? '[heading]' : 
                           link.context.isInMain ? '[main]' : '';
            return `ID:${link.id}\nTitle: ${this.sanitizeTitle(link.text)} ${location}\nContext: ${context}\n`;
        }).join('\n');

        return `Rank these ${links.length} links by relevance and importance (1-10).
Focus on content value and ignore promotional or duplicate content.
Respond with ID:RANK for each link (e.g. "5:9").

Links to analyze:
${linkDescriptions}

Start ranking now, one link at a time.`;
    }

    private processRankingResponse(response: string, links: Link[], rankings: Map<number, number>, requestId: number): void {
        // Look for complete ranking patterns
        const rankingPattern = /(\d+):(\d+)/g;
        const matches = [...response.matchAll(rankingPattern)];
        
        for (const match of matches) {
            const id = parseInt(match[1]);
            const rank = parseInt(match[2]);
            
            if (this.isValidRanking(id, rank, links.length) && !rankings.has(id)) {
                rankings.set(id, rank);
                this.updateLinkScore(links, id, rank, requestId);
            }
        }
    }

    private updateLinksWithRanking(links: Link[], rankedIds: number[], requestId: number): Link[] {
        const sortedLinks = rankedIds
            .map(id => {
                const link = links.find(l => l.id === id);
                if (link) {
                    link.score = 1 - (rankedIds.indexOf(id) / rankedIds.length);
                    this.onStatusUpdate(`Ranked: ${link.text.slice(0, 30)}...`, true);
                }
                return link;
            })
            .filter((link): link is Link => !!link);

        return sortedLinks;
    }
    private async sendPartialUpdate(links: Link[], requestId: number): Promise<void> {
        chrome.runtime.sendMessage({
            type: 'PARTIAL_LINKS_UPDATE',
            links,
            requestId
        });
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