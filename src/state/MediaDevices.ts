/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  combineLatest,
  defer, // PG_CHANGED
  filter,
  map,
  merge, // PG_CHANGED
  type Observable,
  pairwise,
  Subject,
  switchMap,
  take, // PG_CHANGED
  takeUntil, // PG_CHANGED
} from "rxjs";
import { createMediaDeviceObserver } from "@livekit/components-core";
import { type Logger, logger as rootLogger } from "matrix-js-sdk/lib/logger";
// PG_CHANGED: AudioCaptureOptions, LocalAudioTrack, createLocalAudioTrack
import {
  type AudioCaptureOptions,
  type LocalAudioTrack,
  createLocalAudioTrack,
} from "livekit-client";

import {
  alwaysShowIphoneEarpiece as alwaysShowIphoneEarpieceSetting,
  audioInput as audioInputSetting,
  audioOutput as audioOutputSetting,
  videoInput as videoInputSetting,
} from "../settings/settings";
import { type ObservableScope } from "./ObservableScope";
import { availableOutputDevices$ as controlledAvailableOutputDevices$ } from "../controls";
import { getUrlParams } from "../UrlParams";
import { platform } from "../Platform";
import { switchWhen } from "../utils/observable";
// PG_CHANGED: PGMediaRefusals, pgIsPermissionRefused,
// pgReportRefusedRequestsToIOSApp, pgMediaPermissionDenied$,
// pgQueryMediaPermissionState, pgAudioCaptureOptions,
// pgAreAudioCaptureOptionsEqual
import {
  PGMediaRefusals,
  pgIsPermissionRefused,
  pgReportRefusedRequestsToIOSApp,
} from "./PGMediaAccess";
import {
  pgMediaPermissionDenied$,
  pgQueryMediaPermissionState,
} from "./PGMediaPermission";
import {
  pgAudioCaptureOptions,
  pgAreAudioCaptureOptionsEqual,
} from "../livekit/pgAudioCaptureOptions";
import { type Behavior, constant } from "./Behavior";
import { AndroidControlledAudioOutput } from "./AndroidControlledAudioOutput.ts";
import { IOSControlledAudioOutput } from "./IOSControlledAudioOutput.ts";

export type DeviceLabel =
  | { type: "name"; name: string }
  | { type: "number"; number: number };

export type AudioOutputDeviceLabel =
  | DeviceLabel
  | { type: "speaker" }
  | { type: "earpiece" }
  | { type: "default"; name: string | null };

/**
 * Base selected-device value shared by all media kinds.
 *
 * `id` is the effective device identifier used by browser media APIs.
 */
export interface SelectedDevice {
  id: string;
}

/**
 * Selected audio input value with audio-input-specific metadata.
 */
export interface SelectedAudioInputDevice extends SelectedDevice {
  /**
   * Emits whenever we think that this audio input device has logically changed
   * to refer to a different hardware device.
   */
  hardwareDeviceChange$: Observable<void>;
}

/**
 * Selected audio output value with output-routing-specific metadata.
 */
export interface SelectedAudioOutputDevice extends SelectedDevice {
  /**
   * Whether this device is a "virtual earpiece" device. If so, we should output
   * on a single channel of the device at a reduced volume.
   */
  virtualEarpiece: boolean;
}

/**
 * Common reactive contract for selectable input/output media devices (mic, speaker, camera).
 *
 * `Label` is the type used to represent a device in UI lists.
 * `Selected` is the type used to represent the active selection for a device kind.
 */
export interface MediaDevice<Label, Selected> {
  /**
   * Reactive map of currently available devices keyed by device ID.
   *
   * `Label` defines the UI-facing label data structure for each device type.
   */
  available$: Behavior<Map<string, Label>>;

  /**
   * The active device selection.
   * Can be `undefined` when no device is yet selected.
   *
   * When defined, `Selected` contains the selected device ID plus any
   * type-specific metadata.
   */
  selected$: Behavior<Selected | undefined>;

  /**
   * Requests selection of a device by ID.
   *
   * Implementations typically persist this preference and let `selected$`
   * converge to the effective device (which may differ if the requested ID is
   * unavailable).
   */
  select(id: string): void;
}

/**
 * An observable that represents if we should display the devices menu for iOS.
 *
 * This implies the following
 *  - hide any input devices (they do not work anyhow on ios)
 *  - Show a button to show the native output picker instead.
 *  - Only show the earpiece toggle option if the earpiece is available:
 *   `availableOutputDevices$.includes((d)=>d.forEarpiece)`
 */
export const iosDeviceMenu$ =
  platform === "ios" ? constant(true) : alwaysShowIphoneEarpieceSetting.value$;

export function availableRawDevices$(
  kind: MediaDeviceKind,
  usingNames$: Behavior<boolean>,
  scope: ObservableScope,
  logger: Logger,
): Behavior<MediaDeviceInfo[]> {
  const logError = (e: Error): void =>
    logger.error("Error creating MediaDeviceObserver", e);
  const devices$ = createMediaDeviceObserver(kind, logError, false);
  // PG_CHANGED: asking for the names captures the device for a moment. When
  // that fails (the permission is refused, or the device cannot be opened),
  // LiveKit reports the error and then an empty list, which removed the
  // devices: the mute button lost its device menu and could no longer be
  // toggled. Keep the devices we know, without names, instead.
  const devicesWithNames$ = defer(() => {
    const namesFailed$ = new Subject<void>();
    const namedDevices$ = createMediaDeviceObserver(
      kind,
      (e) => {
        logError(e);
        namesFailed$.next();
      },
      true,
    );
    // listen for the failure before asking for the names
    return merge(
      namesFailed$.pipe(
        take(1),
        switchMap(() => devices$),
      ),
      namedDevices$.pipe(takeUntil(namesFailed$)),
    );
  });

  return scope.behavior(
    usingNames$.pipe(
      switchMap((withNames) =>
        withNames
          ? // It might be that there is already a media stream running somewhere,
            // and so we can do without requesting a second one. Only switch to the
            // device observer that explicitly requests the names if we see that
            // names are in fact missing from the initial device enumeration.
            devices$.pipe(
              switchWhen(
                (devices, i) => i === 0 && devices.every((d) => !d.label),
                devicesWithNames$,
              ),
            )
          : devices$,
      ),
    ),
    [],
  );
}

function buildDeviceMap(
  availableRaw: MediaDeviceInfo[],
): Map<string, DeviceLabel> {
  return new Map<string, DeviceLabel>(
    availableRaw.map((d, i) => [
      d.deviceId,
      d.label
        ? { type: "name", name: d.label }
        : { type: "number", number: i + 1 },
    ]),
  );
}

function selectDevice$<Label>(
  available$: Observable<Map<string, Label>>,
  preferredId$: Observable<string | undefined>,
): Observable<string | undefined> {
  return combineLatest([available$, preferredId$], (available, preferredId) => {
    if (available.size) {
      if (preferredId !== undefined && available.has(preferredId)) {
        // If the preferred device is available, use it.
        return preferredId;
      } else if (available.size === 1 && available.has("")) {
        // In some cases the enumerateDevices will list the devices with empty string details:
        // `{deviceId:'', kind:'audiooutput|audioinput|videoinput', label:'', groupId:''}`
        // This can happen when:
        //     1. The user has not yet granted permissions to microphone/devices
        //     2. The page is not running in a secure context (e.g. localhost or https)
        //     3. In embedded WebViews, restrictions are often tighter, need active capture..
        //     3. The browser is blocking access to device details for privacy reasons (?)
        // This is most likely transitional, so keep the current device selected until we get a more accurate enumerateDevices.
        return preferredId;
      } else {
        // No preferred, so pick a default.
        return available.keys().next().value;
      }
    }
    return undefined;
  });
}

class AudioInput implements MediaDevice<DeviceLabel, SelectedAudioInputDevice> {
  private logger = rootLogger.getChild("[MediaDevices AudioInput]");

  private readonly availableRaw$: Behavior<MediaDeviceInfo[]> =
    availableRawDevices$(
      "audioinput",
      this.usingNames$,
      this.scope,
      this.logger,
    );

  public readonly available$ = this.scope.behavior(
    this.availableRaw$.pipe(map(buildDeviceMap)),
  );

  public readonly selected$ = this.scope.behavior(
    selectDevice$(this.available$, audioInputSetting.value$).pipe(
      map((id) =>
        id === undefined
          ? undefined
          : {
              id,
              // We can identify when the hardware device has changed by watching for
              // changes in the group ID
              hardwareDeviceChange$: this.availableRaw$.pipe(
                map(
                  (devices) => devices.find((d) => d.deviceId === id)?.groupId,
                ),
                pairwise(),
                filter(([before, after]) => before !== after),
                map(() => undefined),
              ),
            },
      ),
    ),
  );

  public select(id: string): void {
    audioInputSetting.setValue(id);
  }

  public constructor(
    private readonly usingNames$: Behavior<boolean>,
    private readonly scope: ObservableScope,
  ) {
    this.available$.subscribe((available) => {
      this.logger.info("[audio-input] available devices:", available);
    });
  }
}

export class AudioOutput implements MediaDevice<
  AudioOutputDeviceLabel,
  SelectedAudioOutputDevice
> {
  private logger = rootLogger.getChild("[MediaDevices AudioOutput]");
  public readonly available$ = this.scope.behavior(
    availableRawDevices$(
      "audiooutput",
      this.usingNames$,
      this.scope,
      this.logger,
    ).pipe(
      map((availableRaw) => {
        let available: Map<string, AudioOutputDeviceLabel> =
          buildDeviceMap(availableRaw);
        // Create a virtual default audio output for browsers that don't have one.
        // Its device ID must be the empty string because that's what setSinkId
        // recognizes.
        if (available.size && !available.has("") && !available.has("default"))
          available.set("", {
            type: "default",
            name: availableRaw[0]?.label || null,
          });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isSafari = !!(window as any).GestureEvent; // non standard api only found on Safari. https://developer.mozilla.org/en-US/docs/Web/API/GestureEvent#browser_compatibility
        if (isSafari) {
          // set to empty map if we are on Safari, because it does not support setSinkId
          available = new Map();
        }
        // Note: creating virtual default input devices would be another problem
        // entirely, because requesting a media stream from deviceId "" won't
        // automatically track the default device.
        return available;
      }),
    ),
  );

  public readonly selected$ = this.scope.behavior(
    selectDevice$(this.available$, audioOutputSetting.value$).pipe(
      map((id) => {
        if (id === undefined) {
          return undefined;
        } else {
          return {
            id,
            virtualEarpiece: false,
          };
        }
      }),
    ),
  );
  public select(id: string): void {
    audioOutputSetting.setValue(id);
  }

  public constructor(
    private readonly usingNames$: Behavior<boolean>,
    private readonly scope: ObservableScope,
  ) {
    this.available$.subscribe((available) => {
      this.logger.info("[audio-output] available devices:", available);
    });
  }
}

class VideoInput implements MediaDevice<DeviceLabel, SelectedDevice> {
  private logger = rootLogger.getChild("[MediaDevices VideoInput]");

  public readonly available$ = this.scope.behavior(
    availableRawDevices$(
      "videoinput",
      this.usingNames$,
      this.scope,
      this.logger,
    ).pipe(map(buildDeviceMap)),
  );
  public readonly selected$ = this.scope.behavior(
    selectDevice$(this.available$, videoInputSetting.value$).pipe(
      map((id) => (id === undefined ? undefined : { id })),
    ),
  );
  public select(id: string): void {
    videoInputSetting.setValue(id);
  }

  public constructor(
    private readonly usingNames$: Behavior<boolean>,
    private readonly scope: ObservableScope,
  ) {
    // This also has the purpose of subscribing to the available devices
    this.available$.subscribe((available) => {
      this.logger.info("[video-input] available devices:", available);
    });
  }
}

export class MediaDevices {
  // PG_CHANGED: the kinds whose names are requested
  private readonly deviceNamesRequest$ = new Subject<MediaDeviceKind[]>();
  /**
   * Requests that the media devices be populated with the names of each
   * available device, rather than numbered identifiers. This may invoke a
   * permissions pop-up, so it should only be called when there is a clear user
   * intent to view the device list.
   *
   * PG_CHANGED: only for the given kinds (all by default). Reading the names
   * of a kind opens a device of that kind for a moment, so reading the
   * camera names when the user only opened the microphone menu prompted for
   * the camera.
   */
  public requestDeviceNames(
    requestedKinds: MediaDeviceKind[] = [
      "audioinput",
      "audiooutput",
      "videoinput",
    ],
  ): void {
    this.deviceNamesRequest$.next(requestedKinds);
  }

  // Start using device names as soon as requested. This will cause LiveKit to
  // briefly request device permissions and acquire media streams for each
  // device type while calling `enumerateDevices`, which is what browsers want
  // you to do to receive device names in lieu of a more explicit permissions
  // API. This flag never resets to false, because once permissions are granted
  // the first time, the user won't be prompted again until reload of the page.
  // PG_CHANGED: one flag per kind, set once the names of that kind are
  // requested.
  private pgUsingNames$(kind: MediaDeviceKind): Behavior<boolean> {
    return this.scope.behavior(
      this.deviceNamesRequest$.pipe(
        filter((requestedKinds) => requestedKinds.includes(kind)),
        map(() => true),
      ),
      false,
    );
  }
  private readonly usingAudioInputNames$ = this.pgUsingNames$("audioinput");
  private readonly usingAudioOutputNames$ = this.pgUsingNames$("audiooutput");
  private readonly usingVideoInputNames$ = this.pgUsingNames$("videoinput");
  public readonly audioInput: MediaDevice<
    DeviceLabel,
    SelectedAudioInputDevice
  > = new AudioInput(this.usingAudioInputNames$, this.scope);

  public readonly audioOutput: MediaDevice<
    AudioOutputDeviceLabel,
    SelectedAudioOutputDevice
  > = getUrlParams().controlledAudioDevices
    ? platform == "android"
      ? new AndroidControlledAudioOutput(
          controlledAvailableOutputDevices$,
          this.scope,
          getUrlParams().callIntent,
          window.controls,
        )
      : new IOSControlledAudioOutput(
          this.usingAudioOutputNames$, // PG_CHANGED
          this.scope,
          getUrlParams().callIntent,
        )
    : new AudioOutput(this.usingAudioOutputNames$, this.scope); // PG_CHANGED

  public readonly videoInput: MediaDevice<DeviceLabel, SelectedDevice> =
    new VideoInput(this.usingVideoInputNames$, this.scope); // PG_CHANGED

  /**
   * PG_CHANGED
   * Where refused microphone/camera requests are reported (see
   * PGMediaAccess).
   */
  public readonly pgMediaRefusals = new PGMediaRefusals();

  /**
   * PG_CHANGED
   * Whether the microphone / camera permission is denied, so that the mute
   * states keep their toggle even when no device is enumerated (see
   * MuteState).
   */
  public readonly pgMicrophonePermissionDenied$: Behavior<boolean> =
    pgMediaPermissionDenied$("microphone", this.scope);
  public readonly pgCameraPermissionDenied$: Behavior<boolean> =
    pgMediaPermissionDenied$("camera", this.scope);

  /**
   * PG_CHANGED
   * Gets or creates the local microphone track, created early on mobile (see
   * RoomPage) and published as is when joining (see Publisher).
   *
   * The pending creation is cached (not only its result), so that concurrent
   * callers share one getUserMedia call and thus one permission prompt. A
   * refused permission is cached as well: we never re-prompt on our own, only
   * a caller acting on an explicit user action should pass `retryIfRefused`.
   * Other failures, and a track that has been stopped since (unpublished at
   * the end of a call), are retried.
   *
   * A refusal is reported to `pgMediaRefusals` for every caller, so that whoever
   * needs the microphone at that moment gets the button muted.
   */
  private pendingLocalMicrophoneTrack: Promise<LocalAudioTrack> | null = null;
  private localMicrophonePermissionRefused = false;
  // The options each early microphone track was captured with (see
  // pgApplyAudioSettingsToMicrophoneTrack).
  private readonly localMicrophoneTrackCaptureOptions = new WeakMap<
    LocalAudioTrack,
    AudioCaptureOptions
  >();
  public async getLocalMicrophoneTrack({
    retryIfRefused = false,
  }: { retryIfRefused?: boolean } = {}): Promise<LocalAudioTrack> {
    if (this.localMicrophonePermissionRefused && retryIfRefused) {
      this.pendingLocalMicrophoneTrack = null;
    }
    if (this.pendingLocalMicrophoneTrack === null) {
      this.pendingLocalMicrophoneTrack = this.createLocalMicrophoneTrack();
    }
    const pendingTrack = this.pendingLocalMicrophoneTrack;
    let track: LocalAudioTrack;
    try {
      track = await pendingTrack;
    } catch (e) {
      this.pgMediaRefusals.reportIfRefused(e, ["microphone"]);
      throw e;
    }
    if (track.mediaStreamTrack.readyState === "ended") {
      // Only drop the pendingTrack that gave the ended track: a concurrent caller
      // may already have replaced it, and dropping that one would create a
      // second track, never stopped.
      if (this.pendingLocalMicrophoneTrack === pendingTrack) {
        this.pendingLocalMicrophoneTrack = null;
      }
      return this.getLocalMicrophoneTrack();
    }
    return track;
  }

  private async createLocalMicrophoneTrack(): Promise<LocalAudioTrack> {
    this.localMicrophonePermissionRefused = false;
    const options = pgAudioCaptureOptions(this.audioInput.selected$.value?.id);
    try {
      const track = await createLocalAudioTrack(options);
      this.localMicrophoneTrackCaptureOptions.set(track, options);
      return track;
    } catch (e) {
      if (pgIsPermissionRefused(e)) {
        this.localMicrophonePermissionRefused = true;
      } else {
        this.pendingLocalMicrophoneTrack = null;
      }
      throw e;
    }
  }

  /**
   * PG_CHANGED
   * Brings the early microphone track up to date with the selected device and
   * the audio settings, before it is published (see Publisher).
   *
   * The track is created at page load, when the devices are often not
   * enumerated yet (so the saved device is not known), and the user may
   * change the device or the audio settings in the lobby afterwards. LiveKit
   * reads them when joining for its own track, and only follows a device
   * change once connected, so without this the call would keep capturing the
   * way the page started. The track is only restarted when something
   * changed: the permission is granted by then, so this does not prompt.
   */
  public async pgApplyAudioSettingsToMicrophoneTrack(
    track: LocalAudioTrack,
  ): Promise<void> {
    const appliedOptions = this.localMicrophoneTrackCaptureOptions.get(track);
    const wantedOptions = pgAudioCaptureOptions(
      this.audioInput.selected$.value?.id,
    );
    if (
      appliedOptions === undefined ||
      pgAreAudioCaptureOptionsEqual(appliedOptions, wantedOptions)
    )
      return;
    await track.restartTrack(wantedOptions);
    this.localMicrophoneTrackCaptureOptions.set(track, wantedOptions);
  }

  /**
   * PG_CHANGED
   * Asks for the microphone on behalf of the user (unmuting in the lobby), so
   * that a refusal shows right away rather than only when joining.
   *
   * On mobile, this is the early track, asked for again if it was refused.
   * On the web, only the permission matters (LiveKit creates its own track
   * when joining), so nothing is asked when it is already granted, and the
   * track is stopped right away otherwise.
   */
  public async pgRequestMicrophoneAccess(): Promise<void> {
    const isWeb = platform === "desktop";
    if (
      isWeb &&
      (await pgQueryMediaPermissionState("microphone")) === "granted"
    )
      return;
    const track = await this.getLocalMicrophoneTrack({ retryIfRefused: true });
    if (isWeb) track.stop();
  }

  public constructor(private readonly scope: ObservableScope) {
    pgReportRefusedRequestsToIOSApp(this.pgMediaRefusals, scope); // PG_CHANGED
  }
}
