/*
Copyright 2026 Belgian Secure Communications (BSC)

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type AudioCaptureOptions } from "livekit-client";

import {
  autoGainControlSetting,
  echoCancellationSetting,
  noiseSuppressionSetting,
} from "../settings/settings";

/**
 * The microphone capture options, from the user's audio settings.
 *
 * Shared by the LiveKit room (its audio capture defaults) and the microphone
 * track created early for the mobile apps, which is published as is: both
 * must capture the same way.
 */
export function pgAudioCaptureOptions(
  deviceId: string | undefined,
): AudioCaptureOptions {
  return {
    deviceId,
    echoCancellation: echoCancellationSetting.getValue(),
    noiseSuppression: noiseSuppressionSetting.getValue(),
    autoGainControl: autoGainControlSetting.getValue(),
  };
}

/**
 * Whether two sets of capture options capture the same way. No device id
 * means the default device, as does the "default" id that browsers enumerate.
 */
export function pgAreAudioCaptureOptionsEqual(
  options: AudioCaptureOptions,
  otherOptions: AudioCaptureOptions,
): boolean {
  const deviceIdOrDefault = (captureOptions: AudioCaptureOptions): unknown =>
    captureOptions.deviceId ?? "default";
  return (
    deviceIdOrDefault(options) === deviceIdOrDefault(otherOptions) &&
    options.echoCancellation === otherOptions.echoCancellation &&
    options.noiseSuppression === otherOptions.noiseSuppression &&
    options.autoGainControl === otherOptions.autoGainControl
  );
}
