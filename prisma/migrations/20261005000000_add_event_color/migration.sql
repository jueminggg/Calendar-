-- Per-event colour for native events, chosen in the event editor.
-- Nullable so every existing event keeps falling back to its source colour.
ALTER TABLE "Event" ADD COLUMN "color" TEXT;
