/*
Copyright 2026 Belgian Secure Communications (BSC)

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { from, fromEvent, map, of, startWith, switchMap } from "rxjs";
import { logger as rootLogger } from "matrix-js-sdk/lib/logger";

import { type ObservableScope } from "./ObservableScope";
import { type Behavior } from "./Behavior";
import { type PGMediaKind } from "./PGMediaAccess";

/**
 * The browser's permission status for a media device, or undefined when the
 * Permissions API is unavailable or cannot query this permission (e.g. older
 * Firefox versions for camera/microphone).
 */
async function queryPermissionStatus(
  kind: PGMediaKind,
): Promise<PermissionStatus | undefined> {
  const logger = rootLogger.getChild("[PGMediaPermission]");
  const permissions = navigator.permissions as Permissions | undefined;
  if (permissions === undefined) {
    logger.debug("Permissions API unavailable");
    return undefined;
  }
  try {
    // "microphone" and "camera" are valid PermissionName values in browsers
    // that support querying them, but are not in the TypeScript lib typings.
    return await permissions.query({ name: kind as PermissionName });
  } catch (e) {
    logger.debug(`Cannot query ${kind} permission`, e);
    return undefined;
  }
}

/**
 * Whether the given media permission has been denied.
 *
 * Why this exists: when a permission is denied, device enumeration may yield
 * no devices at all for that kind (e.g. Android WebView after RECORD_AUDIO
 * was refused). Without this signal the mute state treats "no devices" as
 * "nothing to control" and removes the toggle, so the user can never
 * re-request the permission from within the call.
 *
 * Only "denied" counts. While the permission is still to be asked
 * ("prompt"), browsers enumerate the devices that exist (without labels), so
 * device availability alone decides, as upstream. Counting "prompt" would
 * offer a toggle for a device kind that is absent (e.g. a PC without a
 * camera), whose request then fails. The same goes while the query is pending
 * and when the Permissions API is unavailable or unable to query the
 * permission: we keep the upstream behaviour when we cannot tell.
 */
export function pgMediaPermissionDenied$(
  kind: PGMediaKind,
  scope: ObservableScope,
): Behavior<boolean> {
  return scope.behavior(
    from(queryPermissionStatus(kind)).pipe(
      switchMap((status) =>
        status === undefined
          ? of(false)
          : fromEvent(status, "change").pipe(
              startWith(null),
              map(() => status.state === "denied"),
            ),
      ),
    ),
    false,
  );
}

/**
 * The browser's permission state for a media device, at the time of the
 * call. "unknown" when the Permissions API cannot tell.
 */
export async function pgQueryMediaPermissionState(
  kind: PGMediaKind,
): Promise<PermissionState | "unknown"> {
  return (await queryPermissionStatus(kind))?.state ?? "unknown";
}
