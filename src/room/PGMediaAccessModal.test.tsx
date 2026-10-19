/*
Copyright 2026 Belgian Secure Communications (BSC)

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Subject } from "rxjs";

import { PGMediaAccessModal } from "./PGMediaAccessModal";
import type * as ModalModule from "../Modal";
import { type PGMediaKind } from "../state/PGMediaAccess";
import { mockMediaDevices } from "../utils/test";
import { type MediaDevices } from "../state/MediaDevices";

// The props the dialog was last rendered with, open or not: once closed, it
// stays visible while it animates out, which the test DOM does not show.
const lastModalProps = vi.hoisted(
  () => ({}) as { current?: { open: boolean; title: string } },
);
vi.mock("../Modal", async (importOriginal) => {
  const original = await importOriginal<typeof ModalModule>();
  return {
    ...original,
    Modal: (props: ModalModule.Props): ReturnType<typeof original.Modal> => {
      lastModalProps.current = { open: props.open, title: props.title };
      return <original.Modal {...props} />;
    },
  };
});

describe("PGMediaAccessModal", () => {
  let deniedPermissions$: Subject<PGMediaKind[]>;
  let devices: MediaDevices;

  beforeEach(() => {
    deniedPermissions$ = new Subject();
    devices = mockMediaDevices({
      pgMediaRefusals: {
        deniedPermissions$,
      } as unknown as MediaDevices["pgMediaRefusals"],
    });
  });

  it("is hidden until a request is refused", () => {
    render(<PGMediaAccessModal devices={devices} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on a refusal, names the devices, and can be closed", async () => {
    const user = userEvent.setup();
    render(<PGMediaAccessModal devices={devices} />);

    act(() => deniedPermissions$.next(["microphone", "camera"]));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "Microphone and camera blocked",
    );
    expect(screen.getByTestId("pg_media_access_description")).toHaveTextContent(
      "your microphone and camera",
    );
    expect(screen.getByTestId("pg_media_access_description")).toHaveTextContent(
      "browser's site settings",
    );

    await user.click(screen.getByTestId("pg_media_access_close"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog usable in a tiny viewport, such as picture-in-picture", () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("max-height: 400px"),
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as Partial<MediaQueryList> as MediaQueryList,
    );
    render(<PGMediaAccessModal devices={devices} />);
    act(() => deniedPermissions$.next(["camera"]));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeVisible();
    // the title stays available for assistive technology
    expect(dialog).toHaveAccessibleName("Camera blocked");
    expect(dialog.className).toContain("compact");
    matchMedia.mockRestore();
  });

  it("keeps naming the same device while it closes", async () => {
    const user = userEvent.setup();
    render(<PGMediaAccessModal devices={devices} />);

    act(() => deniedPermissions$.next(["camera"]));
    expect(lastModalProps.current).toEqual({
      open: true,
      title: "Camera blocked",
    });

    await user.click(screen.getByTestId("pg_media_access_close"));
    expect(lastModalProps.current).toEqual({
      open: false,
      title: "Camera blocked",
    });
  });

  it("adds a refusal arriving while it is open, and starts afresh once closed", async () => {
    const user = userEvent.setup();
    render(<PGMediaAccessModal devices={devices} />);

    act(() => deniedPermissions$.next(["microphone", "camera"]));
    act(() => deniedPermissions$.next(["camera"]));
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "Microphone and camera blocked",
    );

    await user.click(screen.getByTestId("pg_media_access_close"));
    act(() => deniedPermissions$.next(["camera"]));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Camera blocked");
  });

  it("names only the microphone when only its permission is denied", () => {
    render(<PGMediaAccessModal devices={devices} />);
    act(() => deniedPermissions$.next(["microphone"]));
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "Microphone blocked",
    );
    expect(screen.getByTestId("pg_media_access_description")).toHaveTextContent(
      "has no access to your microphone.",
    );
  });
});
