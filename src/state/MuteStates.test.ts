/*
Copyright 2026 Belgian Secure Communications (BSC)
Copyright 2025-2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.

Modified by Belgian Secure Communications for Beam application on 2026-04-30
*/

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BehaviorSubject, type Observable } from "rxjs";
import { logger } from "matrix-js-sdk/lib/logger";

import { MuteStates, MuteState } from "./MuteStates";
import {
  type AudioOutputDeviceLabel,
  type DeviceLabel,
  type MediaDevice,
  type MediaDevices, // PG_CHANGED
  type SelectedAudioOutputDevice,
  type SelectedDevice,
} from "./MediaDevices";
import { constant } from "./Behavior";
import { ObservableScope } from "./ObservableScope";
import { flushPromises, mockMediaDevices } from "../utils/test";
import { PGMediaRefusals } from "./PGMediaAccess"; // PG_CHANGED
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

  test("should ignore toggle while syncing but still process set requests", async () => {
    const deviceStub = {
      available$: constant(
        new Map<string, DeviceLabel>([
          ["mic", { type: "name", name: "Microphone" }],
        ]),
      ),
      selected$: constant({ id: "mic" }),
      select(): void {},
    } as unknown as MediaDevice<DeviceLabel, SelectedDevice>;

    const muteState = new MuteState(
      testScope,
      deviceStub,
      false,
      constant(false),
    );

    const first = Promise.withResolvers<boolean>();
    const second = Promise.withResolvers<boolean>();
    const handler = vi
      .fn<(desired: boolean) => Promise<boolean>>()
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    muteState.setHandler(handler);

    const syncingValues: boolean[] = [];
    muteState.syncing$.subscribe((syncing) => {
      syncingValues.push(syncing);
    });

    let setEnabled: ((enabled: boolean) => void) | null = null;
    muteState.setEnabled$.subscribe((setter) => {
      setEnabled = setter;
    });
    let toggle: (() => void) | null = null;
    muteState.toggle$.subscribe((toggleFn) => {
      toggle = toggleFn;
    });

    await flushPromises();

    // Start syncing by requesting unmute.
    toggle!();
    await flushPromises();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenNthCalledWith(1, true);

    // Toggle requests are ignored while syncing.
    toggle!();
    await flushPromises();
    expect(handler).toHaveBeenCalledTimes(1);

    // setEnabled still updates latest desired state while syncing (push-to-talk).
    setEnabled!(false);
    await flushPromises();
    expect(handler).toHaveBeenCalledTimes(1);

    first.resolve(true);
    await flushPromises();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(2, false);

    second.resolve(false);
    await flushPromises();
    expect(syncingValues).toContain(true);
    expect(syncingValues.at(-1)).toBe(false);
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
  const oneMicrophone = (): Map<string, DeviceLabel> =>
    new Map([["mic", { type: "name", name: "Mic" }]]);

  // PG_CHANGED
  function aMicrophone(
    available$: Observable<Map<string, DeviceLabel>> = constant(new Map()),
  ): MediaDevice<DeviceLabel, SelectedDevice> {
    return {
      available$,
      selected$: constant(undefined),
      select(): void {},
    } as unknown as MediaDevice<DeviceLabel, SelectedDevice>;
  }

  // PG_CHANGED
  test("toggle stays available without devices while permission is denied", async () => {
    const noDevices = aMicrophone();
    const permissionDenied$ = new BehaviorSubject<boolean>(true);

    const muteState = new MuteState(
      testScope,
      noDevices,
      true,
      constant(false),
      permissionDenied$,
    );
    const handler = vi.fn(async (enabled: boolean) => Promise.resolve(enabled));
    muteState.setHandler(handler);

    // Permission denied: the user must be able to ask for it again by
    // toggling the device on, even though nothing is enumerated.
    expect(muteState.toggle$.value).not.toBeNull();
    muteState.setEnabled$.value!(false);
    await flushPromises();
    expect(muteState.enabled$.value).toBe(false);
    muteState.toggle$.value!();
    await flushPromises();
    expect(handler).toHaveBeenLastCalledWith(true);
    expect(muteState.enabled$.value).toBe(true);

    // Permission no longer denied but still no device: nothing to control.
    permissionDenied$.next(false);
    await flushPromises();
    expect(muteState.toggle$.value).toBeNull();
    expect(muteState.enabled$.value).toBe(false);
  });

  // PG_CHANGED
  test("a mute requested before any device is available is honoured once devices appear", async () => {
    const available$ = new BehaviorSubject(new Map<string, DeviceLabel>());
    const device = aMicrophone(available$);

    const muteState = new MuteState(testScope, device, true, constant(false));
    await flushPromises();
    expect(muteState.toggle$.value).toBeNull();
    expect(muteState.enabled$.value).toBe(false);

    // e.g. the permission was refused before enumeration finished
    muteState.pgMuteAfterRefusal();

    available$.next(oneMicrophone());
    await flushPromises();
    expect(muteState.toggle$.value).not.toBeNull();
    expect(muteState.enabled$.value).toBe(false);

    // and the user can still unmute afterwards
    muteState.toggle$.value!();
    await flushPromises();
    expect(muteState.enabled$.value).toBe(true);
  });

  // PG_CHANGED
  test("starts the device through the handler when devices appear after the handler was installed", async () => {
    const available$ = new BehaviorSubject(new Map<string, DeviceLabel>());
    const device = aMicrophone(available$);
    const muteState = new MuteState(testScope, device, true, constant(false));
    await flushPromises();
    // The publisher joined meanwhile: it read "off" and requested nothing
    expect(muteState.enabled$.value).toBe(false);
    const handler = vi.fn(async (desired: boolean) => Promise.resolve(desired));
    muteState.setHandler(handler);

    available$.next(oneMicrophone());
    await flushPromises();
    // the device was actually requested, and is on
    expect(handler).toHaveBeenCalledWith(true);
    expect(muteState.enabled$.value).toBe(true);
    expect(muteState.syncing$.value).toBe(false);
  });

  // PG_CHANGED
  test("stays muted when starting the device through the handler is refused", async () => {
    const available$ = new BehaviorSubject(new Map<string, DeviceLabel>());
    const device = aMicrophone(available$);
    const muteState = new MuteState(testScope, device, true, constant(false));
    await flushPromises();
    // like the publisher's handler when getUserMedia is refused
    muteState.setHandler(async () => Promise.resolve(false));

    available$.next(oneMicrophone());
    await flushPromises();
    expect(muteState.enabled$.value).toBe(false);
    expect(muteState.syncing$.value).toBe(false);
    expect(muteState.toggle$.value).not.toBeNull();
  });

  // PG_CHANGED
  test("restores the last state, not the default, when devices come back", async () => {
    const available$ = new BehaviorSubject(oneMicrophone());
    const device = aMicrophone(available$);
    const muteState = new MuteState(testScope, device, true, constant(false));
    await flushPromises();
    expect(muteState.enabled$.value).toBe(true);
    muteState.setEnabled$.value!(false);
    await flushPromises();
    expect(muteState.enabled$.value).toBe(false);

    available$.next(new Map());
    await flushPromises();
    available$.next(oneMicrophone());
    await flushPromises();
    expect(muteState.enabled$.value).toBe(false);
  });

  // PG_CHANGED
  test("the default applies when nothing was requested before devices appear", async () => {
    const available$ = new BehaviorSubject(new Map<string, DeviceLabel>());
    const device = aMicrophone(available$);

    const muteState = new MuteState(testScope, device, true, constant(false));
    await flushPromises();
    available$.next(oneMicrophone());
    await flushPromises();
    expect(muteState.enabled$.value).toBe(true);
  });

  // PG_CHANGED
  test("a reported refusal mutes the refused devices only", async () => {
    const microphone = aMicrophone(constant(oneMicrophone()));
    const pgMediaRefusals = new PGMediaRefusals();
    const muteStates = new MuteStates(
      testScope,
      mockMediaDevices({
        audioInput: microphone as unknown as MediaDevices["audioInput"],
        videoInput: aVideoInput(),
        pgMediaRefusals,
      }),
      { audioEnabled: true, videoEnabled: true },
    );
    await flushPromises();
    expect(muteStates.audio.enabled$.value).toBe(true);
    expect(muteStates.video.enabled$.value).toBe(true);

    pgMediaRefusals.reportIfRefused(new DOMException("", "NotAllowedError"), [
      "microphone",
    ]);
    await flushPromises();
    expect(muteStates.audio.enabled$.value).toBe(false);
    expect(muteStates.video.enabled$.value).toBe(true);

    pgMediaRefusals.reportIfRefused(new DOMException("", "NotAllowedError"), [
      "camera",
    ]);
    await flushPromises();
    expect(muteStates.video.enabled$.value).toBe(false);
  });

  // PG_CHANGED
  test("signals an explicit unmute, but not devices appearing", async () => {
    const available$ = new BehaviorSubject(new Map<string, DeviceLabel>());
    const device = aMicrophone(available$);
    const muteState = new MuteState(testScope, device, true, constant(false));
    const onUnmuteRequested = vi.fn();
    muteState.pgUnmuteRequested$.subscribe(onUnmuteRequested);

    // Turns on by itself when the devices appear: not a request
    available$.next(oneMicrophone());
    await flushPromises();
    expect(muteState.enabled$.value).toBe(true);
    expect(onUnmuteRequested).not.toHaveBeenCalled();

    // Muting is not an unmute
    muteState.toggle$.value!();
    await flushPromises();
    muteState.setEnabled$.value!(false);
    await flushPromises();
    expect(onUnmuteRequested).not.toHaveBeenCalled();

    muteState.toggle$.value!();
    await flushPromises();
    expect(onUnmuteRequested).toHaveBeenCalledTimes(1);

    // Already on (e.g. the hosting client syncing its state): not a request
    muteState.setEnabled$.value!(true);
    await flushPromises();
    expect(onUnmuteRequested).toHaveBeenCalledTimes(1);

    muteState.setEnabled$.value!(false);
    await flushPromises();
    muteState.setEnabled$.value!(true);
    expect(onUnmuteRequested).toHaveBeenCalledTimes(2);
  });

  // PG_CHANGED: the handler tells an explicit unmute apart from one the
  // mute state starts by itself by having seen the request first
  test("signals an unmute request before calling the handler for it", async () => {
    const device = aMicrophone(constant(oneMicrophone()));
    const muteState = new MuteState(testScope, device, false, constant(false));
    await flushPromises();
    const callOrder: string[] = [];
    muteState.pgUnmuteRequested$.subscribe(() =>
      callOrder.push("unmute requested"),
    );
    muteState.setHandler(async (desired) => {
      callOrder.push(`handler(${desired})`);
      return Promise.resolve(desired);
    });

    muteState.toggle$.value!();
    await flushPromises();

    expect(callOrder).toEqual(["unmute requested", "handler(true)"]);
  });

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
