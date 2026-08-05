/*
Copyright 2026 Belgian Secure Communications (BSC)
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.

Modified by Belgian Secure Communications for Beam application on 2026-02-06
*/

import { createContext, use, useMemo } from "react";
import { useObservableEagerState } from "observable-hooks";
// PG_CHANGED: type LocalAudioTrack
import { type LocalAudioTrack } from "livekit-client";

import { type MediaDevices } from "./state/MediaDevices";
// PG_CHANGED: useInitial
import { useInitial } from "./useInitial";

export const MediaDevicesContext = createContext<MediaDevices | undefined>(
  undefined,
);

export function useMediaDevices(): MediaDevices {
  const mediaDevices = use(MediaDevicesContext);
  if (mediaDevices === undefined)
    throw new Error(
      "useMediaDevices must be used within a MediaDevices context provider",
    );
  return mediaDevices;
}

/**
 * A convenience hook to get the audio node configuration for the earpiece.
 * It will check the `useAsEarpiece` of the `audioOutput` device and return
 * the appropriate pan and volume values.
 *
 * @returns pan and volume values for the earpiece audio node configuration.
 */
export const useEarpieceAudioConfig = (): {
  pan: number;
  volume: number;
} => {
  const devices = useMediaDevices();
  const audioOutput = useObservableEagerState(devices.audioOutput.selected$);
  const isVirtualEarpiece = audioOutput?.virtualEarpiece ?? false;
  return {
    // We use only the right speaker (pan = 1) for the earpiece.
    // This mimics the behavior of the native earpiece speaker (only the top speaker on an iPhone)
    pan: useMemo(() => (isVirtualEarpiece ? 1 : 0), [isVirtualEarpiece]),
    // We also do lower the volume by a factor of 10 to optimize for the usecase where
    // a user is holding the phone to their ear.
    volume: useMemo(() => (isVirtualEarpiece ? 0.1 : 1), [isVirtualEarpiece]),
  };
};

/**
 * PG_CHANGED
 * A hook to get the local microphone track initialized with the selected audio input device.
 * This hook will suspend while the track is being created.
 *
 * @returns The LocalAudioTrack.
 */
export const useLocalMicrophoneTrack = (): LocalAudioTrack => {
  const devices = useMediaDevices();

  const trackPromise = useInitial(() => devices.getLocalMicrophoneTrack());

  return use(trackPromise);
};
