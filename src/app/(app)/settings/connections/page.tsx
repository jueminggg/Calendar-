"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppleConnectModal from "./AppleConnectModal";

type Connection = {
  id: string;
  provider: "GOOGLE" | "MICROSOFT" | "APPLE";
  label: string;
  status: "ACTIVE" | "ERROR" | "DISCONNECTED";
  lastError: string | null;
  lastSyncAt: string | null;
  calendars: { id: string; name: string; enabled: boolean; color: string | null }[];
};

const PROVIDER_LABEL: Record<Connection["provider"], string> = {
  GOOGLE: "Google Calendar",
  MICROSOFT: "Outlook / Microsoft 365",
  APPLE: "iCloud",
};

function ConnectionsBanner() {
  const params = useSearchParams();
  const connected = params.get("connected");
  const error = params.get("error");
  if (!connected && !error) return null;
  return (
    <div
      className={`rounded-md px-3 py-2 text-sm mb-4 ${
        error
          ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
          : "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
      }`}
    >
      {error ? `Couldn't connect: ${error}` : `Connected ${connected} successfully.`}
    </div>
  );
}

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAppleModal, setShowAppleModal] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [externalWriteEnabled, setExternalWriteEnabled] = useState(true);
  const [syncToggleLoading, setSyncToggleLoading] = useState(true);
  const [syncToggleSaving, setSyncToggleSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/connections");
    if (res.ok) {
      const data = await res.json();
      setConnections(data.connections);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/settings/sync");
      if (res.ok) {
        const data = await res.json();
        setExternalWriteEnabled(data.externalWriteEnabled);
      }
      setSyncToggleLoading(false);
    })();
  }, []);

  async function toggleExternalWrite() {
    const next = !externalWriteEnabled;
    setSyncToggleSaving(true);
    setExternalWriteEnabled(next);
    try {
      const res = await fetch("/api/settings/sync", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalWriteEnabled: next }),
      });
      if (res.ok) {
        const data = await res.json();
        setExternalWriteEnabled(data.externalWriteEnabled);
      } else {
        setExternalWriteEnabled(!next);
      }
    } catch {
      setExternalWriteEnabled(!next);
    } finally {
      setSyncToggleSaving(false);
    }
  }

  async function syncNow(id: string) {
    setSyncingId(id);
    try {
      await fetch(`/api/connections/${id}/sync`, { method: "POST" });
      await load();
    } finally {
      setSyncingId(null);
    }
  }

  async function disconnect(id: string) {
    if (!confirm("Disconnect this calendar? Its synced events will be removed.")) return;
    await fetch(`/api/connections/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Connected calendars</h1>

      <Suspense>
        <ConnectionsBanner />
      </Suspense>

      <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 mb-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Two-way sync</p>
            <p className="text-sm text-gray-500 mt-0.5">
              {externalWriteEnabled
                ? "On — editing or deleting a synced event here also changes it on Google/Outlook/iCloud."
                : "Off — this app never writes to Google/Outlook/iCloud. Changes here only affect your own copy; changes made on those calendars still sync in."}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={externalWriteEnabled}
            disabled={syncToggleLoading || syncToggleSaving}
            onClick={toggleExternalWrite}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
              externalWriteEnabled ? "bg-pink-600" : "bg-gray-300 dark:bg-gray-700"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                externalWriteEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <a
          href="/api/connections/google/start"
          className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          + Connect Google
        </a>
        <a
          href="/api/connections/microsoft/start"
          className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          + Connect Outlook
        </a>
        <button
          onClick={() => setShowAppleModal(true)}
          className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          + Connect iCloud
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : connections.length === 0 ? (
        <p className="text-sm text-gray-500">No calendars connected yet.</p>
      ) : (
        <ul className="space-y-3">
          {connections.map((c) => (
            <li key={c.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{PROVIDER_LABEL[c.provider]}</p>
                  <p className="text-sm text-gray-500">{c.label}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {c.status === "ACTIVE" && c.lastSyncAt
                      ? `Last synced ${new Date(c.lastSyncAt).toLocaleString()}`
                      : c.status === "ERROR"
                        ? `Error: ${c.lastError}`
                        : "Not yet synced"}
                  </p>
                  {c.calendars.length > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      {c.calendars.length} calendar{c.calendars.length === 1 ? "" : "s"}:{" "}
                      {c.calendars.map((cal) => cal.name).join(", ")}
                    </p>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                    c.status === "ACTIVE"
                      ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                      : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                  }`}
                >
                  {c.status}
                </span>
              </div>
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => syncNow(c.id)}
                  disabled={syncingId === c.id}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  {syncingId === c.id ? "Syncing…" : "Sync now"}
                </button>
                <button onClick={() => disconnect(c.id)} className="text-sm text-red-600 dark:text-red-400 hover:underline">
                  Disconnect
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showAppleModal && (
        <AppleConnectModal
          onClose={() => setShowAppleModal(false)}
          onConnected={() => {
            setShowAppleModal(false);
            load();
          }}
        />
      )}
    </div>
  );
}
