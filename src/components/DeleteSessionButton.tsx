import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeleteSession } from "@/components/hooks/useDeleteSession";

interface Props {
  sessionId: string;
  filename?: string | null;
}

/**
 * Per-row delete affordance for the session history list. Two-step inline
 * confirm — no modal, no new dependency. On a successful delete the hook
 * reloads the page; on failure the error text stays inline and focus returns
 * to the delete trigger so keyboard / screen-reader users are not stranded on
 * a control that has been swapped out.
 */
export default function DeleteSessionButton({ sessionId, filename }: Props) {
  const [confirming, setConfirming] = useState(false);
  const { state, deleteSession } = useDeleteSession();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  const deleting = state.kind === "deleting";
  const label = `Delete ${filename ?? "session"}`;

  useEffect(() => {
    if (!confirming && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  function handleCancel() {
    restoreFocus.current = true;
    setConfirming(false);
  }

  async function handleConfirm() {
    await deleteSession(sessionId);
    // deleteSession only returns here on failure — success reloads the page.
    restoreFocus.current = true;
    setConfirming(false);
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <Button variant="destructive" size="sm" onClick={handleConfirm} disabled={deleting}>
            {deleting ? "Deleting…" : "Confirm"}
          </Button>
          <Button variant="outline" size="sm" className="text-foreground" onClick={handleCancel} disabled={deleting}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          ref={triggerRef}
          variant="destructive"
          size="icon"
          aria-label={label}
          onClick={() => {
            setConfirming(true);
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
    </div>
  );
}
