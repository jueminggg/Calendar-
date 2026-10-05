import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";

/** How much of an id is shown and accepted as a short reference — matches the
 *  refs /postpone already prints, so one ref works for both commands. */
export const TASK_REF_LENGTH = 6;

/**
 * The instant a user's day begins. Task.date stores exactly this — local
 * midnight as a UTC instant — and both the To-do page and Plan my day write it
 * that way, so querying with a plain UTC midnight silently matches nothing.
 */
export function localDayStart(tz: string, now: DateTime = DateTime.now()): Date {
  return now.setZone(tz).startOf("day").toJSDate();
}

export type TodoLine = { id: string; title: string; done: boolean };

export async function todaysTodos(userId: string, tz: string): Promise<TodoLine[]> {
  return prisma.task.findMany({
    where: { userId, date: localDayStart(tz) },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, done: true },
  });
}

/**
 * Renders a day's to-dos for Telegram. Only open items carry a ref, since a
 * finished one has nothing left to act on, and a wall of refs is harder to
 * read than the handful that still matter.
 */
export function formatTodos(label: string, todos: TodoLine[], opts?: { emptyHint?: string }): string {
  if (todos.length === 0) {
    return `${label}\n${opts?.emptyHint ?? "Nothing yet."}`;
  }
  const lines = todos.map((t) =>
    t.done ? `☑ ${t.title}` : `☐ ${t.title} — /done ${t.id.slice(-TASK_REF_LENGTH)}`,
  );
  const doneCount = todos.filter((t) => t.done).length;
  return `${label}\n${lines.join("\n")}\n\n${doneCount} of ${todos.length} done`;
}

/** Ticks off an open to-do by its short ref. Null when nothing matches, so the
 *  caller can fall back to the ideas list, which shares the same ref format. */
export async function completeTodoByRef(userId: string, ref: string) {
  const task = await prisma.task.findFirst({
    where: { userId, done: false, id: { endsWith: ref.toLowerCase() } },
    orderBy: { createdAt: "desc" },
  });
  if (!task) return null;
  return prisma.task.update({ where: { id: task.id }, data: { done: true } });
}

/**
 * Finds the open to-do a phrase like "finished the bank call" refers to.
 * Deliberately requires a decisive match — an exact title, or the single open
 * to-do the phrase overlaps — because ticking off the wrong item is worse than
 * not recognising the message. Anything ambiguous returns null and the caller
 * handles the message as it normally would.
 *
 * Not limited to today: finishing something you wrote down yesterday is normal.
 */
export async function findTodoByPhrase(userId: string, phrase: string) {
  const needle = phrase.trim().toLowerCase();
  if (needle.length < 3) return null;

  const open = await prisma.task.findMany({
    where: { userId, done: false },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true },
  });

  const exact = open.filter((t) => t.title.trim().toLowerCase() === needle);
  if (exact.length === 1) return exact[0];

  const overlapping = open.filter((t) => {
    const title = t.title.trim().toLowerCase();
    return title.includes(needle) || needle.includes(title);
  });
  return overlapping.length === 1 ? overlapping[0] : null;
}

export async function completeTodo(id: string) {
  return prisma.task.update({ where: { id }, data: { done: true } });
}
