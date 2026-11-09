function isLocal(url: string): boolean {
  const resolved = new URL(url, window.location.href);
  if (resolved.protocol === "blob:" || resolved.protocol === "data:") return true;
  return resolved.origin === window.location.origin;
}

function assertLocal(url: string): void {
  if (!isLocal(url)) {
    throw new Error("已阻止外部网络请求");
  }
}

/** Reject any fetch, XHR, beacon, or WebSocket that leaves this origin. */
export function installOfflineGuard(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    assertLocal(url);
    return originalFetch(input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    assertLocal(String(url));
    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  const OriginalWebSocket = window.WebSocket;
  const GuardedWebSocket = function (
    url: string | URL,
    protocols?: string | string[],
  ): WebSocket {
    assertLocal(String(url));
    return new OriginalWebSocket(url, protocols);
  } as unknown as typeof WebSocket;
  GuardedWebSocket.prototype = OriginalWebSocket.prototype;
  Object.setPrototypeOf(GuardedWebSocket, OriginalWebSocket);
  window.WebSocket = GuardedWebSocket;

  if (navigator.sendBeacon) {
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      assertLocal(String(url));
      return originalBeacon(url, data);
    };
  }
}
