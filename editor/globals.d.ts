// What the editor's classic scripts share at runtime but the type checker can't see (`npm run`-free: `tsc -p editor`):
// functions deck/shapes.js and the data files put on window, and libraries loaded from a CDN.
declare var polygonClipping: { union(...g: any[]): any[]; intersection(...g: any[]): any[]; difference(...g: any[]): any[]; xor(...g: any[]): any[] };
declare var attachConnectors: (root: ParentNode) => void, renderShape: (box: Element) => void, shadeBox: (box: Element) => void, cropBox: (box: Element) => void, adjustImage: (box: HTMLElement) => void, gradBox: (box: HTMLElement) => void, fitTabs: (box: Element) => void, numberSlides: (list: HTMLElement[], deck?: string) => void, bgCss: (s: HTMLElement) => Partial<CSSStyleDeclaration>, ADJUST: string[], fitText: (box: Element) => void, rideLineEnds: (box: HTMLElement, ms: number) => void, applyLayouts: (secs?: HTMLElement[], tpl?: HTMLTemplateElement | null) => void;
declare var renderChart: (box: Element) => void, chartData: (box: Element) => { cats: string[], series: { name: string, vals: (number | null)[] }[] }, CHART_COLORS: string[][];
declare var shapeAdjust: (...args: any[]) => any, renderMath: (root?: any) => void, unrenderMath: (root?: any) => void, highlightCode: (root?: any) => void;
declare var LATEX_SYMBOLS: Record<string, string>, CHAR_CATEGORIES: any[];
declare var Reveal: any, RevealNotes: any, EyeDropper: any;
interface Window {
  attachConnectors?: typeof attachConnectors; renderShape?: typeof renderShape; highlightCode?: typeof highlightCode; renderMath?: typeof renderMath; unrenderMath?: typeof unrenderMath;
  Reveal?: any; RevealHighlight?: any; renderMathInElement?: any; THEMES?: any[];
  GLIDESHOW_CLOUD?: { user: string; name: string; repo: string } | number;   // set by glideshow.org (cloud/worker.js)
  GLIDESHOW?: any;   // a shared deck's comments panel (cloud/share.js, editor/share/share.js)
}

// The editor works with HTML elements throughout: querySelector's Element (and an event's target) are treated as one.
interface Element { style: CSSStyleDeclaration; dataset: DOMStringMap; title: string; innerText: string; offsetWidth: number; isContentEditable: boolean;
  value: any; src: string; href: string; content: string; onclick: any; onchange: any; onpointerenter: any; click(): void; blur(): void; }
interface EventTarget { closest?(selectors: string): Element | null; tagName?: string; }
interface Node { closest?(selectors: string): Element | null; }
interface Document { caretPositionFromPoint?(x: number, y: number): any; matches?(selectors: string): boolean; }
interface Event { clipboardData?: any; }
declare var glideMerge: { mergeSlides(base: string[], mine: string[], theirs: string[]): { html: string[], both: number[] }, mergeDecks(base: string, mine: string, theirs: string): { html: string, both: number[] } | null, [k: string]: any };
