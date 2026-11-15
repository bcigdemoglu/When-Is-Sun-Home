"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ShareIcon } from "@/components/ui/icons";
import { showToast } from "@/components/ui/toast";
import { pickSettings, shareText, useSettings } from "@/state";
import { canShareNatively, copyText, isAbortError } from "./shareActions";
import { isLiveView, shareLink } from "./shareLink";
import { SharePopover } from "./SharePopover";
import type { ShareButtonProps } from "./types";

/**
 * Shares the report on screen as a link that reproduces it — pin, viewpoint,
 * and the day and time unless the view follows the clock — and that carries
 * the headline numbers for the link preview.
 *
 * - Phones and tablets (Web Share API + touch): one tap opens the system
 *   share sheet. Dismissing it is not an error; if sharing fails for another
 *   reason the link is copied instead ("Link copied").
 * - Everywhere else: a popover next to the button with the link, a Copy
 *   button, a QR code and a preview of the link card.
 */
export function ShareButton({ place, label, summary, variant, className = "" }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const getButton = useCallback(
    () => wrapperRef.current?.querySelector<HTMLElement>("button") ?? null,
    [],
  );

  const closePopover = useCallback(
    ({ restoreFocus }: { restoreFocus: boolean }) => {
      setOpen(false);
      if (restoreFocus) getButton()?.focus({ preventScroll: true });
    },
    [getButton],
  );

  /** What the system share sheet gets: words about the place, and the link. */
  const nativeShareData = (): ShareData & { url: string } => {
    const settings = pickSettings(useSettings.getState());
    const url = shareLink({
      settings,
      place,
      label,
      summary,
      // No sheet of ours to ask in: pin the day and time exactly when the user has.
      includeDateTime: !isLiveView(settings),
      base: window.location.href,
    });
    return { ...shareText(label, summary), url };
  };

  const shareNatively = async (data: ShareData & { url: string }) => {
    try {
      await navigator.share(data);
    } catch (error) {
      if (isAbortError(error)) return; // the user changed their mind
      if (await copyText(data.url)) showToast("Link copied");
      else setOpen(true); // last resort: show the link to copy by hand
    }
  };

  const onClick = () => {
    if (open) {
      setOpen(false);
      return;
    }
    // Decided at click time, not on render: it cannot differ between server
    // and client, and it follows a tablet that gains or loses a mouse.
    const data = nativeShareData();
    if (canShareNatively(data)) void shareNatively(data);
    else setOpen(true);
  };

  return (
    // `display: contents`: the wrapper gives us a ref without becoming a box,
    // so `className` lays the button out as if it were the direct child.
    <span ref={wrapperRef} className="contents">
      <Button
        variant="tonal"
        iconOnly={variant === "icon"}
        className={className}
        aria-label="Share this report"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onClick}
      >
        <ShareIcon />
        {variant === "pill" && "Share"}
      </Button>
      {open &&
        createPortal(
          <SharePopover
            getAnchor={getButton}
            place={place}
            label={label}
            summary={summary}
            onClose={closePopover}
          />,
          document.body,
        )}
    </span>
  );
}
