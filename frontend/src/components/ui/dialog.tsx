"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * A modal popup on the native <dialog> element: focus moves inside, Esc and the backdrop
 * close it, and the page behind cannot be clicked while it is open.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  side = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  /** Slide-in panel on the right edge (filters) instead of a centred box. */
  side?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "overflow-y-auto border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-[1px]",
        side
          ? // "!" so a parent's spacing (e.g. space-y-8 on the page) cannot move the panel
            "!my-0 !ml-auto !mr-0 h-full max-h-full overflow-hidden w-[min(32rem,100vw)] max-w-none rounded-none rounded-l-2xl"
          : cn("!m-auto max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] rounded-2xl", wide ? "max-w-3xl" : "max-w-lg"),
      )}
    >
      {open && (
        <div className={side ? "flex h-full flex-col p-6" : "p-6"}>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{title}</h2>
              {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  // Same in every popup: a light band at the bottom, actions on the right (Cancel, then the main action).
  return <div className="-mx-6 -mb-6 mt-6 flex flex-wrap justify-end gap-3 rounded-b-2xl border-t bg-muted/30 px-6 py-4">{children}</div>;
}
