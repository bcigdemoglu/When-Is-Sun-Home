import type { SVGProps } from "react";

/**
 * Line icons for search and saved places: 24 px grid drawn at 20 px with a
 * 1.5 px stroke in the current text colour. Decorative by default — the
 * control that holds one carries the accessible name.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
);

export const ArrowLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 12H5m6-6-6 6 6 6" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6.5 6.5 11 11m0-11-11 11" />
  </Icon>
);

/** A filled disc with a cross: "clear this field". */
export const ClearIcon = (props: IconProps) => (
  <Icon {...props} stroke="none">
    <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.28" />
    <path
      d="m9 9 6 6m0-6-6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
  </Icon>
);

/** The "my location" arrow. */
export const LocationArrowIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20.2 3.8 3.9 10.5c-.5.2-.5.9 0 1.1l6.3 2.2 2.2 6.3c.2.5.9.5 1.1 0L20.2 3.8Z" />
  </Icon>
);

/** A map pin with a plus: "choose on the map". */
export const MapPinPlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M18.5 10.2c0 4.6-6.5 10.3-6.5 10.3S5.5 14.8 5.5 10.2a6.5 6.5 0 0 1 13 0Z" />
    <path d="M12 7.6v5.2M9.4 10.2h5.2" />
  </Icon>
);

export const PinIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M18.5 10.2c0 4.6-6.5 10.3-6.5 10.3S5.5 14.8 5.5 10.2a6.5 6.5 0 0 1 13 0Z" />
    <circle cx="12" cy="10.2" r="2.2" />
  </Icon>
);

export const ClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

const HEART =
  "M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20Z";

export const HeartIcon = ({ filled = false, ...props }: IconProps & { filled?: boolean }) => (
  <Icon {...props}>
    <path d={HEART} fill={filled ? "currentColor" : "none"} />
  </Icon>
);

/** Latitude / longitude cross-hair: coordinates typed by hand. */
export const CoordinatesIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="6" />
    <path d="M12 2.5V6m0 12v3.5M2.5 12H6m12 0h3.5" />
  </Icon>
);

export const ChevronUpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 14.5 6-6 6 6" />
  </Icon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 9.5 6 6 6-6" />
  </Icon>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m14.5 6-6 6 6 6" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 7h15M9.5 7V4.8h5V7m3 0-.7 11.3a1.5 1.5 0 0 1-1.5 1.4H8.7a1.5 1.5 0 0 1-1.5-1.4L6.5 7m3.7 3.8v5.4m3.6-5.4v5.4" />
  </Icon>
);

export const PencilIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m14.3 6.2 3.5 3.5M5 19l.8-3.9L16.3 4.6a1.6 1.6 0 0 1 2.3 0l.8.8a1.6 1.6 0 0 1 0 2.3L8.9 18.2 5 19Z" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5.5 12.5 4.2 4.2 8.8-9.2" />
  </Icon>
);

export const StarIcon = (props: IconProps) => (
  <Icon {...props} stroke="none">
    <path
      fill="currentColor"
      d="m12 3.2 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8L12 3.2Z"
    />
  </Icon>
);

/** Two columns side by side: "compare". */
export const CompareIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="4.5" width="6.5" height="15" rx="1.5" />
    <rect x="13.5" y="4.5" width="6.5" height="15" rx="1.5" />
  </Icon>
);

/** A spinning arc. Stands still when the user prefers reduced motion. */
export const SpinnerIcon = ({ className = "", ...props }: IconProps) => (
  <Icon {...props} className={`motion-safe:animate-spin ${className}`}>
    <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />
  </Icon>
);
