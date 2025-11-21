export interface Link {
    id: number;
    text: string;
    href: string;
    context: {
        surrounding: string;
        isInHeading: boolean;
        isInNav: boolean;
        isInMain: boolean;
        isSearchResult: boolean;  // Move here
        isVideoLink: boolean;     // Move here
        isWikiLink: boolean;      // Move here
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