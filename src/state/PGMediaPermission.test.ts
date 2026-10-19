/*
Copyright 2026 Belgian Secure Communications (BSC)

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  pgMediaPermissionDenied$,
  pgQueryMediaPermissionState,
} from "./PGMediaPermission";
import { type ObservableScope } from "./ObservableScope";
import { flushPromises, testScope } from "../utils/test";

const originalPermissions = navigator.permissions;

afterEach(() => {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: originalPermissions,
  });
});

function stubPermissions(
  query:
    | ((descriptor: PermissionDescriptor) => Promise<PermissionStatus>)
    | undefined,
): void {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: query === undefined ? undefined : { query },
  });
}

function aPermissionStatus(state: PermissionState): PermissionStatus & {
  emitChange: (state: PermissionState) => void;
} {
  const listeners = new Set<() => void>();
  const status = {
    state,
    name: "",
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => false,
    emitChange(newState: PermissionState) {
      status.state = newState;
      listeners.forEach((l) => l());
    },
  };
  return status as unknown as PermissionStatus & {
    emitChange: (state: PermissionState) => void;
  };
}

describe("pgMediaPermissionDenied$", () => {
  let scope: ObservableScope;

  beforeEach(() => {
    scope = testScope();
  });

  test("is not denied when the Permissions API is unavailable", async () => {
    stubPermissions(undefined);
    const denied$ = pgMediaPermissionDenied$("microphone", scope);
    await flushPromises();
    expect(denied$.value).toBe(false);
  });

  test("is not denied when the permission cannot be queried", async () => {
    stubPermissions(async () => Promise.reject(new TypeError("unsupported")));
    const denied$ = pgMediaPermissionDenied$("camera", scope);
    await flushPromises();
    expect(denied$.value).toBe(false);
  });

  test("is not denied while still to be asked, e.g. for an absent camera", async () => {
    stubPermissions(
      async () => await Promise.resolve(aPermissionStatus("prompt")),
    );
    const denied$ = pgMediaPermissionDenied$("camera", scope);
    await flushPromises();
    expect(denied$.value).toBe(false);
  });

  test("follows permission state changes", async () => {
    const status = aPermissionStatus("granted");
    const query = vi.fn(async () => await Promise.resolve(status));
    stubPermissions(query);
    const denied$ = pgMediaPermissionDenied$("microphone", scope);
    await flushPromises();
    expect(query).toHaveBeenCalledWith({ name: "microphone" });
    expect(denied$.value).toBe(false);

    status.emitChange("denied");
    expect(denied$.value).toBe(true);

    status.emitChange("prompt");
    expect(denied$.value).toBe(false);
  });
});

describe("pgQueryMediaPermissionState", () => {
  test("returns the browser's state", async () => {
    stubPermissions(async () => Promise.resolve(aPermissionStatus("denied")));
    await expect(pgQueryMediaPermissionState("camera")).resolves.toBe("denied");
  });

  test("is unknown when the browser cannot tell", async () => {
    stubPermissions(async () => Promise.reject(new TypeError("unsupported")));
    await expect(pgQueryMediaPermissionState("camera")).resolves.toBe(
      "unknown",
    );
    stubPermissions(undefined);
    await expect(pgQueryMediaPermissionState("camera")).resolves.toBe(
      "unknown",
    );
  });
});
