// Minimal ambient declarations for `@novnc/novnc` which ships without bundled
// .d.ts files. We only consume the RFB class from its default export; everything
// else is opaque event payloads. Add fields here as we use them.
declare module '@novnc/novnc' {
  interface RFBOptions {
    credentials?: { password?: string; username?: string };
    shared?: boolean;
    repeaterID?: string;
    wsProtocols?: string[];
    reconnect?: boolean;
    scaleViewport?: boolean;
    resizeSession?: boolean;
    viewOnly?: boolean;
    background?: string;
    qualityLevel?: number;
    compressionLevel?: number;
    showDotcursor?: boolean;
  }

  // noVNC's EventTarget emits CustomEvent<{ clean?: boolean; reason?: string;
  // code?: number; status?: number }> on disconnect/securityfailure. We don't
  // need to model every event here — we cast through unknown at use sites.
  class RFB {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket | { readable: true; writable: true }, options?: RFBOptions);
    viewOnly: boolean;
    scaleViewport: boolean;
    clipViewport: boolean;
    resizeSession: boolean;
    background: string;
    showDotcursor: boolean;
    disconnect(): void;
    // Internal but stable across noVNC 1.x. We reach into it to send our own
    // application-level keepalive frames without colliding with the RFB stream.
    _sock: { _websocket: WebSocket | null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addEventListener(type: string, listener: (evt: any) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeEventListener(type: string, listener: (evt: any) => void): void;
  }

  export default RFB;
}
