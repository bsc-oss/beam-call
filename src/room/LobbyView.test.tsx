/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@vector-im/compound-web";
import { type MatrixClient } from "matrix-js-sdk";
import { axe } from "vitest-axe";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { LobbyView } from "./LobbyView";
import { E2eeType } from "../e2ee/e2eeType";
// PG_CHANGED: flushPromises, testScope
import {
  flushPromises,
  mockMediaDevices,
  mockMuteStates,
  testScope,
} from "../utils/test";
// PG_CHANGED: userEvent, ObservableScope, MuteStates, constant, DeviceLabel, MediaDevices
import userEvent from "@testing-library/user-event";
import { type ObservableScope } from "../state/ObservableScope";
import { MuteStates } from "../state/MuteStates";
import { constant } from "../state/Behavior";
import { type DeviceLabel, type MediaDevices } from "../state/MediaDevices";
import { PGMediaRefusals } from "../state/PGMediaAccess";
import { MediaDevicesContext } from "../MediaDevicesContext";
import { type ProcessorState } from "../livekit/TrackProcessorContext";
import { type EncryptionSystem } from "../e2ee/sharedKeyManagement";
import lobbyStyles from "./LobbyView.module.css";
import headerStyles from "../Header.module.css";
import { AppBar } from "../AppBar";

// PG_CHANGED: record the options the preview is asked for, and refuse the
// microphone (by default) and the camera (when `refusesCamera` is set) like a
// browser with the device blocked would. A request that succeeds yields a
// microphone track when it asked for one (a camera track would need a real
// video element).
// Like the real hook, a request is only (re)made when the options change,
// and the tracks of the last successful request are kept until the next one.
// A refused request fails twice, the second time later: like the real hook, a
// request abandoned on remount (React's StrictMode) still reports its failure,
// after the first failure's mutes have been rendered.
const previewRequests = vi.hoisted(
  () => [] as { audio: unknown; video: unknown }[],
);
const lastPreviewOptions = vi.hoisted(() => ({ key: "" }));
const previewTracks = vi.hoisted(() => ({ value: [] as unknown[] }));
const refusesMicrophone = vi.hoisted(() => ({ value: true }));
const refusesCamera = vi.hoisted(() => ({ value: false }));
const resetPreviewMock = vi.hoisted(() => (): void => {
  previewRequests.length = 0;
  lastPreviewOptions.key = "";
  previewTracks.value = [];
  refusesMicrophone.value = true;
  refusesCamera.value = false;
});
vi.mock("@livekit/components-react", () => ({
  usePreviewTracks: (
    options: { audio: unknown; video: unknown },
    onError: (e: Error) => void,
  ): unknown[] => {
    const key = JSON.stringify(options);
    if (key !== lastPreviewOptions.key) {
      lastPreviewOptions.key = key;
      // like the real hook, nothing is requested when no device is asked for
      if (!options.audio && !options.video) return previewTracks.value;
      previewRequests.push(options);
      const isRefused =
        (options.audio && refusesMicrophone.value) ||
        (options.video && refusesCamera.value);
      if (isRefused) {
        const refuse = (): void =>
          onError(new DOMException("Permission denied", "NotAllowedError"));
        queueMicrotask(refuse);
        setTimeout(refuse, 0);
      } else {
        previewTracks.value = options.audio ? [{ kind: "audio" }] : [];
      }
    }
    return previewTracks.value;
  },
}));

vi.mock("../livekit/TrackProcessorContext", () => ({
  useTrackProcessor: (): ProcessorState => ({
    supported: false,
    processor: undefined,
  }),
  useTrackProcessorSync: (): void => {},
}));

vi.mock("react-use-measure", () => ({
  default: (): [() => void, object] => [(): void => {}, {}],
}));

vi.mock("../settings/SettingsModal", () => ({
  SettingsModal: (): null => null,
  defaultSettingsTab: "general",
}));

const mockClient = {
  getUserId: () => "@user:example.org",
  getDeviceId: () => "DEVICE",
} as Partial<MatrixClient> as MatrixClient;

const platformMock = vi.hoisted(() => vi.fn(() => "desktop"));
vi.mock("../Platform", () => ({
  get platform(): string {
    return platformMock();
  },
}));

const matrixInfo = {
  userId: "@user:example.org",
  displayName: "Test User",
  avatarUrl: "",
  roomId: "!room:example.org",
  roomName: "Test Room",
  roomAlias: null,
  roomAvatar: null,
  e2eeSystem: { kind: E2eeType.NONE } satisfies EncryptionSystem,
};

function renderLobbyView(
  props: Partial<Parameters<typeof LobbyView>[0]> = {},
  withAppBar = false,
  platform = "android",
  mediaDevices = mockMediaDevices({}), // PG_CHANGED
): ReturnType<typeof render> {
  platformMock.mockReturnValue(platform);
  const muteStates = mockMuteStates();
  const hideHeader = withAppBar ? true : false;
  const lobbyView = (
    <LobbyView
      client={mockClient}
      matrixInfo={matrixInfo}
      muteStates={muteStates}
      onEnter={() => {}}
      confineToRoom={false}
      hideHeader={hideHeader}
      participantCount={3}
      onShareClick={null}
      {...props}
    />
  );
  return render(
    <BrowserRouter>
      <MediaDevicesContext value={mediaDevices}>
        <TooltipProvider>
          {withAppBar && <AppBar>{lobbyView}</AppBar>}
          {!withAppBar && lobbyView}
        </TooltipProvider>
      </MediaDevicesContext>
    </BrowserRouter>,
  );
}

describe("LobbyView", () => {
  it("renders with header and participant count", async () => {
    const { container } = renderLobbyView();
    expect(container).toMatchSnapshot();
    expect(
      container.getElementsByClassName(headerStyles.header).length,
    ).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders without header", () => {
    const { container } = renderLobbyView({ hideHeader: true });
    const els = container.getElementsByClassName(headerStyles.header);
    for (const el of els) {
      expect(el).not.toBeVisible();
    }
  });

  it("renders with waiting for invite state", () => {
    const { getByTestId } = renderLobbyView({
      waitingForInvite: true,
    });
    expect(getByTestId("lobby_joinCall")).toHaveClass(lobbyStyles.wait);
  });

  it("renders with AppBar android", async () => {
    const { container, getByRole } = renderLobbyView(
      {
        waitingForInvite: true,
      },
      true,
      "android",
    );
    getByRole("banner");
    // Check that the primary button uses ArrowLeftIcon (the back/return icon),
    // not the default CollapseIcon
    const { container: iconContainer } = render(<ArrowLeftIcon />);
    const expectedSvgPath = iconContainer
      .querySelector("path")!
      .getAttribute("d");
    const primaryButtonSvgPath = container
      .querySelector("path")
      ?.getAttribute("d");
    expect(primaryButtonSvgPath).toBe(expectedSvgPath);
    expect(container).toMatchSnapshot();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders with AppBar ios", async () => {
    const { container, getByRole } = renderLobbyView(
      {
        waitingForInvite: true,
      },
      true,
      "ios",
    );
    getByRole("banner");
    // Check that the primary button uses ArrowLeftIcon (the back/return icon),
    // not the default CollapseIcon
    const { container: iconContainer } = render(<ChevronLeftIcon />);
    const expectedSvgPath = iconContainer
      .querySelector("path")!
      .getAttribute("d");
    const primaryButtonSvgPath = container
      .querySelector("path")
      ?.getAttribute("d");
    expect(primaryButtonSvgPath).toBe(expectedSvgPath);
    expect(container).toMatchSnapshot();
    expect(await axe(container)).toHaveNoViolations();
  });

  // PG_CHANGED
  function aMicrophoneSetup(
    devices: Partial<MediaDevices>,
    scope: ObservableScope,
    initialMuteState = { audioEnabled: true, videoEnabled: false },
  ): { mediaDevices: MediaDevices; muteStates: MuteStates } {
    const mediaDevices = mockMediaDevices({
      audioInput: {
        available$: constant(
          new Map<string, DeviceLabel>([
            ["mic", { type: "name", name: "Mic" }],
          ]),
        ),
        selected$: constant({ id: "mic" }),
        select(): void {},
      } as unknown as MediaDevices["audioInput"],
      pgMediaRefusals: new PGMediaRefusals(),
      ...devices,
    });
    const muteStates = new MuteStates(scope, mediaDevices, initialMuteState);
    return { mediaDevices, muteStates };
  }

  // PG_CHANGED: like MediaDevices, report the refusal and fail
  function refuseMicrophone(
    mediaDevices: () => MediaDevices,
  ): () => Promise<never> {
    return async () => {
      const e = new DOMException("Permission denied", "NotAllowedError");
      mediaDevices().pgMediaRefusals.reportIfRefused(e, ["microphone"]);
      return Promise.reject(e);
    };
  }

  // PG_CHANGED
  it("on the web, mutes when the preview is refused, and asks again on unmute", async () => {
    const user = userEvent.setup();
    resetPreviewMock();
    const scope = testScope();
    const pgRequestMicrophoneAccess = vi.fn(
      refuseMicrophone(() => mediaDevices),
    );
    const { mediaDevices, muteStates } = aMicrophoneSetup(
      { pgRequestMicrophoneAccess },
      scope,
    );
    const { getByTestId } = renderLobbyView(
      { muteStates },
      false,
      "desktop",
      mediaDevices,
    );

    // As upstream, the preview asks for audio (a single browser prompt with
    // the camera); refused, the microphone gets muted
    await flushPromises();
    expect(previewRequests.filter((r) => r.audio)).toHaveLength(1);
    expect(muteStates.audio.enabled$.value).toBe(false);

    // Unmuting asks again, and the refusal mutes it again
    await user.click(getByTestId("incall_mute"));
    await flushPromises();
    expect(pgRequestMicrophoneAccess).toHaveBeenCalledTimes(1);
    expect(muteStates.audio.enabled$.value).toBe(false);
    // without restarting the preview
    expect(previewRequests).toHaveLength(1);
  });

  // PG_CHANGED
  it("on mobile, mutes when the early microphone track is refused, and asks again on unmute", async () => {
    const user = userEvent.setup();
    resetPreviewMock();
    const scope = testScope();
    const getLocalMicrophoneTrack = vi.fn(refuseMicrophone(() => mediaDevices));
    const pgRequestMicrophoneAccess = vi.fn(
      refuseMicrophone(() => mediaDevices),
    );
    const { mediaDevices, muteStates } = aMicrophoneSetup(
      { getLocalMicrophoneTrack, pgRequestMicrophoneAccess },
      scope,
    );
    const { getByTestId } = renderLobbyView(
      { muteStates },
      false,
      "android",
      mediaDevices,
    );

    // The preview leaves the microphone to the early track, whose refusal
    // mutes the microphone
    await flushPromises();
    expect(previewRequests.filter((r) => r.audio)).toHaveLength(0);
    expect(getLocalMicrophoneTrack).toHaveBeenCalledWith();
    expect(muteStates.audio.enabled$.value).toBe(false);

    // Unmuting asks again, and the refusal mutes it again
    await user.click(getByTestId("incall_mute"));
    await flushPromises();
    expect(pgRequestMicrophoneAccess).toHaveBeenCalledTimes(1);
    expect(getLocalMicrophoneTrack).toHaveBeenCalledTimes(1);
    expect(muteStates.audio.enabled$.value).toBe(false);
  });

  // PG_CHANGED
  it("on mobile, a refused camera preview leaves the microphone on", async () => {
    resetPreviewMock();
    refusesCamera.value = true;
    try {
      const scope = testScope();
      const { mediaDevices, muteStates } = aMicrophoneSetup(
        {
          videoInput: {
            available$: constant(
              new Map<string, DeviceLabel>([
                ["cam", { type: "name", name: "Cam" }],
              ]),
            ),
            selected$: constant({ id: "cam" }),
            select(): void {},
          } as unknown as MediaDevices["videoInput"],
        },
        scope,
        { audioEnabled: true, videoEnabled: true },
      );
      renderLobbyView({ muteStates }, false, "android", mediaDevices);

      // The preview asks for the camera only; its refusal mutes the camera,
      // not the microphone, which the early track provides
      await flushPromises();
      const cameraRequests = previewRequests.filter((r) => r.video);
      expect(cameraRequests.length).toBeGreaterThan(0);
      expect(cameraRequests.every((r) => !r.audio)).toBe(true);
      expect(muteStates.video.enabled$.value).toBe(false);
      expect(muteStates.audio.enabled$.value).toBe(true);
    } finally {
      refusesCamera.value = false;
    }
  });

  // PG_CHANGED
  it("on the web, a refused camera leaves the microphone on when its preview worked", async () => {
    const user = userEvent.setup();
    resetPreviewMock();
    refusesMicrophone.value = false;
    refusesCamera.value = true;
    const scope = testScope();
    const { mediaDevices, muteStates } = aMicrophoneSetup(
      {
        videoInput: {
          available$: constant(
            new Map<string, DeviceLabel>([
              ["cam", { type: "name", name: "Cam" }],
            ]),
          ),
          selected$: constant({ id: "cam" }),
          select(): void {},
        } as unknown as MediaDevices["videoInput"],
      },
      scope,
    );
    const refusedRequests: string[][] = [];
    mediaDevices.pgMediaRefusals.refusedRequests$.subscribe((kinds) =>
      refusedRequests.push(kinds),
    );
    const { getByTestId } = renderLobbyView(
      { muteStates },
      false,
      "desktop",
      mediaDevices,
    );

    // The microphone preview works
    await flushPromises();
    expect(previewRequests).toHaveLength(1);
    expect(muteStates.audio.enabled$.value).toBe(true);

    // Turning on the camera asks for both; the refusal is the camera's: the
    // microphone stays on, and is not named as blocked. Nor is it when the
    // stale request fails once more, after the camera was muted
    await user.click(getByTestId("incall_videomute"));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    expect(previewRequests[1]).toMatchObject({ video: expect.anything() });
    expect(muteStates.video.enabled$.value).toBe(false);
    expect(muteStates.audio.enabled$.value).toBe(true);
    expect(refusedRequests).toEqual([["camera"], ["camera"]]);
  });

  // PG_CHANGED
  it("on the web, once the microphone was refused, turning on the camera asks for the camera only", async () => {
    const user = userEvent.setup();
    resetPreviewMock();
    refusesCamera.value = true;
    const scope = testScope();
    const { mediaDevices, muteStates } = aMicrophoneSetup(
      {
        videoInput: {
          available$: constant(
            new Map<string, DeviceLabel>([
              ["cam", { type: "name", name: "Cam" }],
            ]),
          ),
          selected$: constant({ id: "cam" }),
          select(): void {},
        } as unknown as MediaDevices["videoInput"],
      },
      scope,
    );
    const refusedRequests: string[][] = [];
    mediaDevices.pgMediaRefusals.refusedRequests$.subscribe((kinds) =>
      refusedRequests.push(kinds),
    );
    const { getByTestId } = renderLobbyView(
      { muteStates },
      false,
      "desktop",
      mediaDevices,
    );

    // The microphone is refused and muted
    await flushPromises();
    expect(muteStates.audio.enabled$.value).toBe(false);
    expect(refusedRequests).toContainEqual(["microphone"]);
    refusedRequests.length = 0;

    // Turning on the camera no longer asks for the microphone, so only the
    // camera is named as blocked
    await user.click(getByTestId("incall_videomute"));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    const cameraRequests = previewRequests.filter((r) => r.video);
    expect(cameraRequests.length).toBeGreaterThan(0);
    expect(cameraRequests.every((r) => !r.audio)).toBe(true);
    expect(muteStates.video.enabled$.value).toBe(false);
    expect(
      refusedRequests.every((kinds) => !kinds.includes("microphone")),
    ).toBe(true);
    expect(refusedRequests).toContainEqual(["camera"]);
  });
});
