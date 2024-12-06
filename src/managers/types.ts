// types.ts
export interface Link {
    id: number;
    text: string;
    href: string;
    context: {
        surrounding: string;
        isInHeading: boolean;
        isInNav: boolean;
        isInMain: boolean;
        position: {
            top: number;
            isVisible: boolean;
        };
    };
    score: number;
}