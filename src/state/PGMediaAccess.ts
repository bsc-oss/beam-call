/*
Copyright 2026 Belgian Secure Communications (BSC)

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type Observable, Subject, switchMap } from "rxjs";
import {
  type CreateLocalTracksOptions,
  type LocalTrack,
  MediaDeviceFailure,
  Track,
} from "livekit-client";
import { logger as rootLogger } from "matrix-js-sdk/lib/logger";

import { type ObservableScope } from "./ObservableScope";
import { pgQueryMediaPermissionState } from "./PGMediaPermission";
import { platform } from "../Platform";

/** The local media whose access is tracked. */
export type PGMediaKind = "microphone" | "camera";

export const pgMediaKindFromDeviceKind = (
  kind: MediaDeviceKind | undefined,
): PGMediaKind | undefined => {
  switch (kind) {
    case "audioinput":
      return "microphone";
    case "videoinput":
      return "camera";
    default:
      return undefined;
  }
};

/** Whether a media request failed because the permission was refused. */
export const pgIsPermissionRefused = (error: unknown): boolean =>
  MediaDeviceFailure.getFailure(error) === MediaDeviceFailure.PermissionDenied;

/** The media kinds that these track options ask for. */
export function pgMediaKindsRequestedBy(
  options: CreateLocalTracksOptions,
): PGMediaKind[] {
  const requestedKinds: PGMediaKind[] = [];
  if (options.audio) requestedKinds.push("microphone");
  if (options.video) requestedKinds.push("camera");
  return requestedKinds;
}

/** The media kinds that these local tracks capture. */
export function pgMediaKindsCapturedBy(tracks: LocalTrack[]): PGMediaKind[] {
  const capturedKinds: PGMediaKind[] = [];
  for (const track of tracks) {
    if (track.kind === Track.Kind.Audio) capturedKinds.push("microphone");
    else if (track.kind === Track.Kind.Video) capturedKinds.push("camera");
  }
  return capturedKinds;
}

/**
 * The devices to blame when a request for several devices fails.
 *
 * A request for several devices fails as a whole, so a device that worked
 * just before (the lobby's microphone preview, when the camera is turned on)
 * would get the blame along with the refused one: muted, and named as
 * blocked. Only the devices that were not captured just before are blamed.
 * When all of them were, nothing tells them apart, so all are blamed.
 */
export function pgRefusedKindsAmong(
  requestedKinds: PGMediaKind[],
  previouslyCapturedKinds: PGMediaKind[],
): PGMediaKind[] {
  const newlyRequestedKinds = requestedKinds.filter(
    (kind) => !previouslyCapturedKinds.includes(kind),
  );
  return newlyRequestedKinds.length > 0 ? newlyRequestedKinds : requestedKinds;
}

/**
 * The devices of a refused request whose permission the user must allow.
 *
 * A request for several devices (e.g. microphone and camera when joining)
 * fails as a whole, with a single error that does not say which permission
 * was refused, so the browser is asked. When it reports none as denied (the
 * Permissions API is unavailable, or the user dismissed the prompt without
 * the browser remembering a denial), all the requested devices are named.
 */
async function deniedPermissionKinds(
  requestedKinds: PGMediaKind[],
): Promise<PGMediaKind[]> {
  const permissionStates = await Promise.all(
    requestedKinds.map(pgQueryMediaPermissionState),
  );
  const deniedKinds = requestedKinds.filter(
    (_, i) => permissionStates[i] === "denied",
  );
  return deniedKinds.length > 0 ? deniedKinds : requestedKinds;
}

/**
 * The single place where media requests refused by the user (or the
 * platform) are reported, whoever made the request (lobby preview, early
 * microphone track, LiveKit when joining or unmuting).
 */
export class PGMediaRefusals {
  private readonly logger = rootLogger.getChild("[PGMediaAccess]");
  private readonly refusedRequestsSubject = new Subject<PGMediaKind[]>();

  /**
   * Emits, for each refused request, the devices it asked for. None of them
   * started, so the mute states mute them all (see MuteStates): the buttons
   * reflect reality and a single tap asks again.
   */
  public readonly refusedRequests$: Observable<PGMediaKind[]> =
    this.refusedRequestsSubject;

  /**
   * For each refused request, the devices whose permission the user must
   * allow. On the web, the user is told how to allow them
   * (PGMediaAccessModal), without being nagged about a device they never try
   * to enable. The browser is only asked while this is subscribed to.
   */
  public readonly deniedPermissions$: Observable<PGMediaKind[]> =
    this.refusedRequests$.pipe(switchMap(deniedPermissionKinds));

  /**
   * Report a failed media request, if it failed because the permission was
   * refused. Other failures (busy device, no device) are ignored.
   */
  public reportIfRefused(error: unknown, requestedKinds: PGMediaKind[]): void {
    if (requestedKinds.length === 0 || !pgIsPermissionRefused(error)) return;
    this.logger.info(`Access refused for ${requestedKinds.join(", ")}`);
    this.refusedRequestsSubject.next(requestedKinds);
  }
}

/**
 * Tell the iOS app about each refused request, so that it can point to its
 * settings (see docs/controls.md).
 *
 * WebKit on iOS asks for the system permission itself, and once it is denied
 * rejects the request without involving the app, which therefore cannot know.
 * The Android app asks for the system permission itself, so it already knows.
 */
export function pgReportRefusedRequestsToIOSApp(
  mediaRefusals: PGMediaRefusals,
  scope: ObservableScope,
): void {
  if (platform !== "ios") return;
  mediaRefusals.refusedRequests$
    .pipe(scope.bind())
    .subscribe((requestedKinds) =>
      window.controls.onMediaAccessRefused?.(requestedKinds),
    );
}
