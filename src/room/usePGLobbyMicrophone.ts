/*
Copyright 2026 Belgian Secure Communications (BSC)

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { useEffect } from "react";
import { filter, Subscription, take } from "rxjs";
import { logger } from "matrix-js-sdk/lib/logger";

import { platform } from "../Platform";
import { type MediaDevices } from "../state/MediaDevices";
import { type MuteStates } from "../state/MuteStates";

/**
 * Keeps the lobby's microphone button truthful. A refusal is reported by
 * MediaDevices, which mutes the button (see MuteStates).
 *
 * - When the user unmutes: ask for the microphone again. Otherwise, after a
 *   refusal, unmuting would only flip the icon.
 * - On mobile, once the microphone is on: share the early microphone request
 *   (see RoomPage), so that a refusal mutes the button. On the web, the lobby
 *   preview asks for it, together with the camera.
 */
export function usePGLobbyMicrophone(
  devices: MediaDevices,
  muteStates: MuteStates,
): void {
  useEffect(() => {
    const microphoneMuteState = muteStates.audio;
    const logMicrophoneUnavailable = (error: unknown): void =>
      logger.warn("[Lobby] Microphone unavailable", error);
    const subscription = new Subscription();

    subscription.add(
      microphoneMuteState.pgUnmuteRequested$.subscribe(() => {
        devices.pgRequestMicrophoneAccess().catch(logMicrophoneUnavailable);
      }),
    );
    if (platform !== "desktop") {
      subscription.add(
        microphoneMuteState.enabled$
          .pipe(filter(Boolean), take(1))
          .subscribe(() => {
            devices.getLocalMicrophoneTrack().catch(logMicrophoneUnavailable);
          }),
      );
    }
    return (): void => subscription.unsubscribe();
  }, [devices, muteStates]);
}
