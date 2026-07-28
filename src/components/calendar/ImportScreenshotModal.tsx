"use client";

import { useRef, useState } from "react";

type Draft = {
  include: boolean;
  title: string;
  location: string;
  description: string;
  allDay: boolean;
  start: string; // datetime-local value
  end: string; // datetime-local value
};

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ImportScreenshotModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  async function parseFile(file: File) {
    setError(null);
    setParsing(true);
    setDrafts(null);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/events/import-screenshot", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setDrafts(
        data.events.map(
          (e: { title: string; description?: string; location?: string; startAt: string; endAt: string; allDay: boolean }) => ({
            include: true,
            title: e.title,
            location: e.location ?? "",
            description: e.description ?? "",
            allDay: e.allDay,
            start: toLocalInputValue(e.startAt),
            end: toLocalInputValue(e.endAt),
          }),
        ),
      );
    } finally {
      setParsing(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const file = Array.from(e.clipboardData.items)
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
    if (file) parseFile(file);
  }

  function updateDraft(index: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev && prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function removeDraft(index: number) {
    setDrafts((prev) => prev && prev.filter((_, i) => i !== index));
  }

  async function handleImport() {
    if (!drafts) return;
    const selected = drafts.filter((d) => d.include);
    if (selected.length === 0) {
      setError("Select at least one event to import");
      return;
    }
    setError(null);
    setImporting(true);
    try {
      const res = await fetch("/api/events/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: selected.map((d) => ({
            title: d.title.trim(),
            description: d.description || undefined,
            location: d.location || undefined,
            startAt: new Date(d.start).toISOString(),
            endAt: new Date(d.end).toISOString(),
            allDay: d.allDay,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      onImported();
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-gray-900 shadow-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
        onPaste={handlePaste}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Import from screenshot</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            &times;
          </button>
        </div>

        <p className="text-xs text-gray-500">
          Upload or paste a screenshot of any calendar (e.g. a work Outlook calendar you can&apos;t connect directly).
          Claude will read the events out of the image, then you can review and edit them before adding.
        </p>

        {error && (
          <div className="rounded-md bg-red-50 text-red-700 text-sm px-3 py-2 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {!drafts && (
          <div
            className="rounded-md border-2 border-dashed border-gray-300 dark:border-gray-700 p-6 text-center cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            tabIndex={0}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            {parsing ? (
              <p className="text-sm text-gray-500">Reading events from the screenshot…</p>
            ) : (
              <p className="text-sm text-gray-500">
                Click to choose an image, or paste one (⌘V / Ctrl+V) anywhere in this dialog.
              </p>
            )}
          </div>
        )}

        {drafts && drafts.length === 0 && (
          <p className="text-sm text-gray-500">No events left to import.</p>
        )}

        {drafts && drafts.length > 0 && (
          <div className="space-y-3">
            {drafts.map((d, i) => (
              <div key={i} className="rounded-md border border-gray-200 dark:border-gray-800 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={d.include}
                    onChange={(e) => updateDraft(i, { include: e.target.checked })}
                    className="mt-2"
                  />
                  <input
                    value={d.title}
                    onChange={(e) => updateDraft(i, { title: e.target.value })}
                    placeholder="Title"
                    className="flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm font-medium"
                  />
                  <button
                    onClick={() => removeDraft(i)}
                    className="text-gray-400 hover:text-red-500 text-sm px-1"
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 pl-6">
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={d.allDay}
                      onChange={(e) => updateDraft(i, { allDay: e.target.checked })}
                    />
                    All day
                  </label>
                  <input
                    type={d.allDay ? "date" : "datetime-local"}
                    value={d.allDay ? d.start.slice(0, 10) : d.start}
                    onChange={(e) => updateDraft(i, { start: e.target.value })}
                    className="rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-xs"
                  />
                  <span className="text-xs text-gray-400 self-center">to</span>
                  <input
                    type={d.allDay ? "date" : "datetime-local"}
                    value={d.allDay ? d.end.slice(0, 10) : d.end}
                    onChange={(e) => updateDraft(i, { end: e.target.value })}
                    className="rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-xs"
                  />
                </div>

                <input
                  value={d.location}
                  onChange={(e) => updateDraft(i, { location: e.target.value })}
                  placeholder="Location (optional)"
                  className="w-full pl-6 rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-xs"
                />
              </div>
            ))}
          </div>
        )}

        {drafts && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setDrafts(null);
                setError(null);
              }}
              className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-medium"
            >
              Start over
            </button>
            <button
              onClick={handleImport}
              disabled={importing || drafts.every((d) => !d.include)}
              className="flex-1 rounded-md bg-black text-white dark:bg-white dark:text-black py-2 text-sm font-medium disabled:opacity-50"
            >
              {importing ? "Adding…" : `Add ${drafts.filter((d) => d.include).length} event(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
