"use client";

import {
  documentVersionConflictSchema,
  type SaveDocumentContentRequest,
  saveDocumentContentResponseSchema,
} from "@repo/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "saved" | "unsaved" | "saving" | "failed" | "conflict" | "signed_out";

/** A save without its base version, which the hook adds. The server validates the JSON. */
type Content = Omit<SaveDocumentContentRequest, "base_version" | "content_json"> & {
  content_json: object;
};

/** Quiet time after the last keystroke before a save. */
const DEBOUNCE_MS = 1_000;
/** After a failed save, try again this long after, even without more typing. */
const RETRY_MS = 5_000;
/** Browsers drop keepalive requests with bigger bodies, so larger saves go without it. */
const KEEPALIVE_MAX_CHARS = 60_000;

/**
 * Debounced autosave for one note. `schedule(read)` marks the note dirty and saves `read()` once
 * typing pauses; reading late means a save always sends the latest content. Saves never overlap,
 * so versions stay in order. A 409 means another tab saved first: saving stops so this tab cannot
 * overwrite it. `flush()` saves now and resolves true once everything is saved; the "Generate
 * questions" button calls it before generating.
 */
export function useAutosave(documentId: string, initialVersion: number) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const version = useRef(initialVersion);
  const pending = useRef<(() => Content) | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const send = useCallback(
    async (content: Content): Promise<boolean> => {
      const body = JSON.stringify({ ...content, base_version: version.current });
      try {
        const response = await fetch(`/api/documents/${documentId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body,
          // Lets the last save finish when the tab is closing.
          keepalive: body.length <= KEEPALIVE_MAX_CHARS,
        });
        if (response.status === 409) {
          documentVersionConflictSchema.parse(await response.json());
          stopped.current = true;
          setStatus("conflict");
          return false;
        }
        if (response.status === 401) {
          stopped.current = true;
          setStatus("signed_out");
          return false;
        }
        if (!response.ok)
          throw new Error(`PATCH /api/documents/${documentId} answered ${response.status}`);
        version.current = saveDocumentContentResponseSchema.parse(await response.json()).version;
        return true;
      } catch (error) {
        console.error(error);
        setStatus("failed");
        return false;
      }
    },
    [documentId],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    for (;;) {
      if (inFlight.current) {
        await inFlight.current;
        continue;
      }
      if (stopped.current) return false;
      const read = pending.current;
      if (!read) return true;

      pending.current = null;
      setStatus("saving");
      const saving = send(read());
      inFlight.current = saving;
      const ok = await saving;
      inFlight.current = null;
      if (!ok) {
        // Keep the unsaved content (unless newer typing replaced it) and retry later.
        pending.current ??= read;
        if (!stopped.current) timer.current = setTimeout(() => void flush(), RETRY_MS);
        return false;
      }
      if (!pending.current) setStatus("saved");
    }
  }, [send]);

  const schedule = useCallback(
    (read: () => Content) => {
      if (stopped.current) return;
      pending.current = read;
      setStatus((current) => (current === "saving" ? current : "unsaved"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => {
    // Hiding the tab (switching away, closing it) saves at once instead of after the debounce.
    function onHide() {
      if (document.visibilityState === "hidden") void flush();
    }
    // Asks before leaving with unsaved changes.
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (pending.current || inFlight.current) event.preventDefault();
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Leaving the page inside the app (a link) unmounts the editor: save what is left.
      void flush();
    };
  }, [flush]);

  return { status, schedule, flush };
}
