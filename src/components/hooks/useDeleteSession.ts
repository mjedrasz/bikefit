import { useState } from "react";

type DeleteState = { kind: "idle" } | { kind: "deleting" } | { kind: "error"; message: string };

/**
 * Owns the `DELETE /api/sessions/:id` request lifecycle for one session row.
 * On success the whole page reloads so the SSR history query re-runs and the
 * list (including its empty state) stays authoritative — the state is left at
 * `deleting` through the reload so the caller can keep showing a pending UI.
 * Follows the fetch + useState idiom in VideoUpload.tsx.
 */
export function useDeleteSession() {
  const [state, setState] = useState<DeleteState>({ kind: "idle" });

  async function deleteSession(id: string): Promise<void> {
    setState({ kind: "deleting" });
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setState({
          kind: "error",
          message:
            res.status === 404
              ? "This session is already gone — refresh the page."
              : "Couldn't delete this session — please try again.",
        });
        return;
      }
      window.location.reload();
    } catch {
      setState({ kind: "error", message: "Network error — please try again." });
    }
  }

  return { state, deleteSession };
}
