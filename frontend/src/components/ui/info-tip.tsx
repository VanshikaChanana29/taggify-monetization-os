"use client";

import { Info } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

const WIDTH = 280;

/**
 * A small (i) that explains a term. Opens on hover, keyboard focus or tap; drawn in a portal
 * so tables and cards with overflow-hidden never cut it off.
 */
export function InfoTip({ text, className }: { text: React.ReactNode; className?: string }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const open = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
    const below = r.top < 140;
    setPos({ left, top: below ? r.bottom + 8 : r.top - 8, below });
  }, []);
  const close = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos, close]);

  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label="What does this mean?"
        aria-describedby={pos ? id : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={(e) => {
          // Inside a <label> or a clickable card, a tap should only toggle the tip.
          e.preventDefault();
          e.stopPropagation();
          if (pos) close();
          else open();
        }}
        onKeyDown={(e) => e.key === "Escape" && close()}
        className={cn(
          "ml-1 inline-flex cursor-help items-center align-middle text-muted-foreground/70 outline-none hover:text-primary focus-visible:text-primary",
          className,
        )}
      >
        <Info className="h-3.5 w-3.5" />
      </span>
      {pos &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{ left: pos.left, top: pos.top, width: WIDTH, transform: pos.below ? undefined : "translateY(-100%)" }}
            className="pointer-events-none fixed z-[1000] rounded-xl bg-foreground px-3.5 py-2.5 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-background shadow-xl"
          >
            {text}
          </span>,
          // Inside a popup (<dialog> sits in the top layer) the tip must render in the popup.
          ref.current?.closest("dialog") ?? document.body,
        )}
    </>
  );
}
