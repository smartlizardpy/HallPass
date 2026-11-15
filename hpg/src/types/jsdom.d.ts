/**
 * jsdom ships no type declarations and `@types/jsdom` is not a dependency of
 * this repo. This declares exactly the surface the packager and its tests use,
 * so a call outside it is a type error rather than a silent `any`.
 */
declare module "jsdom" {
  export interface JSDOMOptions {
    runScripts?: "dangerously" | "outside-only";
    url?: string;
    contentType?: string;
    virtualConsole?: VirtualConsole;
  }
  /** A console sink; constructed without forwarding, it swallows jsdom's own warnings. */
  export class VirtualConsole {
    constructor();
  }
  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    readonly window: Window & typeof globalThis;
    serialize(): string;
  }
}
