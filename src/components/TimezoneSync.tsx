"use client";

import { useEffect } from "react";

/**
 * Silently keeps the account's stored timezone in sync with the browser's.
 * There's no onboarding step where a user sets this by hand, so without this
 * it stays stuck at the "UTC" default forever — which throws off anything
 * that has to resolve a wall-clock time server-side without a browser to ask,
 * namely screenshot import (Claude is told "the user's timezone is X").
 */
export default function TimezoneSync() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    fetch("/api/settings/timezone", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
    }).catch(() => {});
  }, []);

  return null;
}
