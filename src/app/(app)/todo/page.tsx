"use client";

import { useCallback, useEffect, useState } from "react";

type Priority = "LOW" | "MED" | "HIGH";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  startAt: string | null;
  endAt: string | null;
  done: boolean;
  estimatedMinutes: number | null;
  deadline: string | null;
  priority: Priority;
  location: string | null;
};

const PRIORITY_STYLES: Record<Priority, string> = {
  HIGH: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  MED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  LOW: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
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
/** Local YYYY-MM-DD (not toISOString, which can shift to the wrong calendar date across UTC offsets). */
function toDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function TodoPage() {
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority>("MED");
  const [location, setLocation] = useState("");
  const [adding, setAdding] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planMessage, setPlanMessage] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

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
    setPlanMessage(null);
    setPlanError(null);
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
          estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : undefined,
          deadline: deadline ? new Date(deadline).toISOString() : undefined,
          priority,
          location: location || undefined,
        }),
      });
      if (res.ok) {
        setTitle("");
        setStart("");
        setEnd("");
        setEstimatedMinutes("");
        setDeadline("");
        setPriority("MED");
        setLocation("");
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

  async function planMyDay() {
    setPlanning(true);
    setPlanMessage(null);
    setPlanError(null);
    try {
      const res = await fetch("/api/plan-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: toDateOnly(day) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPlanError(data?.error ?? "Something went wrong");
        return;
      }
      const scheduledCount = data.scheduled?.length ?? 0;
      const unplaced: Task[] = data.unplaced ?? [];
      if (scheduledCount === 0 && unplaced.length === 0) {
        setPlanMessage("Nothing to plan — no open to-dos without a time yet.");
      } else if (unplaced.length === 0) {
        setPlanMessage(`Scheduled ${scheduledCount} task${scheduledCount === 1 ? "" : "s"}.`);
      } else {
        setPlanMessage(
          `Scheduled ${scheduledCount} task${scheduledCount === 1 ? "" : "s"}. Didn't fit: ${unplaced.map((t) => t.title).join(", ")}.`,
        );
      }
      await load();
    } finally {
      setPlanning(false);
    }
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
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setDay((d) => addDays(d, -1))} className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            ←
          </button>
          <button onClick={() => setDay(startOfDay(new Date()))} className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            Today
          </button>
          <button onClick={() => setDay((d) => addDays(d, 1))} className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            →
          </button>
          <button
            onClick={planMyDay}
            disabled={planning}
            className="rounded-md bg-pink-600 text-white hover:bg-pink-700 dark:bg-pink-600 dark:hover:bg-pink-700 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {planning ? "Planning…" : "Plan my day"}
          </button>
        </div>
      </div>

      {planMessage && (
        <div className="rounded-md bg-green-50 text-green-700 text-sm px-3 py-2 mb-3 dark:bg-green-950 dark:text-green-300">
          {planMessage}
        </div>
      )}
      {planError && (
        <div className="rounded-md bg-red-50 text-red-700 text-sm px-3 py-2 mb-3 dark:bg-red-950 dark:text-red-300">{planError}</div>
      )}

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
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm ${task.done ? "line-through text-gray-400" : ""}`}>{task.title}</p>
                  {task.priority !== "MED" && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[task.priority]}`}>
                      {task.priority}
                    </span>
                  )}
                </div>
                {(task.startAt || task.endAt) && (
                  <p className="text-xs text-gray-500">
                    {task.startAt && new Date(task.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    {task.startAt && task.endAt ? " – " : ""}
                    {task.endAt && new Date(task.endAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </p>
                )}
                {(task.location || task.estimatedMinutes || task.deadline) && (
                  <p className="text-xs text-gray-400">
                    {[
                      task.location ? `📍 ${task.location}` : null,
                      task.estimatedMinutes ? `${task.estimatedMinutes}m` : null,
                      task.deadline ? `Due ${new Date(task.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-gray-500">Planning details (optional)</label>
          <input
            type="number"
            min={1}
            max={1440}
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
            placeholder="Est. min"
            className="w-20 rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-sm"
          />
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            title="Deadline"
            className="rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-sm"
          />
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            className="rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-sm"
          >
            <option value="LOW">Low</option>
            <option value="MED">Medium</option>
            <option value="HIGH">High</option>
          </select>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location"
            className="flex-1 min-w-[100px] rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-sm"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={adding || !title.trim()}
            className="rounded-md bg-pink-600 text-white hover:bg-pink-700 dark:bg-pink-600 dark:hover:bg-pink-700 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}
