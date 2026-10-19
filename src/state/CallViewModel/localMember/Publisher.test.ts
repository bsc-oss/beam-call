/*
Copyright 2026 Belgian Secure Communications (BSC)
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.

Modified by Belgian Secure Communications for Beam application on 2026-10-06
*/

import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import {
  ConnectionState as LivekitConnectionState,
  type LocalAudioTrack, // PG_CHANGED
  LocalParticipant,
  type LocalTrack,
  type LocalTrackPublication,
  ParticipantEvent,
  Track,
} from "livekit-client";
import { BehaviorSubject, Subject } from "rxjs"; // PG_CHANGED: Subject
import { logger } from "matrix-js-sdk/lib/logger";

import { ObservableScope } from "../../ObservableScope";
import { constant } from "../../Behavior";
import {
  flushPromises,
  mockLivekitRoom,
  mockMediaDevices,
} from "../../../utils/test";
import { Publisher } from "./Publisher";
import { type Connection } from "../remoteMembers/Connection";
import { type MuteStates } from "../../MuteStates";

let scope: ObservableScope;

beforeEach(() => {
  scope = new ObservableScope();
});

afterEach(() => scope.end());

function createMockLocalTrack(source: Track.Source): LocalTrack {
  const track = {
    source,
    isMuted: false,
    isUpstreamPaused: false,
  } as Partial<LocalTrack> as LocalTrack;

  vi.mocked(track).mute = vi.fn().mockImplementation(() => {
    track.isMuted = true;
  });
  vi.mocked(track).unmute = vi.fn().mockImplementation(() => {
    track.isMuted = false;
  });
  vi.mocked(track).pauseUpstream = vi.fn().mockImplementation(() => {
    // @ts-expect-error - for that test we want to set isUpstreamPaused directly
    track.isUpstreamPaused = true;
  });
  vi.mocked(track).resumeUpstream = vi.fn().mockImplementation(() => {
    // @ts-expect-error - for that test we want to set isUpstreamPaused directly
    track.isUpstreamPaused = false;
  });

  return track;
}

function createMockMuteState(enabled$: BehaviorSubject<boolean>): {
  enabled$: BehaviorSubject<boolean>;
  syncing$: BehaviorSubject<boolean>;
  pgUnmuteRequested$: Subject<void>; // PG_CHANGED
  setHandler: (h: (enabled: boolean) => void) => void;
  unsetHandler: () => void;
} {
  let currentHandler = (enabled: boolean): void => {};

  const ms = {
    enabled$,
    syncing$: new BehaviorSubject(false),
    pgUnmuteRequested$: new Subject<void>(), // PG_CHANGED
    setHandler: vi.fn().mockImplementation((h: (enabled: boolean) => void) => {
      currentHandler = h;
    }),
    unsetHandler: vi.fn().mockImplementation(() => {
      currentHandler = (enabled: boolean): void => {};
    }),
  };
  // forward enabled$ emissions to the current handler
  enabled$.subscribe((enabled) => {
    logger.info(`MockMuteState: enabled changed to ${enabled}`);
    currentHandler(enabled);
  });

  return ms;
}

// PG_CHANGED: the early microphone track is a mobile feature
const platformMock = vi.hoisted(() => vi.fn(() => "android"));
vi.mock("../../../Platform", () => ({
  get platform(): string {
    return platformMock();
  },
}));

// PG_CHANGED: the early microphone track, created by MediaDevices
function mockDevicesWithEarlyMicrophoneTrack(): ReturnType<
  typeof mockMediaDevices
> {
  return mockMediaDevices({
    getLocalMicrophoneTrack: vi.fn(async () =>
      Promise.resolve(
        createMockLocalTrack(Track.Source.Microphone) as LocalAudioTrack,
      ),
    ),
  });
}

let connection: Connection;
let muteStates: MuteStates;
let localParticipant: LocalParticipant;
let audioEnabled$: BehaviorSubject<boolean>;
let audioUnmuteRequested$: Subject<void>; // PG_CHANGED
let videoEnabled$: BehaviorSubject<boolean>;
let trackPublications: LocalTrackPublication[];
// use it to control when track creation resolves, default to resolved
let createTrackLock: Promise<void>;

beforeEach(() => {
  platformMock.mockReturnValue("android"); // PG_CHANGED
  trackPublications = [];
  audioEnabled$ = new BehaviorSubject(false);
  videoEnabled$ = new BehaviorSubject(false);
  createTrackLock = Promise.resolve();

  const audioMuteState = createMockMuteState(audioEnabled$); // PG_CHANGED
  audioUnmuteRequested$ = audioMuteState.pgUnmuteRequested$; // PG_CHANGED
  muteStates = {
    audio: audioMuteState, // PG_CHANGED
    video: createMockMuteState(videoEnabled$),
  } as unknown as MuteStates;

  const mockSendDataPacket = vi.fn();
  const mockEngine = {
    client: {
      sendUpdateLocalMetadata: vi.fn(),
    },
    on: vi.fn().mockReturnThis(),
    sendDataPacket: mockSendDataPacket,
  };

  localParticipant = new LocalParticipant(
    "local-sid",
    "local-identity",
    // @ts-expect-error - for that test we want a real LocalParticipant to have the pending publications logic
    mockEngine,
    {
      adaptiveStream: true,
      dynacase: false,
      audioCaptureDefaults: {},
      videoCaptureDefaults: {},
      stopLocalTrackOnUnpublish: true,
      reconnectPolicy: "always",
      disconnectOnPageLeave: true,
    },
    new Map(),
    {},
    {},
    {},
  );

  vi.mocked(localParticipant).createTracks = vi
    .fn()
    .mockImplementation(async (opts) => {
      const tracks: LocalTrack[] = [];
      if (opts.audio) {
        tracks.push(createMockLocalTrack(Track.Source.Microphone));
      }
      if (opts.video) {
        tracks.push(createMockLocalTrack(Track.Source.Camera));
      }
      await createTrackLock;
      return tracks;
    });

  vi.mocked(localParticipant).publishTrack = vi
    .fn()
    .mockImplementation(async (track: LocalTrack) => {
      const pub = {
        track,
        source: track.source,
        mute: track.mute,
        unmute: track.unmute,
      } as Partial<LocalTrackPublication> as LocalTrackPublication;
      trackPublications.push(pub);
      localParticipant.emit(ParticipantEvent.LocalTrackPublished, pub);
      return Promise.resolve(pub);
    });

  vi.mocked(localParticipant).getTrackPublication = vi
    .fn()
    .mockImplementation((source: Track.Source) => {
      return trackPublications.find((pub) => pub.track?.source === source);
    });

  connection = {
    state$: constant({
      state: "ConnectedToLkRoom",
      livekitConnectionState$: constant(LivekitConnectionState.Connected),
    }),
    livekitRoom: mockLivekitRoom({
      localParticipant: localParticipant,
    }),
  } as unknown as Connection;
});

describe("Publisher", () => {
  let publisher: Publisher;
  let devices: ReturnType<typeof mockMediaDevices>; // PG_CHANGED

  beforeEach(() => {
    devices = mockDevicesWithEarlyMicrophoneTrack(); // PG_CHANGED
    publisher = new Publisher(
      connection,
      devices,
      muteStates,
      constant({ supported: false, processor: undefined }),
      logger,
    );
  });

  afterEach(async () => {
    await publisher.destroy();
  });

  it("Should not create tracks if started muted to avoid unneeded permission requests", async () => {
    const createTracksSpy = vi.spyOn(
      connection.livekitRoom.localParticipant,
      "createTracks",
    );

    audioEnabled$.next(false);
    videoEnabled$.next(false);
    await publisher.createAndSetupTracks();

    expect(createTracksSpy).not.toHaveBeenCalled();
  });

  it("should unsetHandler and stop tracks on destroy", async () => {
    // setup all spies
    const unsetVideoSpy = vi.spyOn(
      (
        publisher as unknown as {
          muteStates: { video: { unsetHandler: () => void } };
        }
      ).muteStates.video,
      "unsetHandler",
    );
    const unsetAudioSpy = vi.spyOn(
      (
        publisher as unknown as {
          muteStates: { audio: { unsetHandler: () => void } };
        }
      ).muteStates.audio,
      "unsetHandler",
    );
    const scopeEndSpy = vi.spyOn(
      (publisher as unknown as { scope: { end: () => void } }).scope,
      "end",
    );
    const stopTracksSpy = vi.spyOn(publisher, "stopTracks");
    // destroy publisher
    await publisher.destroy();

    expect(stopTracksSpy).toHaveBeenCalledOnce();
    expect(unsetVideoSpy).toHaveBeenCalledOnce();
    expect(unsetAudioSpy).toHaveBeenCalledOnce();
    expect(scopeEndSpy).toHaveBeenCalled();
  });

  // PG_CHANGED: upstream requested camera and microphone at once for a single
  // prompt; we publish the early microphone track instead, so LiveKit
  // must never request the microphone itself here.
  it("Should publish the early microphone track instead of requesting the microphone again", async () => {
    const enableCameraAndMicrophoneSpy = vi.spyOn(
      localParticipant,
      "enableCameraAndMicrophone",
    );
    const createTracksSpy = vi.spyOn(localParticipant, "createTracks");
    const publishTrackSpy = vi.spyOn(localParticipant, "publishTrack");

    audioEnabled$.next(true);
    videoEnabled$.next(true);
    await publisher.createAndSetupTracks();
    await flushPromises();

    expect(enableCameraAndMicrophoneSpy).not.toHaveBeenCalled();
    expect(publishTrackSpy).toHaveBeenCalledWith(
      expect.objectContaining({ source: Track.Source.Microphone }),
      { source: Track.Source.Microphone },
    );
    // Only the camera is created by LiveKit
    expect(createTracksSpy).toHaveBeenCalledTimes(1);
    expect(createTracksSpy).toHaveBeenCalledWith(
      expect.objectContaining({ video: expect.anything() }),
    );
    expect(createTracksSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ audio: expect.anything() }),
    );
  });

  // PG_CHANGED: the early track is created at page load, possibly before the
  // device or the audio settings were known
  it("Should bring the early microphone track up to date before publishing it", async () => {
    const order: string[] = [];
    vi.spyOn(
      devices,
      "pgApplyAudioSettingsToMicrophoneTrack",
    ).mockImplementation(async () => {
      order.push("update");
      return Promise.resolve();
    });
    vi.spyOn(localParticipant, "publishTrack").mockImplementation(async () => {
      order.push("publish");
      return Promise.resolve({} as LocalTrackPublication);
    });

    audioEnabled$.next(true);
    await publisher.createAndSetupTracks();
    await flushPromises();

    expect(devices.pgApplyAudioSettingsToMicrophoneTrack).toHaveBeenCalledWith(
      expect.objectContaining({ source: Track.Source.Microphone }),
    );
    expect(order).toEqual(["update", "publish"]);
  });

  // PG_CHANGED: unmuting after joining muted must not let LiveKit capture
  // the microphone a second time, next to the early track
  it("Should publish the early microphone track when unmuting after joining muted", async () => {
    const createTracksSpy = vi.spyOn(localParticipant, "createTracks");
    const publishTrackSpy = vi.spyOn(localParticipant, "publishTrack");

    await publisher.createAndSetupTracks();
    await flushPromises();
    expect(publishTrackSpy).not.toHaveBeenCalled();

    // The user unmutes: the mute state signals the request, then starts it
    audioUnmuteRequested$.next();
    audioEnabled$.next(true);
    await flushPromises();

    expect(devices.getLocalMicrophoneTrack).toHaveBeenCalledWith({
      retryIfRefused: true,
    });
    expect(publishTrackSpy).toHaveBeenCalledOnce();
    expect(publishTrackSpy).toHaveBeenCalledWith(
      expect.objectContaining({ source: Track.Source.Microphone }),
      { source: Track.Source.Microphone },
    );
    expect(createTracksSpy).not.toHaveBeenCalled();
  });

  // PG_CHANGED: the mute state also turns the microphone on by itself (e.g.
  // when the devices appear); only an explicit unmute may ask again for a
  // refused microphone
  it("Should not ask again for a refused microphone when the mute state starts it by itself", async () => {
    await publisher.createAndSetupTracks();
    await flushPromises();

    audioEnabled$.next(true);
    await flushPromises();

    expect(devices.getLocalMicrophoneTrack).toHaveBeenCalledWith({
      retryIfRefused: false,
    });
  });

  // PG_CHANGED: an unmute request only counts for the enable that follows it
  it("Should ask again for a refused microphone only once per unmute request", async () => {
    const devices = mockMediaDevices({
      getLocalMicrophoneTrack: vi.fn(async () =>
        Promise.reject(
          new DOMException("Permission denied", "NotAllowedError"),
        ),
      ),
    });
    publisher = new Publisher(
      connection,
      devices,
      muteStates,
      constant({ supported: true, processor: undefined }),
      logger,
    );
    await publisher.createAndSetupTracks();
    await flushPromises();

    // The user unmutes, is refused again, mutes, and the mute state later
    // turns the microphone on by itself
    audioUnmuteRequested$.next();
    audioEnabled$.next(true);
    await flushPromises();
    audioEnabled$.next(false);
    await flushPromises();
    audioEnabled$.next(true);
    await flushPromises();

    expect(
      vi
        .mocked(devices.getLocalMicrophoneTrack)
        .mock.calls.map(([options]) => options),
    ).toEqual([{ retryIfRefused: true }, { retryIfRefused: false }]);
  });

  // PG_CHANGED: LiveKit accepts a second track for the same source
  it("Should publish a single microphone track when unmuting while the early track is being published", async () => {
    let resolveTrack!: (track: LocalAudioTrack) => void;
    vi.mocked(devices.getLocalMicrophoneTrack).mockImplementation(
      async () =>
        new Promise((resolve) => {
          resolveTrack = resolve;
        }),
    );
    const createTracksSpy = vi.spyOn(localParticipant, "createTracks");
    const publishTrackSpy = vi.spyOn(localParticipant, "publishTrack");

    audioEnabled$.next(true);
    await publisher.createAndSetupTracks();
    await flushPromises();
    // The user mutes and unmutes before the early track is there
    audioEnabled$.next(false);
    audioEnabled$.next(true);
    await flushPromises();
    resolveTrack(
      createMockLocalTrack(Track.Source.Microphone) as LocalAudioTrack,
    );
    await flushPromises();

    expect(publishTrackSpy).toHaveBeenCalledOnce();
    expect(devices.getLocalMicrophoneTrack).toHaveBeenCalledOnce();
    expect(createTracksSpy).not.toHaveBeenCalled();
  });

  // PG_CHANGED: the room only forwards this event once connected, so the
  // publisher must listen at the participant level itself
  it("Should report a device error, even before the room is connected", () => {
    const reportIfRefused = vi.spyOn(
      devices.pgMediaRefusals,
      "reportIfRefused",
    );
    const refused = new DOMException("Permission denied", "NotAllowedError");

    localParticipant.emit(
      ParticipantEvent.MediaDevicesError,
      refused,
      "audioinput",
    );
    expect(reportIfRefused).toHaveBeenCalledWith(refused, ["microphone"]);

    localParticipant.emit(
      ParticipantEvent.MediaDevicesError,
      refused,
      "videoinput",
    );
    expect(reportIfRefused).toHaveBeenLastCalledWith(refused, ["camera"]);
  });

  // PG_CHANGED: on the web there is no early track, upstream behaviour applies
  describe("on desktop", () => {
    beforeEach(() => {
      platformMock.mockReturnValue("desktop");
    });

    it("Should minimize permission request by querying create at once", async () => {
      const enableCameraAndMicrophoneSpy = vi.spyOn(
        localParticipant,
        "enableCameraAndMicrophone",
      );
      const createTracksSpy = vi.spyOn(localParticipant, "createTracks");

      audioEnabled$.next(true);
      videoEnabled$.next(true);
      await publisher.createAndSetupTracks();
      await flushPromises();

      expect(enableCameraAndMicrophoneSpy).toHaveBeenCalled();
      expect(createTracksSpy).toHaveBeenCalledWith({
        audio: true,
        video: true,
      });
    });

    // PG_CHANGED: this LiveKit call does not emit MediaDevicesError
    it("Should report both devices when the combined request fails", async () => {
      const refused = new DOMException("Permission denied", "NotAllowedError");
      vi.spyOn(localParticipant, "enableCameraAndMicrophone").mockRejectedValue(
        refused,
      );
      const reportIfRefused = vi.spyOn(
        devices.pgMediaRefusals,
        "reportIfRefused",
      );

      audioEnabled$.next(true);
      videoEnabled$.next(true);
      await publisher.createAndSetupTracks();
      await flushPromises();

      expect(reportIfRefused).toHaveBeenCalledWith(refused, [
        "microphone",
        "camera",
      ]);
    });
  });

  // PG_CHANGED
  it("Should not ask LiveKit for the microphone when its permission was refused", async () => {
    const devices = mockMediaDevices({
      getLocalMicrophoneTrack: vi.fn(async () =>
        Promise.reject(
          new DOMException("Permission denied", "NotAllowedError"),
        ),
      ),
    });
    publisher = new Publisher(
      connection,
      devices,
      muteStates,
      constant({ supported: true, processor: undefined }),
      logger,
    );
    const createTracksSpy = vi.spyOn(localParticipant, "createTracks");

    audioEnabled$.next(true);
    videoEnabled$.next(true);
    await publisher.createAndSetupTracks();
    await flushPromises();

    expect(createTracksSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ audio: expect.anything() }),
    );
  });

  // PG_CHANGED
  // PG_CHANGED: asked from within its own "failed to start" event, LiveKit
  // would wait 10 s for the publication that just failed
  it("Should not ask LiveKit to turn off a device that never started", async () => {
    const publisher = new Publisher(
      connection,
      mockDevicesWithEarlyMicrophoneTrack(),
      muteStates,
      constant({ supported: false, processor: undefined }),
      logger,
    );
    await publisher.createAndSetupTracks();
    await flushPromises();
    const setCameraEnabled = vi.spyOn(localParticipant, "setCameraEnabled");
    const setMicrophoneEnabled = vi.spyOn(
      localParticipant,
      "setMicrophoneEnabled",
    );
    platformMock.mockReturnValue("desktop");

    // e.g. their permission was refused, so no track was published
    videoEnabled$.next(false);
    audioEnabled$.next(false);
    await flushPromises();

    expect(setCameraEnabled).not.toHaveBeenCalled();
    expect(setMicrophoneEnabled).not.toHaveBeenCalled();
    await publisher.destroy();
  });

  it("Should fall back to LiveKit's microphone creation when the early track fails otherwise", async () => {
    const devices = mockMediaDevices({
      getLocalMicrophoneTrack: vi.fn(async () =>
        Promise.reject(new DOMException("Device busy", "NotReadableError")),
      ),
    });
    publisher = new Publisher(
      connection,
      devices,
      muteStates,
      constant({ supported: true, processor: undefined }),
      logger,
    );
    const createTracksSpy = vi.spyOn(localParticipant, "createTracks");

    audioEnabled$.next(true);
    await publisher.createAndSetupTracks();
    await flushPromises();

    expect(audioEnabled$.value).toBe(true);
    expect(createTracksSpy).toHaveBeenCalledWith(
      expect.objectContaining({ audio: expect.anything() }),
    );
  });

  it("Ensure no data is streamed until publish has been called", async () => {
    audioEnabled$.next(true);
    await publisher.createAndSetupTracks();

    // PG_CHANGED: the early track should be published (not created by
    // LiveKit) and paused
    await flushPromises();
    expect(localParticipant.createTracks).not.toHaveBeenCalled();
    expect(localParticipant.publishTrack).toHaveBeenCalled();

    await flushPromises();
    const track = localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
    expect(track).toBeDefined();
    expect(track!.pauseUpstream).toHaveBeenCalled();
    expect(track!.isUpstreamPaused).toBe(true);
  });

  it("Ensure resume upstream when published is called", async () => {
    videoEnabled$.next(true);
    await publisher.createAndSetupTracks();
    // await flushPromises();
    await publisher.startPublishing();

    const track = localParticipant.getTrackPublication(
      Track.Source.Camera,
    )?.track;
    expect(track).toBeDefined();
    // expect(track.pauseUpstream).toHaveBeenCalled();
    expect(track!.isUpstreamPaused).toBe(false);
  });

  describe("Mute states", () => {
    let publisher: Publisher;
    beforeEach(() => {
      publisher = new Publisher(
        connection,
        mockDevicesWithEarlyMicrophoneTrack(), // PG_CHANGED
        muteStates,
        constant({ supported: false, processor: undefined }),
        logger,
      );
    });
    afterEach(async () => {
      await publisher.destroy();
    });

    // PG_CHANGED: the early microphone track is published as is,
    // so LiveKit only ever creates the camera track.
    test.each([
      { mutes: { audioEnabled: true, videoEnabled: false } },
      { mutes: { audioEnabled: false, videoEnabled: true } },
      { mutes: { audioEnabled: false, videoEnabled: false } },
    ])("only create the tracks that are unmuted $mutes", async ({ mutes }) => {
      audioEnabled$.next(mutes.audioEnabled);
      videoEnabled$.next(mutes.videoEnabled);

      vi.mocked(connection.livekitRoom.localParticipant).createTracks = vi
        .fn()
        .mockResolvedValue([]);
      const publishTrackSpy = vi.spyOn(localParticipant, "publishTrack");

      await publisher.createAndSetupTracks();
      await flushPromises();

      if (mutes.videoEnabled) {
        expect(
          connection.livekitRoom.localParticipant.createTracks,
        ).toHaveBeenCalledOnce();
        expect(
          connection.livekitRoom.localParticipant.createTracks,
        ).toHaveBeenCalledWith({ audio: undefined, video: true });
      } else {
        expect(
          connection.livekitRoom.localParticipant.createTracks,
        ).not.toHaveBeenCalled();
      }
      if (mutes.audioEnabled) {
        expect(publishTrackSpy).toHaveBeenCalledWith(
          expect.objectContaining({ source: Track.Source.Microphone }),
          { source: Track.Source.Microphone },
        );
      } else {
        expect(publishTrackSpy).not.toHaveBeenCalled();
      }
    });
  });

  it("does mute unmute audio", async () => {});
});

describe("Bug fix", () => {
  // There is a race condition when creating and publishing tracks while the mute state changes.
  // This race condition could cause tracks to be published even though they are muted at the
  // beginning of a call coming from lobby.
  // This is caused by our stack using manually the low level API to create and publish tracks,
  // but also using the higher level setMicrophoneEnabled and setCameraEnabled functions that also create
  // and publish tracks, and managing pending publications.
  // Race is as follow, on creation of the Publisher we create the tracks then publish them.
  // If in the middle of that process the mute state changes:
  //  - the `setMicrophoneEnabled` will be no-op because it is not aware of our created track and can't see any pending publication
  //  - If start publication is requested it will publish the track even though there was a mute request.
  it("wrongly publish tracks while muted", async () => {
    // setLogLevel(`debug`);
    const publisher = new Publisher(
      connection,
      mockDevicesWithEarlyMicrophoneTrack(), // PG_CHANGED
      muteStates,
      constant({ supported: false, processor: undefined }),
      logger,
    );
    audioEnabled$.next(true);

    const resolvers = Promise.withResolvers<void>();
    createTrackLock = resolvers.promise;

    // Initially the audio is unmuted, so creating tracks should publish the audio track
    const createTracks = publisher.createAndSetupTracks();
    void publisher.startPublishing();
    void createTracks.then(() => {
      void publisher.startPublishing();
    });
    // now mute the audio before allowing track creation to complete
    audioEnabled$.next(false);
    resolvers.resolve(undefined);
    await createTracks;

    await flushPromises();

    const track = localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
    expect(track).toBeDefined();

    try {
      expect(localParticipant.publishTrack).not.toHaveBeenCalled();
    } catch {
      expect(track!.mute).toHaveBeenCalled();
      expect(track!.isMuted).toBe(true);
    }
    await publisher.destroy();
  });

  // PG_CHANGED: when camera starts OFF, toggling it ON should not be
  // reverted by onLocalTrackPublished reading a stale enabled$.value.
  // Previously, onLocalTrackPublished would re-apply enabled$.value (still
  // false) before the MuteState handler returned, undoing the enable.
  it("first camera toggle from OFF should actually enable the camera", async () => {
    // Start with video disabled
    videoEnabled$.next(false);

    const publisher = new Publisher(
      connection,
      mockDevicesWithEarlyMicrophoneTrack(), // PG_CHANGED
      muteStates,
      constant({ supported: false, processor: undefined }),
      logger,
    );
    await publisher.createAndSetupTracks();
    await publisher.startPublishing();
    await flushPromises();

    // No camera track should exist yet
    expect(
      localParticipant.getTrackPublication(Track.Source.Camera),
    ).toBeUndefined();

    // Simulate toggling video ON (the user clicks the camera button)
    videoEnabled$.next(true);
    await flushPromises();

    // A camera track should now be published and NOT re-disabled
    const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera);
    expect(cameraPub).toBeDefined();
    expect(cameraPub!.track).toBeDefined();
    // The track should not have been muted by a stale re-sync
    expect(cameraPub!.track!.isMuted).toBe(false);

    await publisher.destroy();
  });
});
