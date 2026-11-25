"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { withSectionHash } from "@/components/report/sections";
import { Button } from "@/components/ui/Button";
import { ShareIcon } from "@/components/ui/icons";
import { showToast } from "@/components/ui/toast";
import { pickSettings, useSettings } from "@/state";
import { sectionShareText } from "./sectionShare";
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
 *
 * With a `section` the link ends in that section's hash (`#trees`), which
 * opens the report scrolled to it; without one any hash of the page is left
 * out, so a section link that was opened never leaks into a later share.
 */
export function ShareButton({
  place,
  label,
  summary,
  variant,
  section,
  className = "",
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const small = variant === "icon-sm";
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
      base: withSectionHash(window.location.href, section ? section.slug : null),
    });
    return { ...sectionShareText(section, label, summary), url };
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
        variant={small ? "ghost" : "tonal"}
        size={small ? "xs" : "md"}
        iconOnly={variant !== "pill"}
        className={
          small
            ? // Ghost (text-ink-2): 32 px to look at, 44 px to hit, no taller than its title line.
              `relative -my-[5px] before:absolute before:-inset-1.5 ${className}`
            : className
        }
        aria-label={section ? `Share the ${section.label} section` : "Share this report"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onClick}
      >
        <ShareIcon width={small ? 18 : 20} height={small ? 18 : 20} />
        {variant === "pill" && "Share"}
      </Button>
      {open &&
        createPortal(
          <SharePopover
            getAnchor={getButton}
            place={place}
            label={label}
            summary={summary}
            section={section}
            onClose={closePopover}
          />,
          document.body,
        )}
    </span>
  );
}
