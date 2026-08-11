"use client";

import { useState } from "react";

export default function AppleConnectModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [username, setUsername] = useState("");
  const [appSpecificPassword, setAppSpecificPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/connections/apple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, appSpecificPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      onConnected();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-gray-900 shadow-xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Connect iCloud</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            &times;
          </button>
        </div>

        <p className="text-xs text-gray-500">
          Apple doesn&apos;t support signing in with your regular Apple ID password here. Generate an{" "}
          <span className="font-medium">app-specific password</span> at{" "}
          <span className="font-mono">appleid.apple.com</span> → Sign-In and Security → App-Specific Passwords, and use
          it below.
        </p>

        {error && (
          <div className="rounded-md bg-red-50 text-red-700 text-sm px-3 py-2 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium">iCloud email</label>
          <input
            type="email"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">App-specific password</label>
          <input
            type="password"
            required
            placeholder="xxxx-xxxx-xxxx-xxxx"
            value={appSpecificPassword}
            onChange={(e) => setAppSpecificPassword(e.target.value)}
            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-md bg-pink-600 text-white hover:bg-pink-700 dark:bg-pink-600 dark:hover:bg-pink-700 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Connecting…" : "Connect"}
        </button>
      </form>
    </div>
  );
}
