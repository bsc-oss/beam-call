/*
Copyright 2026 Belgian Secure Communications (BSC)

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useCallback, useEffect, useState } from "react";
import { type TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Button, Text } from "@vector-im/compound-web";

import { Modal } from "../Modal";
import { useMediaQuery } from "../useMediaQuery";
import styles from "./PGMediaAccessModal.module.css";
import { type MediaDevices } from "../state/MediaDevices";
import { type PGMediaKind } from "../state/PGMediaAccess";
import { pgProductName } from "../utils/pgProductName";

interface Props {
  devices: MediaDevices;
}

/** The dialog's title, and the devices its description names. */
function blockedDevicesTexts(
  t: TFunction<"app", undefined>,
  deniedPermissionKinds: PGMediaKind[],
): { title: string; devices: string } {
  const includesMicrophone = deniedPermissionKinds.includes("microphone");
  const includesCamera = deniedPermissionKinds.includes("camera");
  if (includesMicrophone && includesCamera) {
    return {
      title: t("pg_media_access.title_both"),
      devices: t("pg_media_access.devices_both"),
    };
  }
  if (includesCamera) {
    return {
      title: t("pg_media_access.title_camera"),
      devices: t("pg_media_access.devices_camera"),
    };
  }
  return {
    title: t("pg_media_access.title_microphone"),
    devices: t("pg_media_access.devices_microphone"),
  };
}

/**
 * Tells the user that a microphone/camera request was just refused and how to
 * allow it. Browsers never ask again for a site the user has blocked, so the
 * only way out is the browser's site settings.
 *
 * Shown on the web only (see GroupCallView): the mobile apps handle a refusal
 * natively.
 *
 * It must stay usable when the web client shows the call picture-in-picture,
 * i.e. in a very small iframe: the header is then dropped and the dialog
 * scrolls within the viewport.
 */
export const PGMediaAccessModal: FC<Props> = ({ devices }) => {
  const { t } = useTranslation();
  // The devices named by the dialog: those refused since it opened. A
  // refusal arriving while it is open adds to it rather than replacing it:
  // when both devices are blocked, the lobby's request for both is followed
  // by one for the camera alone, and naming only the camera would hide the
  // microphone. Once closed, the dialog keeps naming them while it animates
  // out, and starts afresh on the next refusal.
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    deniedPermissionKinds: PGMediaKind[];
  }>({ isOpen: false, deniedPermissionKinds: [] });

  useEffect(() => {
    const subscription = devices.pgMediaRefusals.deniedPermissions$.subscribe(
      (deniedKinds) => {
        setDialog((previous) => ({
          isOpen: true,
          deniedPermissionKinds: previous.isOpen
            ? [...new Set([...previous.deniedPermissionKinds, ...deniedKinds])]
            : deniedKinds,
        }));
      },
    );
    return (): void => subscription.unsubscribe();
  }, [devices]);

  const onDismiss = useCallback(
    () => setDialog((previous) => ({ ...previous, isOpen: false })),
    [],
  );
  const isCompact = useMediaQuery("(max-height: 400px) or (max-width: 400px)");
  const texts = blockedDevicesTexts(t, dialog.deniedPermissionKinds);

  return (
    <Modal
      title={texts.title}
      open={dialog.isOpen}
      onDismiss={onDismiss}
      hideHeader={isCompact}
      classNameModal={isCompact ? styles.compact : undefined}
      classNameBody={styles.body}
    >
      <Text data-testid="pg_media_access_description" className={styles.text}>
        {t("pg_media_access.description", {
          brand: pgProductName,
          devices: texts.devices,
        })}
      </Text>
      <div className={styles.actions}>
        <Button
          onClick={onDismiss}
          className={styles.button}
          data-testid="pg_media_access_close"
        >
          {t("action.close")}
        </Button>
      </div>
    </Modal>
  );
};
