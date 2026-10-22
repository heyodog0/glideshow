// Just enough of the Workers runtime for `tsc -p cloud` (the real types are @cloudflare/workers-types, an npm package we don't need).
declare module 'cloudflare:workers' { export class DurableObject { ctx: any; env: any; constructor(ctx: any, env: any); } }
declare module 'node:buffer' { export const Buffer: any; }
interface CacheStorage { default: Cache; }
interface SubtleCrypto { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean; }
declare class HTMLRewriter { on(selector: string, handlers: any): HTMLRewriter; onDocument(handlers: any): HTMLRewriter; transform(r: Response): Response; }
declare class WebSocketPair { 0: WebSocket; 1: WebSocket; }
interface ResponseInit { webSocket?: WebSocket }
interface WebSocket { serializeAttachment(value: any): void; deserializeAttachment(): any }   // a Durable Object's hibernating sockets
