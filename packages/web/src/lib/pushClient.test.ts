import { describe, it, expect, afterEach, vi } from "vitest";
import { isPushSupported, urlBase64ToUint8Array } from "./pushClient.js";

describe("urlBase64ToUint8Array", () => {
  it("decodes plain base64", () => {
    expect([...urlBase64ToUint8Array("AQID")]).toEqual([1, 2, 3]);
  });

  it("decodes base64url alphabet (- and _) and missing padding", () => {
    // "-w" is base64url for the single byte 0xFB; standard base64 would be "+w==".
    expect([...urlBase64ToUint8Array("-w")]).toEqual([251]);
    expect([...urlBase64ToUint8Array("_w")]).toEqual([255]);
  });

  it("round-trips a VAPID-shaped key length (65 bytes uncompressed point)", () => {
    const bytes = new Uint8Array(65);
    bytes[0] = 4;
    for (let i = 1; i < 65; i++) bytes[i] = i;
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const b64url = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect([...urlBase64ToUint8Array(b64url)]).toEqual([...bytes]);
  });
});

describe("isPushSupported", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is false in an environment without PushManager/Notification/serviceWorker", () => {
    // happy-dom provides none of PushManager/Notification and no SW container.
    expect(isPushSupported()).toBe(false);
  });

  it("is true only when serviceWorker + PushManager + Notification all exist", () => {
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", { permission: "default" });
    // navigator exists in happy-dom but has no serviceWorker — still false.
    expect(isPushSupported()).toBe(false);

    Object.defineProperty(window.navigator, "serviceWorker", {
      value: {},
      configurable: true,
    });
    expect(isPushSupported()).toBe(true);
  });
});
