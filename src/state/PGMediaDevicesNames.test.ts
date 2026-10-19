/*
Copyright 2026 Belgian Secure Communications (BSC)

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as ComponentsCore from "@livekit/components-core";
import { logger } from "matrix-js-sdk/lib/logger";
import { Observable, of } from "rxjs";

import { availableRawDevices$, MediaDevices } from "./MediaDevices";
import { constant } from "./Behavior";
import { flushPromises, testScope } from "../utils/test";
import { ObservableScope } from "./ObservableScope";

vi.mock("@livekit/components-core");

const microphoneWithoutName = {
  deviceId: "mic",
  groupId: "",
  kind: "audioinput",
  label: "",
} as MediaDeviceInfo;

/**
 * Like LiveKit's observer when asking for the names fails (the permission is
 * refused, or the device cannot be opened): it reports the error, then an
 * empty list.
 */
function failingNamedObserver(
  onError?: (e: Error) => void,
): Observable<MediaDeviceInfo[]> {
  return new Observable((subscriber) => {
    onError?.(new DOMException("Permission denied", "NotAllowedError"));
    subscriber.next([]);
    subscriber.complete();
  });
}

describe("availableRawDevices$ when asking for the device names", () => {
  beforeEach(() => {
    vi.mocked(ComponentsCore.createMediaDeviceObserver).mockImplementation(
      (_kind, onError, requestPermissions) =>
        requestPermissions
          ? failingNamedObserver(onError)
          : // keeps listening for device changes, like LiveKit's observer
            new Observable<MediaDeviceInfo[]>((subscriber) =>
              subscriber.next([microphoneWithoutName]),
            ),
    );
  });

  test("keeps the devices, without names, when the names cannot be read", async () => {
    const devices$ = availableRawDevices$(
      "audioinput",
      constant(true),
      testScope(),
      logger,
    );
    await flushPromises();
    expect(devices$.value).toEqual([microphoneWithoutName]);
  });

  test("uses the named devices when the names can be read", async () => {
    const microphoneWithName = { ...microphoneWithoutName, label: "Mic" };
    vi.mocked(ComponentsCore.createMediaDeviceObserver).mockImplementation(
      (_kind, _onError, requestPermissions) =>
        of(requestPermissions ? [microphoneWithName] : [microphoneWithoutName]),
    );
    const devices$ = availableRawDevices$(
      "audioinput",
      constant(true),
      testScope(),
      logger,
    );
    await flushPromises();
    expect(devices$.value).toEqual([microphoneWithName]);
  });
});

describe("MediaDevices.requestDeviceNames", () => {
  let scope: ObservableScope;
  let devices: MediaDevices;

  /** The kinds whose names were asked for (an observer opening the device). */
  const kindsAskedForNames = (): Set<MediaDeviceKind | undefined> =>
    new Set(
      vi
        .mocked(ComponentsCore.createMediaDeviceObserver)
        .mock.calls.filter(([, , requestPermissions]) => requestPermissions)
        .map(([kind]) => kind),
    );

  beforeEach(() => {
    vi.mocked(ComponentsCore.createMediaDeviceObserver)
      .mockClear()
      .mockImplementation(() => of([microphoneWithoutName]));
    scope = new ObservableScope();
    devices = new MediaDevices(scope);
  });

  afterEach(() => {
    scope.end();
  });

  test("asks for the names of the requested kinds only", () => {
    devices.requestDeviceNames(["audioinput", "audiooutput"]);
    expect(kindsAskedForNames()).toEqual(
      new Set(["audioinput", "audiooutput"]),
    );
  });

  test("asks for the names of every kind by default", () => {
    devices.requestDeviceNames();
    expect(kindsAskedForNames()).toEqual(
      new Set(["audioinput", "audiooutput", "videoinput"]),
    );
  });
});
