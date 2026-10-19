/*
Copyright 2026 Belgian Secure Communications (BSC)
Copyright 2023-2025 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.

Modified by Belgian Secure Communications for Beam application on 2026-10-06
Modified by Belgian Secure Communications for Beam application on 2026-09-29
*/

import { type IWidgetApiRequest } from "matrix-widget-api";
import { logger } from "matrix-js-sdk/lib/logger";
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  fromEvent,
  map,
  merge,
  Observable,
  of,
  Subject,
  switchMap,
  withLatestFrom,
} from "rxjs";

import { type MediaDevices, type MediaDevice } from "../state/MediaDevices";
import { type PGMediaKind } from "./PGMediaAccess"; // PG_CHANGED
import { ElementWidgetActions, widget } from "../widget";
import { type ObservableScope } from "./ObservableScope";
import { type Behavior, constant } from "./Behavior";

interface MuteStateData {
  enabled$: Observable<boolean>;
  syncing$: Observable<boolean>;
  set: ((enabled: boolean) => void) | null;
  toggle: (() => void) | null;
}

export type Handler = (desired: boolean) => Promise<boolean>;
const defaultHandler: Handler = async (desired) => Promise.resolve(desired);

/**
 * Internal class - exported only for testing purposes.
 * Do not use directly outside of tests.
 */
export class MuteState<Label, Selected> {
  private readonly handler$ = new BehaviorSubject(defaultHandler);
  // PG_CHANGED: the state to restore when the devices become controllable
  // again: the state the handler last settled on, or a mute that arrived
  // before the devices were enumerated (see pgMuteAfterRefusal); null means
  // the default.
  private enabledWhenControllable: boolean | null = null;
  // PG_CHANGED: see pgUnmuteRequested$
  private readonly pgUnmuteRequestedSubject = new Subject<void>();
  /**
   * PG_CHANGED
   * Emits when unmuting is asked for through `setEnabled$` or `toggle$`,
   * i.e. by the user or the hosting client. Unlike `enabled$`, which also
   * turns on by itself when the devices appear, this is the moment it is
   * acceptable to ask for a refused permission again.
   *
   * Only a request that turns a muted device on counts: the hosting client
   * may send "enabled" for a device that is already on (state sync), which
   * must not prompt again. Emits before the handler is called for it.
   */
  public readonly pgUnmuteRequested$: Observable<void> =
    this.pgUnmuteRequestedSubject;

  /**
   * PG_CHANGED
   * Mutes the device after its permission was refused. Unlike
   * `setEnabled$`, this is never dropped: while nothing can be controlled
   * (no device enumerated yet), the mute is remembered and applied once the
   * devices appear, instead of the default state. A refusal can come before
   * the devices are enumerated, which is instant for a site blocked earlier
   * in the browser.
   */
  public pgMuteAfterRefusal(): void {
    const setEnabled = this.setEnabled$.value;
    if (setEnabled) setEnabled(false);
    else this.enabledWhenControllable = false;
  }

  public setHandler(handler: Handler): void {
    if (this.handler$.value !== defaultHandler)
      throw new Error("Multiple mute state handlers are not supported");
    this.handler$.next(handler);
  }

  public unsetHandler(): void {
    this.handler$.next(defaultHandler);
  }

  // PG_CHANGED: an empty device list does not mean there is nothing to
  // control when the permission is denied: device enumeration yields nothing
  // for a denied kind (e.g. Android WebView with RECORD_AUDIO refused), so
  // without this the toggle would disappear and the user could never ask for
  // the permission again. Keep the toggle, and let unmuting ask again.
  private readonly canControlDevices$ = combineLatest([
    this.device.available$,
    this.forceMute$,
    this.permissionDenied$,
  ]).pipe(
    map(([available, forceMute, permissionDenied]) => {
      return !forceMute && (available.size > 0 || permissionDenied);
    }),
  );

  private readonly data$ = this.scope.behavior<MuteStateData>(
    this.canControlDevices$.pipe(
      distinctUntilChanged(),
      map((canControlDevices) => {
        logger.info(
          `MuteState: canControlDevices: ${canControlDevices}, enabled by default: ${this.enabledByDefault}`,
        );
        if (!canControlDevices) {
          logger.info(
            `MuteState: devices connected: ${canControlDevices}, disabling`,
          );
          // We need to sync the mute state with the handler
          // to ensure nothing is beeing published.
          this.handler$.value(false).catch((err) => {
            logger.error("MuteState-disable: handler error", err);
          });
          return {
            enabled$: of(false),
            syncing$: of(false),
            set: null,
            toggle: null,
          };
        }

        // Assume the default value only once devices are actually connected
        // PG_CHANGED: unless a state was set for this moment (see
        // enabledWhenControllable).
        const desiredInitialEnabled =
          this.enabledWhenControllable ?? this.enabledByDefault;
        // PG_CHANGED: the device is off at this point: it was not
        // controllable, so the handler was told to turn it off (above), or
        // nothing was started yet. Start from off and turn it on through the
        // handler, rather than assuming it is on: a refusal then mutes it
        // instead of going unnoticed.
        let enabled = false;
        const set$ = new Subject<boolean>();
        const toggle$ = new Subject<void>();
        const syncing$ = new BehaviorSubject(false);
        const desired$ = merge(set$, toggle$.pipe(map(() => !enabled)));
        const enabled$ = new Observable<boolean>((subscriber) => {
          subscriber.next(enabled);
          let latestDesired = desiredInitialEnabled; // PG_CHANGED: was enabledByDefault

          const sync = async (): Promise<void> => {
            if (enabled === latestDesired) {
              syncing$.next(false);
            } else {
              const previouslyEnabled = enabled;
              syncing$.next(true);
              enabled = await firstValueFrom(
                this.handler$.pipe(
                  switchMap(async (handler) => handler(latestDesired)),
                ),
              );
              this.enabledWhenControllable = enabled; // PG_CHANGED
              if (enabled === previouslyEnabled) {
                syncing$.next(false);
              } else {
                subscriber.next(enabled);
                syncing$.next(true);
                sync().catch((err) => {
                  // TODO: better error handling
                  logger.error("MuteState: handler error", err);
                });
              }
            }
          };

          const s = desired$.subscribe((desired) => {
            const isUnmuteRequest = desired && !enabled; // PG_CHANGED
            latestDesired = desired;
            // PG_CHANGED: see pgUnmuteRequested$. Emitted before the handler
            // is called, so that the handler can tell this unmute apart from
            // one the mute state starts by itself; and after latestDesired is
            // set, so that a refusal reported while emitting (which mutes
            // again) is not overwritten.
            if (isUnmuteRequest) this.pgUnmuteRequestedSubject.next();
            if (syncing$.value === false) {
              syncing$.next(true);
              sync().catch((err) => {
                // TODO: better error handling
                logger.error("MuteState: handler error", err);
              });
            }
          });
          // PG_CHANGED: start in the desired state through the handler (see
          // above), as for any later change.
          if (latestDesired) {
            syncing$.next(true);
            sync().catch((err) => {
              logger.error("MuteState: handler error", err);
            });
          }
          return (): void => {
            s.unsubscribe();
            syncing$.complete();
          };
        });

        return {
          set: (enabled: boolean): void => set$.next(enabled),
          toggle: (): void => {
            if (syncing$.value) return;
            toggle$.next();
          },
          enabled$,
          syncing$,
        };
      }),
    ),
  );

  public readonly enabled$: Behavior<boolean> = this.scope.behavior(
    this.data$.pipe(switchMap(({ enabled$ }) => enabled$)),
  );

  public readonly setEnabled$: Behavior<((enabled: boolean) => void) | null> =
    this.scope.behavior(this.data$.pipe(map(({ set }) => set)));

  public readonly toggle$: Behavior<(() => void) | null> = this.scope.behavior(
    this.data$.pipe(map(({ toggle }) => toggle)),
  );

  public readonly syncing$: Behavior<boolean> = this.scope.behavior(
    this.data$.pipe(switchMap(({ syncing$ }) => syncing$)),
  );

  public constructor(
    private readonly scope: ObservableScope,
    private readonly device: MediaDevice<Label, Selected>,
    private readonly enabledByDefault: boolean,
    /**
     * An optional observable which, when it emits `true`, will force the mute.
     * Used for video to stop camera when earpiece mode is on.
     * @private
     */
    private readonly forceMute$: Observable<boolean>,
    /**
     * PG_CHANGED: whether the permission for this device kind is denied.
     * While `true`, the mute state stays controllable even if no device is
     * enumerated, so that unmuting can ask for the permission again.
     * Defaults to `false`, which preserves the upstream behaviour.
     */
    private readonly permissionDenied$: Observable<boolean> = constant(false),
  ) {}
}

export class MuteStates {
  public readonly audio = new MuteState(
    this.scope,
    this.mediaDevices.audioInput,
    this.initialMuteState.audioEnabled,
    constant(false),
    // PG_CHANGED: allow re-requesting a denied microphone permission
    this.mediaDevices.pgMicrophonePermissionDenied$,
  );
  public readonly video = new MuteState(
    this.scope,
    this.mediaDevices.videoInput,
    this.initialMuteState.videoEnabled,
    // PG_CHANGED
    constant(false),
    // PG_CHANGED: allow re-requesting a denied camera permission
    this.mediaDevices.pgCameraPermissionDenied$,
  );

  /** PG_CHANGED: the mute state of a device kind, as media requests name it. */
  public pgMuteStateForKind(
    kind: PGMediaKind,
  ): MuteStates["audio"] | MuteStates["video"] {
    return kind === "microphone" ? this.audio : this.video;
  }

  public constructor(
    private readonly scope: ObservableScope,
    private readonly mediaDevices: MediaDevices,
    private readonly initialMuteState: {
      audioEnabled: boolean;
      videoEnabled: boolean;
    },
  ) {
    // PG_CHANGED: the devices of a refused request are muted, whoever asked
    // for them: none of them was started, so the buttons reflect reality and
    // a single tap asks again.
    this.mediaDevices.pgMediaRefusals.refusedRequests$
      .pipe(this.scope.bind())
      .subscribe((requestedKinds) => {
        for (const kind of requestedKinds)
          this.pgMuteStateForKind(kind).pgMuteAfterRefusal();
      });

    if (widget !== null) {
      // Sync our mute states with the hosting client
      const widgetApiState$ = combineLatest(
        [this.audio.enabled$, this.video.enabled$],
        (audio, video) => ({ audio_enabled: audio, video_enabled: video }),
      );
      widgetApiState$.pipe(this.scope.bind()).subscribe((state) => {
        widget!.api.transport
          .send(ElementWidgetActions.DeviceMute, state)
          .catch((e) =>
            logger.warn("Could not send DeviceMute action to widget", e),
          );
      });

      // Also sync the hosting client's mute states back with ours
      const muteActions$ = fromEvent(
        widget.lazyActions,
        ElementWidgetActions.DeviceMute,
      ) as Observable<CustomEvent<IWidgetApiRequest>>;
      muteActions$
        .pipe(
          withLatestFrom(
            widgetApiState$,
            this.audio.setEnabled$,
            this.video.setEnabled$,
          ),
          this.scope.bind(),
        )
        .subscribe(([ev, state, setAudioEnabled, setVideoEnabled]) => {
          // First copy the current state into our new state
          const newState = { ...state };
          // Update new state if there are any requested changes from the widget
          // action in `ev.detail.data`.
          if (
            ev.detail.data.audio_enabled != null &&
            typeof ev.detail.data.audio_enabled === "boolean" &&
            setAudioEnabled !== null
          ) {
            newState.audio_enabled = ev.detail.data.audio_enabled;
            setAudioEnabled(newState.audio_enabled);
          }
          if (
            ev.detail.data.video_enabled != null &&
            typeof ev.detail.data.video_enabled === "boolean" &&
            setVideoEnabled !== null
          ) {
            newState.video_enabled = ev.detail.data.video_enabled;
            setVideoEnabled(newState.video_enabled);
          }
          widget!.api.transport.reply(ev.detail, newState);
        });
    }
  }
}
