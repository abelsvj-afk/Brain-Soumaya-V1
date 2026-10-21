import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock the push client layer — the component's contract is: render ONLY
// when supported + server-enabled, and reflect permission/subscription
// state honestly.
const lib = vi.hoisted(() => ({
  isPushSupported: vi.fn((): boolean => true),
  fetchPushConfig: vi.fn(
    async (): Promise<{ enabled: boolean; vapidPublicKey: string | null } | null> => ({
      enabled: true,
      vapidPublicKey: "BKey",
    }),
  ),
  getExistingSubscription: vi.fn(async (): Promise<PushSubscription | null> => null),
  notificationPermission: vi.fn((): string => "default"),
  subscribePush: vi.fn(
    async (): Promise<PushSubscription | null> =>
      ({ endpoint: "https://push.example.com/x" }) as unknown as PushSubscription,
  ),
  unsubscribePush: vi.fn(async (): Promise<boolean> => true),
}));
vi.mock("../lib/pushClient.js", () => lib);

import { PushToggle } from "./PushToggle.js";

beforeEach(() => {
  vi.clearAllMocks();
  lib.isPushSupported.mockReturnValue(true);
  lib.fetchPushConfig.mockResolvedValue({ enabled: true, vapidPublicKey: "BKey" });
  lib.getExistingSubscription.mockResolvedValue(null);
  lib.notificationPermission.mockReturnValue("default");
  lib.subscribePush.mockResolvedValue({ endpoint: "https://push.example.com/x" } as unknown as PushSubscription);
  lib.unsubscribePush.mockResolvedValue(true);
  vi.stubGlobal("Notification", {
    permission: "default",
    requestPermission: vi.fn(async () => "granted" as NotificationPermission),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PushToggle — invisible unless supported AND server-enabled", () => {
  it("renders nothing when the browser doesn't support push", async () => {
    lib.isPushSupported.mockReturnValue(false);
    const { container } = render(<PushToggle />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(lib.fetchPushConfig).not.toHaveBeenCalled();
  });

  it("renders nothing when the server reports push disabled (VAPID unconfigured)", async () => {
    lib.fetchPushConfig.mockResolvedValue({ enabled: false, vapidPublicKey: null });
    const { container } = render(<PushToggle />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(screen.queryByLabelText("Push notifications")).toBeNull();
  });

  it("renders nothing when the config fetch fails", async () => {
    lib.fetchPushConfig.mockResolvedValue(null);
    const { container } = render(<PushToggle />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});

describe("PushToggle — states when visible", () => {
  it("shows an OFF toggle when enabled and not subscribed; clicking subscribes", async () => {
    render(<PushToggle />);
    const btn = await screen.findByLabelText("Push notifications");
    expect(btn.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(btn);
    await waitFor(() => expect(lib.subscribePush).toHaveBeenCalledWith("BKey"));
    await waitFor(() => expect(btn.getAttribute("aria-pressed")).toBe("true"));
  });

  it("shows ON when a subscription already exists; clicking unsubscribes", async () => {
    lib.getExistingSubscription.mockResolvedValue({ endpoint: "https://push.example.com/x" } as PushSubscription);
    render(<PushToggle />);
    const btn = await screen.findByLabelText("Push notifications");
    expect(btn.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(btn);
    await waitFor(() => expect(lib.unsubscribePush).toHaveBeenCalled());
    await waitFor(() => expect(btn.getAttribute("aria-pressed")).toBe("false"));
  });

  it("renders the permission-denied state honestly with a disabled toggle", async () => {
    lib.notificationPermission.mockReturnValue("denied");
    render(<PushToggle />);
    const btn = await screen.findByLabelText("Push notifications");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Blocked in your browser settings/)).toBeTruthy();
  });
});
