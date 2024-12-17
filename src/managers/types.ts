export interface Link {
    id: number;
    text: string;
    href: string;
    isSearchResult?: boolean;
    isVideoLink?: boolean;
    isWikiLink?: boolean;
    context: {
        surrounding: string;
        isInHeading: boolean;
        isInNav: boolean;
        isInMain: boolean;
        position: {
            top: number;
            isVisible: boolean;
            width?: number;
            height?: number;
            centerScore?: number;
            areaScore?: number;
            urlScore?: number;
        };
    };
    score: number;
}