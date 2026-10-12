declare const NUDGE_PRECACHE: string[];
declare const NUDGE_BUILD: string;

interface RouterRule {
  condition: { urlPattern: URLPatternInput; requestMode?: RequestMode };
  source: { cacheName: string };
}

interface ExtendableEvent {
  /** Chromium's static routing, offered only on the install event. */
  addRoutes?(rules: RouterRule[]): Promise<void>;
}
