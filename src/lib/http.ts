// Shared client-side POST helper.
//
// A failing server doesn't always answer with JSON: an unhandled error is an
// HTML error page in production and an empty body in dev, and a dropped
// connection is no response at all. Parsing those blindly throws and leaves the
// caller with nothing to show, so read the body as text first and always come
// back with a message worth rendering.
export type PostResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function postJson<T = unknown>(url: string, body: unknown): Promise<PostResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }

  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const fromBody =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : null;
    return {
      ok: false,
      error: fromBody ?? `Server error (HTTP ${res.status}). Check the server logs for details.`,
    };
  }

  return { ok: true, data: data as T };
}
