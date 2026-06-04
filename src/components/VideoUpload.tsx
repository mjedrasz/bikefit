import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/types";

type AppState =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "error"; message: string }
  | { kind: "creating" }
  | { kind: "polling"; sessionId: string; status: SessionStatus }
  | { kind: "completed" }
  | { kind: "failed"; errorMessage: string | null };

interface CreateSessionResponse {
  id: string;
  status: SessionStatus;
}

interface PollResponse {
  status: SessionStatus;
  error_message?: string | null;
}

interface ErrorResponse {
  error?: string;
}

const MAX_SIZE = 104_857_600;
const MIN_DURATION = 3;
const MAX_DURATION = 15;
const POLL_INTERVAL_MS = 3000;
const MAX_CONSECUTIVE_ERRORS = 5;

function extractDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const { duration } = video;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata"));
    };
    video.src = url;
  });
}

function StatusBadge({ status }: { status: SessionStatus }) {
  const labels: Record<SessionStatus, string> = {
    queued: "Queued",
    processing: "Processing",
    completed: "Completed",
    failed: "Failed",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium",
        status === "queued" && "bg-muted text-muted-foreground",
        status === "processing" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
        status === "completed" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
        status === "failed" && "bg-destructive/10 text-destructive",
      )}
    >
      {labels[status]}
    </span>
  );
}

export default function VideoUpload() {
  const [state, setState] = useState<AppState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<number | null>(null);
  const consecutiveErrorsRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  function startPolling(sessionId: string) {
    consecutiveErrorsRef.current = 0;

    async function poll() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PollResponse;
        consecutiveErrorsRef.current = 0;
        const { status } = data;
        if (status === "completed") {
          stopPolling();
          setState({ kind: "completed" });
        } else if (status === "failed") {
          stopPolling();
          setState({ kind: "failed", errorMessage: data.error_message ?? null });
        } else {
          setState({ kind: "polling", sessionId, status });
        }
      } catch (err) {
        console.error("Poll error:", err);
        consecutiveErrorsRef.current += 1;
        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
          stopPolling();
          setState({ kind: "error", message: "Connection lost — please refresh" });
        }
      }
    }

    intervalRef.current = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (inputRef.current) inputRef.current.value = "";

    if (file.type !== "video/mp4") {
      setState({ kind: "error", message: "Only MP4 videos are supported" });
      return;
    }
    if (file.size > MAX_SIZE) {
      setState({ kind: "error", message: "File must be 100 MB or smaller" });
      return;
    }

    setState({ kind: "validating" });
    let duration: number;
    try {
      duration = await extractDuration(file);
    } catch {
      setState({ kind: "error", message: "Could not read video duration" });
      return;
    }

    if (duration < MIN_DURATION) {
      setState({ kind: "error", message: "Video must be at least 3 seconds" });
      return;
    }
    if (duration > MAX_DURATION) {
      setState({ kind: "error", message: "Video must be 15 seconds or shorter" });
      return;
    }

    setState({ kind: "creating" });
    let sessionId: string;
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_filename: file.name, video_duration_s: duration }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorResponse;
        setState({ kind: "error", message: body.error ?? "Failed to create session" });
        return;
      }
      const data = (await res.json()) as CreateSessionResponse;
      sessionId = data.id;
    } catch {
      setState({ kind: "error", message: "Network error — please try again" });
      return;
    }

    setState({ kind: "polling", sessionId, status: "queued" });
    startPolling(sessionId);
  }

  function handleReset() {
    stopPolling();
    setState({ kind: "idle" });
  }

  if (state.kind === "polling") {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <h2 className="text-xl font-semibold">Analysing your video</h2>
        <StatusBadge status={state.status} />
        <p className="text-muted-foreground text-sm">Checking for updates every few seconds…</p>
      </div>
    );
  }

  if (state.kind === "completed") {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <h2 className="text-xl font-semibold">Analysis complete!</h2>
        <p className="text-muted-foreground text-sm">Your bike fit analysis is ready.</p>
      </div>
    );
  }

  if (state.kind === "failed") {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <h2 className="text-xl font-semibold">Analysis failed</h2>
        {state.errorMessage && <p className="text-destructive text-sm">{state.errorMessage}</p>}
        <Button variant="outline" onClick={handleReset}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 p-8">
      <h2 className="text-xl font-semibold">Upload your riding video</h2>
      <p className="text-muted-foreground max-w-sm text-center text-sm">
        Select an MP4 file between 3 and 15 seconds. Maximum size 100 MB.
      </p>
      <Button
        onClick={() => inputRef.current?.click()}
        disabled={state.kind === "validating" || state.kind === "creating"}
      >
        {state.kind === "validating"
          ? "Reading video…"
          : state.kind === "creating"
            ? "Creating session…"
            : "Choose Video"}
      </Button>
      <input ref={inputRef} type="file" accept="video/mp4" className="hidden" onChange={handleFileChange} />
      {state.kind === "error" && <p className="text-destructive text-sm">{state.message}</p>}
    </div>
  );
}
