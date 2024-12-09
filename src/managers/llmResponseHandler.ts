// llmResponseHandler.ts
import { LLMManager } from './llmManager';
import { Link } from './types';

export class LLMResponseHandler {
    private llmManager: LLMManager;
    private onStatusUpdate: (message: string, isLoading?: boolean) => void;
    private currentRequestId: number | null = null;
    private readonly MAX_LINKS_PER_BATCH = 5;

    constructor(llmManager: LLMManager, statusCallback: (message: string, isLoading?: boolean) => void) {
        this.llmManager = llmManager;
        this.onStatusUpdate = statusCallback;
    }


    public async rankLinks(links: Link[], requestId: number): Promise<Link[]> {
        const allRankedIds: number[] = [];
        for (let i = 0; i < links.length; i += this.MAX_LINKS_PER_BATCH) {
            const batch = links.slice(i, i + this.MAX_LINKS_PER_BATCH);
            const rankedIds = await this.getLLMRanking(batch, requestId);
            allRankedIds.push(...rankedIds);
            const partialResults = this.updateLinksWithRanking(links, allRankedIds, requestId);
            await this.sendPartialUpdate(partialResults, requestId);
        }
        return this.updateLinksWithRanking(links, allRankedIds, requestId);
    }


    private async getLLMRanking(links: Link[], requestId: number): Promise<number[]> {
        this.currentRequestId = requestId;
        const seenIds = new Set<number>();
        const sortedLinks: Link[] = [];
        const prompt = `List IDs from most to least relevant:
${links.map(l => `ID:${l.id}: ${l.text}\n`).join('')}
Required format: Start your response with "RANKING:" followed by all IDs in a single comma-separated list.
Example: RANKING: 4,2,1,3,5`;
        return new Promise((resolve) => {
            this.llmManager.streamResponse(
                prompt,
                (partial) => {
                    if (requestId !== this.currentRequestId) return;
                    const nums = partial.match(/\d+/g)?.map(Number) || [];
                    for (const id of nums) {
                        if (!seenIds.has(id) && links.some(l => l.id === id)) {
                            seenIds.add(id);
                            const link = links.find(l => l.id === id);
                            if (link) {
                                link.score = 1 - (sortedLinks.length / links.length);
                                sortedLinks.push(link);
                                this.sendPartialUpdate(sortedLinks, requestId);
                            }
                        }
                    }
                },
                error => resolve(this.getFallbackRanking(links))
            ).then(() => {
                resolve([...Array.from(seenIds), ...links.map(l => l.id).filter(id => !seenIds.has(id))]);
            });
        });
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


    private getFallbackRanking(links: Link[]): number[] {
        return links.map((_, index) => index);
    }

}