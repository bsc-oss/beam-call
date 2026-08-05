/*
Copyright 2026 Belgian Secure Communications (BSC)
Copyright 2021-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.

Modified by Belgian Secure Communications for Beam application on 2026-02-06
*/

import {
  type FC,
  type JSX,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { BrowserRouter, Route, useLocation, Routes } from "react-router-dom";
import * as Sentry from "@sentry/react";
// PG_CHANGED: InlineSpinner
import { TooltipProvider, InlineSpinner } from "@vector-im/compound-web";
import { logger } from "matrix-js-sdk/lib/logger";

import { HomePage } from "./home/HomePage";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { RoomPage } from "./room/RoomPage";
import { ClientProvider } from "./ClientContext";
// PG_CHANGED: FullScreenView
import { ErrorPage, FullScreenView, LoadingPage } from "./FullScreenView";
import { Initializer } from "./initializer";
import { widget } from "./widget";
import { useTheme } from "./useTheme";
import { ProcessorProvider } from "./livekit/TrackProcessorContext";
import { type AppViewModel } from "./state/AppViewModel";
import { MediaDevicesContext } from "./MediaDevicesContext";
import { getUrlParams, HeaderStyle } from "./UrlParams";
import { AppBar } from "./AppBar";

const SentryRoute = Sentry.withSentryReactRouterV7Routing(Route);

interface SimpleProviderProps {
  children: JSX.Element;
}

const BackgroundProvider: FC<SimpleProviderProps> = ({ children }) => {
  const { pathname } = useLocation();

  useEffect(() => {
    let backgroundImage = "";
    if (!["/login", "/register"].includes(pathname) && !widget) {
      backgroundImage = "var(--background-gradient)";
    }

    document.getElementsByTagName("body")[0].style.backgroundImage =
      backgroundImage;
  }, [pathname]);

  return <>{children}</>;
};
const ThemeProvider: FC<SimpleProviderProps> = ({ children }) => {
  useTheme();
  return children;
};

interface Props {
  vm: AppViewModel;
}

export const App: FC<Props> = ({ vm }) => {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    Initializer.init()
      ?.then(async () => {
        if (loaded) return;
        setLoaded(true);
        await widget?.api.sendContentLoaded();
      })
      .catch(logger.error);
  });

  // Since we are outside the router component, we cannot use useUrlParams here
  const { header } = useMemo(getUrlParams, []);

  const content = loaded ? (
    <ClientProvider>
      <MediaDevicesContext value={vm.mediaDevices}>
        <ProcessorProvider>
          <Sentry.ErrorBoundary
            fallback={(error) => <ErrorPage error={error} widget={widget} />}
          >
            <Routes>
              <SentryRoute path="/" element={<HomePage />} />
              <SentryRoute path="/login" element={<LoginPage />} />
              <SentryRoute path="/register" element={<RegisterPage />} />
              <SentryRoute path="*" element={<RoomPage />} />
            </Routes>
          </Sentry.ErrorBoundary>
        </ProcessorProvider>
      </MediaDevicesContext>
    </ClientProvider>
  ) : (
    <LoadingPage />
  );

  return (
    <BrowserRouter>
      <BackgroundProvider>
        <ThemeProvider>
          <TooltipProvider>
            {/* PG_CHANGED: show loading indicator instead of whtie screen */}
            <Suspense
              fallback={
                <FullScreenView>
                  <InlineSpinner size={48} />
                </FullScreenView>
              }
            >
              {header === HeaderStyle.AppBar ? (
                <AppBar>{content}</AppBar>
              ) : (
                content
              )}
            </Suspense>
          </TooltipProvider>
        </ThemeProvider>
      </BackgroundProvider>
    </BrowserRouter>
  );
};
