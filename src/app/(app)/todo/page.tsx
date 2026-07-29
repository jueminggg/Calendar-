"use client";

import { useCallback, useEffect, useState } from "react";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  startAt: string | null;
  endAt: string | null;
  done: boolean;
};

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
export default function TodoPage() {
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/tasks?date=${day.toISOString()}`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks);
    }
    setLoading(false);
  }, [day]);

  useEffect(() => {
    load();
  }, [load]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      const withTime = (time: string) => {
        if (!time) return undefined;
        const [h, m] = time.split(":").map(Number);
        const d = new Date(day);
        d.setHours(h, m, 0, 0);
        return d.toISOString();
      };
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          date: day.toISOString(),
          startAt: withTime(start),
          endAt: withTime(end),
        }),
      });
      if (res.ok) {
        setTitle("");
        setStart("");
        setEnd("");
        await load();
      }
    } finally {
      setAdding(false);
    }
  }

  async function toggleDone(task: Task) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !task.done }),
    });
  }

  async function removeTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  }

  const dayLabel = day.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">{dayLabel}</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setDay((d) => addDays(d, -1))} className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            ←
          </button>
          <button onClick={() => setDay(startOfDay(new Date()))} className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            Today
          </button>
          <button onClick={() => setDay((d) => addDays(d, 1))} className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            →
          </button>
        </div>
      </div>

      {tasks.length > 0 && (
        <p className="text-sm text-gray-500 mb-3">
          {doneCount} of {tasks.length} done
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2"
            >
              <input type="checkbox" checked={task.done} onChange={() => toggleDone(task)} className="w-4 h-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${task.done ? "line-through text-gray-400" : ""}`}>{task.title}</p>
                {(task.startAt || task.endAt) && (
                  <p className="text-xs text-gray-500">
                    {task.startAt && new Date(task.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    {task.startAt && task.endAt ? " – " : ""}
                    {task.endAt && new Date(task.endAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </p>
                )}
              </div>
              <button
                onClick={() => removeTask(task.id)}
                className="text-gray-400 hover:text-red-500 text-sm px-1 shrink-0"
                title="Delete"
              >
                &times;
              </button>
            </li>
          ))}
          {tasks.length === 0 && <p className="text-sm text-gray-500">Nothing planned yet — add something below.</p>}
        </ul>
      )}

      <form onSubmit={addTask} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a to-do…"
          className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-gray-500">Time block (optional)</label>
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-sm"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={adding || !title.trim()}
            className="ml-auto rounded-md bg-pink-600 text-white hover:bg-pink-700 dark:bg-pink-600 dark:hover:bg-pink-700 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}
