type TravelMode = "driving" | "transit" | "walking" | "bicycling";

// Transit is the sensible default for a phone-first personal app; switching
// modes is out of scope for v1 (see README), so this isn't exposed anywhere.
const DEFAULT_MODE: TravelMode = "transit";

// The same commute (home <-> office, etc.) repeats constantly, so a short
// in-memory cache avoids re-querying Distance Matrix for identical pairs
// within the same warm serverless instance.
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { minutes: number; expiresAt: number }>();

function cacheKey(origin: string, destination: string, mode: TravelMode): string {
  return `${mode}:${origin.trim().toLowerCase()}=>${destination.trim().toLowerCase()}`;
}

function apiKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  return key || null;
}

/**
 * Estimated one-way travel time in minutes between two location strings, via
 * Google's Distance Matrix API. Returns null if either location is blank,
 * the API key isn't configured, or the lookup fails for any reason —
 * callers should treat null as "unknown" and skip the travel buffer rather
 * than blocking the whole feature, same as the other optional integrations
 * in this app (Telegram, push, screenshot import).
 */
export async function getTravelMinutes(
  origin: string,
  destination: string,
  mode: TravelMode = DEFAULT_MODE,
): Promise<number | null> {
  const from = origin.trim();
  const to = destination.trim();
  if (!from || !to) return null;
  if (from.toLowerCase() === to.toLowerCase()) return 0;

  const key = apiKey();
  if (!key) return null;

  const cacheKeyStr = cacheKey(from, to, mode);
  const cached = cache.get(cacheKeyStr);
  if (cached && cached.expiresAt > Date.now()) return cached.minutes;

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", from);
  url.searchParams.set("destinations", to);
  url.searchParams.set("mode", mode);
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error("Distance Matrix request failed", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as {
      rows?: { elements?: { status?: string; duration?: { value?: number } }[] }[];
    };
    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK" || typeof element.duration?.value !== "number") {
      return null;
    }
    const minutes = Math.ceil(element.duration.value / 60);
    cache.set(cacheKeyStr, { minutes, expiresAt: Date.now() + CACHE_TTL_MS });
    return minutes;
  } catch (err) {
    console.error("Distance Matrix request error", err);
    return null;
  }
}
