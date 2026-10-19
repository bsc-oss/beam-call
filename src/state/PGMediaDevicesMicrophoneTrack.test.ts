/*
Copyright 2026 Belgian Secure Communications (BSC)

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type * as LivekitClient from "livekit-client";
import { type LocalAudioTrack } from "livekit-client";
import * as ComponentsCore from "@livekit/components-core";
import { of } from "rxjs";

import { MediaDevices } from "./MediaDevices";
import { ObservableScope } from "./ObservableScope";
import { flushPromises } from "../utils/test";
import { constant } from "./Behavior";
import { noiseSuppressionSetting } from "../settings/settings";

vi.mock("@livekit/components-core");

const createLocalAudioTrack = vi.hoisted(() => vi.fn());
vi.mock("livekit-client", async (importOriginal) => ({
  ...(await importOriginal<typeof LivekitClient>()),
  createLocalAudioTrack,
}));

const platformMock = vi.hoisted(() => vi.fn(() => "android"));
vi.mock("../Platform", () => ({
  get platform(): string {
    return platformMock();
  },
}));

const permissionState = vi.hoisted(() =>
  vi.fn(
    async (): Promise<PermissionState | "unknown"> => Promise.resolve("prompt"),
  ),
);
vi.mock("./PGMediaPermission", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  pgQueryMediaPermissionState: permissionState,
}));

function aTrack(readyState: MediaStreamTrackState = "live"): LocalAudioTrack {
  return {
    mediaStreamTrack: { readyState },
    stop: vi.fn(),
    restartTrack: vi.fn(async () => Promise.resolve()),
  } as unknown as LocalAudioTrack;
}

const refusedError = (): DOMException =>
  new DOMException("Permission denied", "NotAllowedError");

describe("MediaDevices.getLocalMicrophoneTrack", () => {
  let scope: ObservableScope;
  let devices: MediaDevices;

  beforeEach(() => {
    platformMock.mockReturnValue("android");
    permissionState.mockReset().mockResolvedValue("prompt");
    createLocalAudioTrack.mockReset();
    vi.mocked(ComponentsCore.createMediaDeviceObserver).mockReturnValue(of([]));
    scope = new ObservableScope();
    devices = new MediaDevices(scope);
  });

  afterEach(() => {
    scope.end();
  });

  test("shares one creation between concurrent callers", async () => {
    const track = aTrack();
    createLocalAudioTrack.mockResolvedValue(track);

    const [firstCallerTrack, secondCallerTrack] = await Promise.all([
      devices.getLocalMicrophoneTrack(),
      devices.getLocalMicrophoneTrack(),
    ]);

    expect(createLocalAudioTrack).toHaveBeenCalledTimes(1);
    expect(firstCallerTrack).toBe(track);
    expect(secondCallerTrack).toBe(track);
  });

  test("does not ask again after the permission was refused", async () => {
    const refused = refusedError();
    createLocalAudioTrack.mockRejectedValue(refused);

    await expect(devices.getLocalMicrophoneTrack()).rejects.toBe(refused);
    await flushPromises();
    await expect(devices.getLocalMicrophoneTrack()).rejects.toBe(refused);

    expect(createLocalAudioTrack).toHaveBeenCalledTimes(1);
  });

  test("asks again after a refusal only when explicitly requested", async () => {
    const track = aTrack();
    createLocalAudioTrack
      .mockRejectedValueOnce(refusedError())
      .mockResolvedValueOnce(track);

    await expect(devices.getLocalMicrophoneTrack()).rejects.toThrow();
    await flushPromises();
    await expect(
      devices.getLocalMicrophoneTrack({ retryIfRefused: true }),
    ).resolves.toBe(track);
    // and the granted track is now shared with everyone
    await expect(devices.getLocalMicrophoneTrack()).resolves.toBe(track);

    expect(createLocalAudioTrack).toHaveBeenCalledTimes(2);
  });

  test("retries after another failure", async () => {
    const track = aTrack();
    createLocalAudioTrack
      .mockRejectedValueOnce(
        new DOMException("Device busy", "NotReadableError"),
      )
      .mockResolvedValueOnce(track);

    await expect(devices.getLocalMicrophoneTrack()).rejects.toThrow(
      "Device busy",
    );
    await flushPromises();
    await expect(devices.getLocalMicrophoneTrack()).resolves.toBe(track);

    expect(createLocalAudioTrack).toHaveBeenCalledTimes(2);
  });

  test("recreates a track that has been stopped since", async () => {
    const stoppedTrack = aTrack();
    const replacementTrack = aTrack();
    createLocalAudioTrack
      .mockResolvedValueOnce(stoppedTrack)
      .mockResolvedValueOnce(replacementTrack);

    await expect(devices.getLocalMicrophoneTrack()).resolves.toBe(stoppedTrack);
    // stopped meanwhile (e.g. unpublished at the end of a call)
    (stoppedTrack.mediaStreamTrack as { readyState: string }).readyState =
      "ended";
    await expect(devices.getLocalMicrophoneTrack()).resolves.toBe(
      replacementTrack,
    );

    expect(createLocalAudioTrack).toHaveBeenCalledTimes(2);
  });

  test("recreates a stopped track only once for concurrent callers", async () => {
    const stoppedTrack = aTrack();
    const replacementTrack = aTrack();
    createLocalAudioTrack
      .mockResolvedValueOnce(stoppedTrack)
      .mockResolvedValueOnce(replacementTrack)
      .mockResolvedValue(aTrack());

    await devices.getLocalMicrophoneTrack();
    (stoppedTrack.mediaStreamTrack as { readyState: string }).readyState =
      "ended";
    const [firstCallerTrack, secondCallerTrack] = await Promise.all([
      devices.getLocalMicrophoneTrack(),
      devices.getLocalMicrophoneTrack(),
    ]);

    expect(createLocalAudioTrack).toHaveBeenCalledTimes(2);
    expect(firstCallerTrack).toBe(replacementTrack);
    expect(secondCallerTrack).toBe(replacementTrack);
  });

  test("captures with the user's audio settings, like the LiveKit room", async () => {
    createLocalAudioTrack.mockResolvedValue(aTrack());
    await devices.getLocalMicrophoneTrack();
    expect(createLocalAudioTrack).toHaveBeenCalledWith({
      deviceId: undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  test("reports a refusal to every caller, without asking again", async () => {
    createLocalAudioTrack.mockRejectedValue(refusedError());
    const onRefusedRequest = vi.fn();
    devices.pgMediaRefusals.refusedRequests$.subscribe(onRefusedRequest);

    await expect(devices.getLocalMicrophoneTrack()).rejects.toThrow();
    await expect(devices.getLocalMicrophoneTrack()).rejects.toThrow();

    expect(createLocalAudioTrack).toHaveBeenCalledTimes(1);
    expect(onRefusedRequest.mock.calls).toEqual([
      [["microphone"]],
      [["microphone"]],
    ]);
  });

  test("does not report other failures", async () => {
    createLocalAudioTrack.mockRejectedValue(
      new DOMException("Device busy", "NotReadableError"),
    );
    const onRefusedRequest = vi.fn();
    devices.pgMediaRefusals.refusedRequests$.subscribe(onRefusedRequest);
    await expect(devices.getLocalMicrophoneTrack()).rejects.toThrow();
    expect(onRefusedRequest).not.toHaveBeenCalled();
  });

  describe("pgRequestMicrophoneAccess", () => {
    test("on mobile, asks again for the early track and keeps it", async () => {
      const track = aTrack();
      createLocalAudioTrack
        .mockRejectedValueOnce(refusedError())
        .mockResolvedValueOnce(track);
      await expect(devices.getLocalMicrophoneTrack()).rejects.toThrow();

      await devices.pgRequestMicrophoneAccess();

      expect(createLocalAudioTrack).toHaveBeenCalledTimes(2);
      expect(track.stop).not.toHaveBeenCalled();
      await expect(devices.getLocalMicrophoneTrack()).resolves.toBe(track);
    });

    test("on the web, asks only for the permission, and stops the track", async () => {
      platformMock.mockReturnValue("desktop");
      const track = aTrack();
      createLocalAudioTrack.mockResolvedValue(track);

      await devices.pgRequestMicrophoneAccess();

      expect(createLocalAudioTrack).toHaveBeenCalledTimes(1);
      expect(track.stop).toHaveBeenCalled();
    });

    test("on the web, asks nothing when the permission is granted", async () => {
      platformMock.mockReturnValue("desktop");
      permissionState.mockResolvedValue("granted");

      await devices.pgRequestMicrophoneAccess();

      expect(createLocalAudioTrack).not.toHaveBeenCalled();
    });

    test("reports a refusal", async () => {
      platformMock.mockReturnValue("desktop");
      createLocalAudioTrack.mockRejectedValue(refusedError());
      const onRefusedRequest = vi.fn();
      devices.pgMediaRefusals.refusedRequests$.subscribe(onRefusedRequest);

      await expect(devices.pgRequestMicrophoneAccess()).rejects.toThrow();

      expect(onRefusedRequest).toHaveBeenCalledWith(["microphone"]);
    });
  });

  describe("pgApplyAudioSettingsToMicrophoneTrack", () => {
    const selectAudioInput = (id: string): void => {
      Object.defineProperty(devices.audioInput, "selected$", {
        value: constant({ id }),
      });
    };

    afterEach(() => {
      noiseSuppressionSetting.setValue(true);
    });

    test("keeps the track when nothing changed", async () => {
      const track = aTrack();
      createLocalAudioTrack.mockResolvedValue(track);
      await devices.getLocalMicrophoneTrack();

      await devices.pgApplyAudioSettingsToMicrophoneTrack(track);

      expect(track.restartTrack).not.toHaveBeenCalled();
    });

    test("treats the default device and no device as the same", async () => {
      const track = aTrack();
      createLocalAudioTrack.mockResolvedValue(track);
      await devices.getLocalMicrophoneTrack();
      selectAudioInput("default");

      await devices.pgApplyAudioSettingsToMicrophoneTrack(track);

      expect(track.restartTrack).not.toHaveBeenCalled();
    });

    test("switches to the device selected since the track was created", async () => {
      const track = aTrack();
      createLocalAudioTrack.mockResolvedValue(track);
      await devices.getLocalMicrophoneTrack();
      selectAudioInput("headset");

      await devices.pgApplyAudioSettingsToMicrophoneTrack(track);
      await devices.pgApplyAudioSettingsToMicrophoneTrack(track);

      expect(track.restartTrack).toHaveBeenCalledOnce();
      expect(track.restartTrack).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "headset" }),
      );
    });

    test("applies audio settings changed since the track was created", async () => {
      noiseSuppressionSetting.setValue(true);
      const track = aTrack();
      createLocalAudioTrack.mockResolvedValue(track);
      await devices.getLocalMicrophoneTrack();
      noiseSuppressionSetting.setValue(false);

      await devices.pgApplyAudioSettingsToMicrophoneTrack(track);

      expect(track.restartTrack).toHaveBeenCalledWith(
        expect.objectContaining({ noiseSuppression: false }),
      );
    });

    test("leaves alone a track it did not create", async () => {
      const track = aTrack();
      selectAudioInput("headset");

      await devices.pgApplyAudioSettingsToMicrophoneTrack(track);

      expect(track.restartTrack).not.toHaveBeenCalled();
    });
  });
});
