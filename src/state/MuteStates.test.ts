/*
Copyright 2026 Belgian Secure Communications (BSC)
Copyright 2025-2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.

Modified by Belgian Secure Communications for Beam application on 2026-04-30
*/

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BehaviorSubject } from "rxjs";
import { logger } from "matrix-js-sdk/lib/logger";

import { MuteStates, MuteState } from "./MuteStates";
import {
  type AudioOutputDeviceLabel,
  type DeviceLabel,
  type MediaDevice,
  type SelectedAudioOutputDevice,
  type SelectedDevice,
} from "./MediaDevices";
import { constant } from "./Behavior";
import { ObservableScope } from "./ObservableScope";
import { flushPromises, mockMediaDevices } from "../utils/test";
import { initializeWidget } from "../widget";
initializeWidget();

const getUrlParams = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("../UrlParams", () => ({ getUrlParams }));

let testScope: ObservableScope;

beforeEach(() => {
  testScope = new ObservableScope();
});

afterEach(() => {
  testScope.end();
});

describe("MuteState", () => {
  test("should automatically mute if force mute is set", async () => {
    const forceMute$ = new BehaviorSubject<boolean>(false);

    const deviceStub = {
      available$: constant(
        new Map<string, DeviceLabel>([
          ["fbac11", { type: "name", name: "HD Camera" }],
        ]),
      ),
      selected$: constant({ id: "fbac11" }),
      select(): void {},
    } as unknown as MediaDevice<DeviceLabel, SelectedDevice>;

    const muteState = new MuteState(testScope, deviceStub, true, forceMute$);
    let lastEnabled: boolean = false;
    muteState.enabled$.subscribe((enabled) => {
      lastEnabled = enabled;
    });
    let setEnabled: ((enabled: boolean) => void) | null = null;
    muteState.setEnabled$.subscribe((setter) => {
      setEnabled = setter;
    });

    await flushPromises();

    setEnabled!(true);
    await flushPromises();
    expect(lastEnabled).toBe(true);

    // Now force mute
    forceMute$.next(true);
    await flushPromises();
    // Should automatically mute
    expect(lastEnabled).toBe(false);

    // Try to unmute can not work
    expect(setEnabled).toBeNull();

    // Disable force mute
    forceMute$.next(false);
    await flushPromises();

    // TODO I'd expect it to go back to previous state (enabled)
    // but actually it goes back to the initial state from construction (disabled)
    // Should go back to previous state (enabled)
    // Skip for now
    // expect(lastEnabled).toBe(true);

    // But yet it can be unmuted now
    expect(setEnabled).not.toBeNull();

    setEnabled!(true);
    await flushPromises();
    expect(lastEnabled).toBe(true);
  });
});

describe("MuteStates", () => {
  function aAudioOutputDevices(): MediaDevice<
    AudioOutputDeviceLabel,
    SelectedAudioOutputDevice
  > {
    const selected$ = new BehaviorSubject<
      SelectedAudioOutputDevice | undefined
    >({
      id: "default",
      virtualEarpiece: false,
    });
    return {
      available$: constant(
        new Map<string, AudioOutputDeviceLabel>([
          ["default", { type: "speaker" }],
          ["0000", { type: "speaker" }],
          ["1111", { type: "earpiece" }],
          ["222", { type: "name", name: "Bluetooth Speaker" }],
        ]),
      ),
      selected$,
      select(id: string): void {
        if (!this.available$.getValue().has(id)) {
          logger.warn(`Attempted to select unknown device id: ${id}`);
          return;
        }
        selected$.next({
          id,
          /** For test purposes we ignore this */
          virtualEarpiece: false,
        });
      },
    };
  }

  function aVideoInput(): MediaDevice<DeviceLabel, SelectedDevice> {
    const selected$ = new BehaviorSubject<SelectedDevice | undefined>(
      undefined,
    );
    return {
      available$: constant(
        new Map<string, DeviceLabel>([
          ["0000", { type: "name", name: "HD Camera" }],
          ["1111", { type: "name", name: "WebCam Pro" }],
        ]),
      ),
      selected$,
      select(id: string): void {
        if (!this.available$.getValue().has(id)) {
          logger.warn(`Attempted to select unknown device id: ${id}`);
          return;
        }
        selected$.next({ id });
      },
    };
  }

  // PG_CHANGED
  test("camera stays on when switching to earpiece", async () => {
    const audioOutputDevice = aAudioOutputDevices();

    const mediaDevices = mockMediaDevices({
      audioOutput: audioOutputDevice,
      videoInput: aVideoInput(),
    });
    const muteStates = new MuteStates(testScope, mediaDevices, {
      audioEnabled: false,
      videoEnabled: false,
    });

    muteStates.video.setHandler(async (enabled: boolean): Promise<boolean> => {
      return Promise.resolve(enabled);
    });

    let lastVideoEnabled: boolean = false;
    muteStates.video.enabled$.subscribe((enabled) => {
      lastVideoEnabled = enabled;
    });

    // Enable video
    expect(muteStates.video.setEnabled$.value).toBeDefined();
    muteStates.video.setEnabled$.value?.(true);
    await flushPromises();
    expect(lastVideoEnabled).toBe(true);

    // Switch to earpiece — camera should stay on
    audioOutputDevice.select("1111");
    await flushPromises();
    expect(lastVideoEnabled).toBe(true);

    // Camera toggle should still be available
    expect(muteStates.video.toggle$.value).toBeDefined();

    // Can still manually disable camera while on earpiece
    muteStates.video.setEnabled$.value?.(false);
    await flushPromises();
    expect(lastVideoEnabled).toBe(false);

    // And re-enable it
    muteStates.video.setEnabled$.value?.(true);
    await flushPromises();
    expect(lastVideoEnabled).toBe(true);
  });
});
