/*
Copyright 2026 Belgian Secure Communications (BSC)

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type LocalTrack, Track } from "livekit-client";

import {
  type PGMediaKind,
  PGMediaRefusals,
  pgMediaKindFromDeviceKind,
  pgMediaKindsCapturedBy,
  pgMediaKindsRequestedBy,
  pgRefusedKindsAmong,
  pgReportRefusedRequestsToIOSApp,
} from "./PGMediaAccess";
import { ObservableScope } from "./ObservableScope";
import { flushPromises } from "../utils/test";

const permissionState = vi.hoisted(() =>
  vi.fn<(kind: string) => Promise<PermissionState | "unknown">>(),
);
vi.mock("./PGMediaPermission", () => ({
  pgQueryMediaPermissionState: permissionState,
}));

const platformMock = vi.hoisted(() => vi.fn(() => "desktop"));
vi.mock("../Platform", () => ({
  get platform(): string {
    return platformMock();
  },
}));

const refusedError = new DOMException("Permission denied", "NotAllowedError");
const busyError = new DOMException("Device busy", "NotReadableError");

describe("PGMediaRefusals", () => {
  test("emits the devices asked for by each refused request", () => {
    const mediaRefusals = new PGMediaRefusals();
    const onRefusedRequest = vi.fn();
    mediaRefusals.refusedRequests$.subscribe(onRefusedRequest);

    mediaRefusals.reportIfRefused(refusedError, ["microphone"]);
    mediaRefusals.reportIfRefused(refusedError, ["microphone", "camera"]);

    expect(onRefusedRequest.mock.calls).toEqual([
      [["microphone"]],
      [["microphone", "camera"]],
    ]);
  });

  test("ignores other failures, and refusals concerning no device", () => {
    const mediaRefusals = new PGMediaRefusals();
    const onRefusedRequest = vi.fn();
    mediaRefusals.refusedRequests$.subscribe(onRefusedRequest);

    mediaRefusals.reportIfRefused(busyError, ["microphone", "camera"]);
    mediaRefusals.reportIfRefused(refusedError, []);

    expect(onRefusedRequest).not.toHaveBeenCalled();
  });
});

describe("PGMediaRefusals.deniedPermissions$", () => {
  async function deniedPermissionsFor(
    requestedKinds: PGMediaKind[],
  ): Promise<PGMediaKind[][]> {
    const mediaRefusals = new PGMediaRefusals();
    const onDeniedPermissions = vi.fn();
    mediaRefusals.deniedPermissions$.subscribe(onDeniedPermissions);
    mediaRefusals.reportIfRefused(refusedError, requestedKinds);
    await flushPromises();
    return onDeniedPermissions.mock.calls.map(([kinds]) => kinds);
  }

  test("names only the device the browser reports as denied", async () => {
    permissionState.mockImplementation(async (kind) =>
      Promise.resolve(kind === "microphone" ? "denied" : "prompt"),
    );
    await expect(
      deniedPermissionsFor(["microphone", "camera"]),
    ).resolves.toEqual([["microphone"]]);
  });

  test("names all the devices when the browser cannot tell", async () => {
    permissionState.mockResolvedValue("unknown");
    await expect(
      deniedPermissionsFor(["microphone", "camera"]),
    ).resolves.toEqual([["microphone", "camera"]]);
  });

  test("names a single refused device", async () => {
    permissionState.mockResolvedValue("denied");
    await expect(deniedPermissionsFor(["camera"])).resolves.toEqual([
      ["camera"],
    ]);
  });
});

describe("pgReportRefusedRequestsToIOSApp", () => {
  const originalControls = window.controls;
  const onMediaAccessRefused = vi.fn();
  let scope: ObservableScope;

  beforeEach(() => {
    window.controls = { ...originalControls, onMediaAccessRefused };
    scope = new ObservableScope();
  });

  afterEach(() => {
    scope.end();
    window.controls = originalControls;
    onMediaAccessRefused.mockReset();
    platformMock.mockReturnValue("desktop");
  });

  function reportRefusalsToIOSApp(): PGMediaRefusals {
    const mediaRefusals = new PGMediaRefusals();
    pgReportRefusedRequestsToIOSApp(mediaRefusals, scope);
    return mediaRefusals;
  }

  test("tells the iOS app about each refused request", () => {
    platformMock.mockReturnValue("ios");
    const mediaRefusals = reportRefusalsToIOSApp();

    mediaRefusals.reportIfRefused(refusedError, ["microphone"]);
    mediaRefusals.reportIfRefused(busyError, ["camera"]);
    mediaRefusals.reportIfRefused(refusedError, ["microphone", "camera"]);

    expect(onMediaAccessRefused.mock.calls).toEqual([
      [["microphone"]],
      [["microphone", "camera"]],
    ]);
  });

  test.each(["android", "desktop"])("tells nothing on %s", (platformName) => {
    platformMock.mockReturnValue(platformName);
    const mediaRefusals = reportRefusalsToIOSApp();

    mediaRefusals.reportIfRefused(refusedError, ["microphone"]);

    expect(onMediaAccessRefused).not.toHaveBeenCalled();
  });

  test("stops telling once the scope ends", () => {
    platformMock.mockReturnValue("ios");
    const mediaRefusals = reportRefusalsToIOSApp();

    scope.end();
    mediaRefusals.reportIfRefused(refusedError, ["microphone"]);

    expect(onMediaAccessRefused).not.toHaveBeenCalled();
  });
});

describe("pgMediaKindsRequestedBy", () => {
  test("lists the kinds the track options ask for", () => {
    expect(
      pgMediaKindsRequestedBy({ audio: true, video: { deviceId: "cam" } }),
    ).toEqual(["microphone", "camera"]);
    expect(pgMediaKindsRequestedBy({ audio: false, video: undefined })).toEqual(
      [],
    );
  });
});

describe("pgMediaKindsCapturedBy", () => {
  test("lists the kinds of the tracks", () => {
    const microphoneTrack = { kind: Track.Kind.Audio } as LocalTrack;
    const cameraTrack = { kind: Track.Kind.Video } as LocalTrack;
    expect(pgMediaKindsCapturedBy([microphoneTrack, cameraTrack])).toEqual([
      "microphone",
      "camera",
    ]);
    expect(pgMediaKindsCapturedBy([])).toEqual([]);
  });
});

describe("pgRefusedKindsAmong", () => {
  test("blames only the devices that did not work just before", () => {
    expect(
      pgRefusedKindsAmong(["microphone", "camera"], ["microphone"]),
    ).toEqual(["camera"]);
    expect(pgRefusedKindsAmong(["microphone", "camera"], [])).toEqual([
      "microphone",
      "camera",
    ]);
  });

  test("blames all the devices when all of them worked just before", () => {
    expect(
      pgRefusedKindsAmong(["microphone", "camera"], ["microphone", "camera"]),
    ).toEqual(["microphone", "camera"]);
    expect(pgRefusedKindsAmong(["microphone"], ["microphone"])).toEqual([
      "microphone",
    ]);
  });
});

describe("pgMediaKindFromDeviceKind", () => {
  test("maps input device kinds only", () => {
    expect(pgMediaKindFromDeviceKind("audioinput")).toBe("microphone");
    expect(pgMediaKindFromDeviceKind("videoinput")).toBe("camera");
    expect(pgMediaKindFromDeviceKind("audiooutput")).toBeUndefined();
    expect(pgMediaKindFromDeviceKind(undefined)).toBeUndefined();
  });
});
