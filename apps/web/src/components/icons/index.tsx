/**
 * Icon set — Iconsax (free tier, `linear` style), inlined as React components.
 *
 * Provenance: fetched from the official Iconsax MCP server
 * (https://app.iconsax.io/api/mcp, free tools, no key) and post-processed to use
 * `currentColor` and a shared 24x24 grid. Iconsax free developer licence: icons may
 * be integrated into and shipped as part of source code, and modified; the raw files
 * may not be redistributed loose or resold. No attribution is required for an end
 * product like this one. https://docs.iconsax.io/license-and-terms/license
 *
 * Names are kept from the previous Phosphor set so call sites read the same.
 * A few glyphs are composed rather than taken verbatim: `CheckIcon` is the tick of
 * `tick-circle` scaled up, `XIcon` is `add` rotated 45deg, `ArrowUpRightIcon` is
 * `arrow-right-01` rotated -45deg, and `SpinnerIcon` is a plain 3/4 arc (it carries
 * no animation of its own — call sites add `animate-spin`).
 *
 * To add an icon: ask the Iconsax MCP for `get_icon_as_code` in `linear` style, then
 * paste its paths here. Do not reach for a second icon library.
 */
import type { ReactElement, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number | string;
};

/** Shape of every icon in this module, for `Record<K, Icon>`-style tables. */
export type Icon = (props: IconProps) => ReactElement;

/** Iconsax `archive` */
export function ArchiveIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9.25 9.05078C11.03 9.70078 12.97 9.70078 14.75 9.05078" />
      <path d="M16.8199 2H7.17995C5.04995 2 3.31995 3.74 3.31995 5.86V19.95C3.31995 21.75 4.60995 22.51 6.18995 21.64L11.0699 18.93C11.5899 18.64 12.4299 18.64 12.9399 18.93L17.8199 21.64C19.3999 22.52 20.6899 21.76 20.6899 19.95V5.86C20.6799 3.74 18.9499 2 16.8199 2Z" />
      <path d="M16.8199 2H7.17995C5.04995 2 3.31995 3.74 3.31995 5.86V19.95C3.31995 21.75 4.60995 22.51 6.18995 21.64L11.0699 18.93C11.5899 18.64 12.4299 18.64 12.9399 18.93L17.8199 21.64C19.3999 22.52 20.6899 21.76 20.6899 19.95V5.86C20.6799 3.74 18.9499 2 16.8199 2Z" />
    </svg>
  );
}

/** Iconsax `rotate-right` */
export function ArrowClockwiseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M14.8901 5.08039C14.0201 4.82039 13.0601 4.65039 12.0001 4.65039C7.21008 4.65039 3.33008 8.53039 3.33008 13.3204C3.33008 18.1204 7.21008 22.0004 12.0001 22.0004C16.7901 22.0004 20.6701 18.1204 20.6701 13.3304C20.6701 11.5504 20.1301 9.89039 19.2101 8.51039" />
      <path d="M16.13 5.32L13.24 2" />
      <path d="M16.13 5.32031L12.76 7.78031" />
    </svg>
  );
}

/** Iconsax `rotate-left` */
export function ArrowCounterClockwiseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9.11008 5.08039C9.98008 4.82039 10.9401 4.65039 12.0001 4.65039C16.7901 4.65039 20.6701 8.53039 20.6701 13.3204C20.6701 18.1104 16.7901 21.9904 12.0001 21.9904C7.21008 21.9904 3.33008 18.1104 3.33008 13.3204C3.33008 11.5404 3.87008 9.88039 4.79008 8.50039" />
      <path d="M7.87012 5.32L10.7601 2" />
      <path d="M7.87012 5.32031L11.2401 7.78031" />
    </svg>
  );
}

/** Iconsax `arrow-down-01` */
export function ArrowDownIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M18.0699 14.4297L11.9999 20.4997L5.92993 14.4297" />
      <path d="M12 3.5V20.33" />
    </svg>
  );
}

/** Iconsax `undo-arrow` */
export function ArrowElbowDownLeftIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7.12988 18.3096H15.1299C17.8899 18.3096 20.1299 16.0696 20.1299 13.3096C20.1299 10.5496 17.8899 8.30957 15.1299 8.30957H4.12988" />
      <path d="M6.43012 10.8104L3.87012 8.25043L6.43012 5.69043" />
    </svg>
  );
}

/** Iconsax `redo-arrow` */
export function ArrowElbowDownRightIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16.8701 18.3096H8.87012C6.11012 18.3096 3.87012 16.0696 3.87012 13.3096C3.87012 10.5496 6.11012 8.30957 8.87012 8.30957H19.8701" />
      <path d="M17.5701 10.8104L20.1301 8.25043L17.5701 5.69043" />
    </svg>
  );
}

/** Iconsax `arrow-left-01` */
export function ArrowLeftIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9.57 5.92969L3.5 11.9997L9.57 18.0697" />
      <path d="M20.4999 12H3.66992" />
    </svg>
  );
}

/** Iconsax `arrow-right-01` */
export function ArrowRightIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M14.4302 5.92969L20.5002 11.9997L14.4302 18.0697" />
      <path d="M3.5 12H20.33" />
    </svg>
  );
}

/** Iconsax `maximize` */
export function ArrowSquareOutIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2 9.98V9C2 4 4 2 9 2H15C20 2 22 4 22 9V15C22 20 20 22 15 22H14" />
      <path d="M13 11.0005L18.01 5.98047H14" />
      <path d="M18.01 5.98047V9.99047" />
      <path d="M11 16.15V18.85C11 21.1 10.1 22 7.85 22H5.15C2.9 22 2 21.1 2 18.85V16.15C2 13.9 2.9 13 5.15 13H7.85C10.1 13 11 13.9 11 16.15Z" />
    </svg>
  );
}

/** Iconsax `arrow-up-01` */
export function ArrowUpIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M18.0702 9.57L12.0002 3.5L5.93018 9.57" />
      <path d="M12 20.4999V3.66992" />
    </svg>
  );
}

/** Iconsax `arrow-up-right` */
export function ArrowUpRightIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <g transform="rotate(-45 12 12)"><path d="M14.4302 5.92969L20.5002 11.9997L14.4302 18.0697" /><path d="M3.5 12H20.33" /></g>
    </svg>
  );
}

/** Iconsax `refresh-arrow-02` */
export function ArrowsClockwiseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M14.55 21.67C18.84 20.54 22 16.64 22 12C22 6.48 17.56 2 12 2C5.33 2 2 7.56 2 7.56M2 7.56V3M2 7.56H4.01H6.44" />
      <path d="M2 12C2 17.52 6.48 22 12 22" />
    </svg>
  );
}

/** Iconsax `refresh-arrow-01` */
export function ArrowsCounterClockwiseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M22 12C22 17.52 17.52 22 12 22C6.48 22 3.11 16.44 3.11 16.44M3.11 16.44H7.63M3.11 16.44V21.44M2 12C2 6.48 6.44 2 12 2C18.67 2 22 7.56 22 7.56M22 7.56V2.56M22 7.56H17.56" />
    </svg>
  );
}

/** Iconsax `arrow-swap-01` */
export function ArrowsDownUpIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9.01023 20.5002L3.99023 15.4902" />
      <path d="M9.00977 3.5V20.5" />
      <path d="M14.9902 3.5L20.0102 8.51" />
      <path d="M14.9902 20.5V3.5" />
    </svg>
  );
}

/** Iconsax `maximize-3` */
export function ArrowsOutIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z" />
      <path d="M18 6L6 18" />
      <path d="M18 10V6H14" />
      <path d="M6 14V18H10" />
    </svg>
  );
}

/** Iconsax `notification` */
export function BellIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12.02 2.91016C8.70997 2.91016 6.01997 5.60016 6.01997 8.91016V11.8002C6.01997 12.4102 5.75997 13.3402 5.44997 13.8602L4.29997 15.7702C3.58997 16.9502 4.07997 18.2602 5.37997 18.7002C9.68997 20.1402 14.34 20.1402 18.65 18.7002C19.86 18.3002 20.39 16.8702 19.73 15.7702L18.58 13.8602C18.28 13.3402 18.02 12.4102 18.02 11.8002V8.91016C18.02 5.61016 15.32 2.91016 12.02 2.91016Z" />
      <path d="M13.87 3.19945C13.56 3.10945 13.24 3.03945 12.91 2.99945C11.95 2.87945 11.03 2.94945 10.17 3.19945C10.46 2.45945 11.18 1.93945 12.02 1.93945C12.86 1.93945 13.58 2.45945 13.87 3.19945Z" />
      <path d="M15.02 19.0605C15.02 20.7105 13.67 22.0605 12.02 22.0605C11.2 22.0605 10.44 21.7205 9.90002 21.1805C9.36002 20.6405 9.02002 19.8805 9.02002 19.0605" />
    </svg>
  );
}

/** Iconsax `notification-bing` */
export function BellRingingIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 6.43945V9.76945" />
      <path d="M12.02 2C8.34002 2 5.36002 4.98 5.36002 8.66V10.76C5.36002 11.44 5.08002 12.46 4.73002 13.04L3.46002 15.16C2.68002 16.47 3.22002 17.93 4.66002 18.41C9.44002 20 14.61 20 19.39 18.41C20.74 17.96 21.32 16.38 20.59 15.16L19.32 13.04C18.97 12.46 18.69 11.43 18.69 10.76V8.66C18.68 5 15.68 2 12.02 2Z" />
      <path d="M15.33 18.8203C15.33 20.6503 13.83 22.1503 12 22.1503C11.09 22.1503 10.25 21.7703 9.65004 21.1703C9.05004 20.5703 8.67004 19.7303 8.67004 18.8203" />
    </svg>
  );
}

/** Iconsax `volume-slash` */
export function BellSlashIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M15 8.36979V7.40979C15 4.42979 12.93 3.28979 10.41 4.86979L7.49 6.69979C7.17 6.88979 6.8 6.99979 6.43 6.99979H5C3 6.99979 2 7.99979 2 9.99979V13.9998C2 15.9998 3 16.9998 5 16.9998H7" />
      <path d="M10.41 19.1302C12.93 20.7102 15 19.5602 15 16.5902V12.9502" />
      <path d="M18.81 9.41992C19.71 11.5699 19.44 14.0799 18 15.9999" />
      <path d="M21.15 7.7998C22.62 11.2898 22.18 15.3698 19.83 18.4998" />
      <path d="M22 2L2 22" />
    </svg>
  );
}

/** Iconsax `telescope` */
export function BinocularsIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M15.0301 10.7697L20.6901 6.97973C21.2601 6.59973 21.4101 5.81973 21.0301 5.25973L19.2101 2.54971C18.8301 1.97971 18.0501 1.82971 17.4901 2.20971L11.8301 5.99972L15.0301 10.7697Z" />
      <path d="M12.1739 6.47981L7.39624 9.67969L9.95614 13.5018L14.7338 10.302L12.1739 6.47981Z" />
      <path d="M5.83004 15.8999L9.78004 13.2599L7.54004 9.91992L3.59004 12.5599C3.13004 12.8699 3.01004 13.4899 3.32004 13.9499L4.45004 15.6299C4.75004 16.0799 5.37004 16.1999 5.83004 15.8999Z" />
      <path d="M12.0501 12.1992L7.56006 21.9992" />
      <path d="M12 12.1992L16.44 21.9992" />
    </svg>
  );
}

/** Iconsax `archive` */
export function BookmarkSimpleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9.25 9.05078C11.03 9.70078 12.97 9.70078 14.75 9.05078" />
      <path d="M16.8199 2H7.17995C5.04995 2 3.31995 3.74 3.31995 5.86V19.95C3.31995 21.75 4.60995 22.51 6.18995 21.64L11.0699 18.93C11.5899 18.64 12.4299 18.64 12.9399 18.93L17.8199 21.64C19.3999 22.52 20.6899 21.76 20.6899 19.95V5.86C20.6799 3.74 18.9499 2 16.8199 2Z" />
      <path d="M16.8199 2H7.17995C5.04995 2 3.31995 3.74 3.31995 5.86V19.95C3.31995 21.75 4.60995 22.51 6.18995 21.64L11.0699 18.93C11.5899 18.64 12.4299 18.64 12.9399 18.93L17.8199 21.64C19.3999 22.52 20.6899 21.76 20.6899 19.95V5.86C20.6799 3.74 18.9499 2 16.8199 2Z" />
    </svg>
  );
}

/** Iconsax `smart-cursor` */
export function BrainIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M11.2 14.5601L10.06 14.8201C9.24002 15.0101 8.60002 15.6501 8.41002 16.4701L8.14002 17.6101C8.11002 17.7301 7.94002 17.7301 7.91002 17.6101L7.65002 16.4701C7.46002 15.6501 6.82002 15.0101 6.00002 14.8201L4.86002 14.5501C4.74002 14.5201 4.74002 14.3501 4.86002 14.3201L6.00002 14.0601C6.82002 13.8701 7.46002 13.2301 7.65002 12.4101L7.92002 11.2701C7.95002 11.1501 8.12002 11.1501 8.15002 11.2701L8.41002 12.4101C8.60002 13.2301 9.24002 13.8701 10.06 14.0601L11.2 14.3301C11.32 14.3601 11.32 14.5301 11.2 14.5601Z" />
      <path d="M12.11 17.7101H14.49C14.74 17.7201 14.99 17.8201 15.17 18.0001L18.7 21.4501C19.26 22.0001 20.09 22.1501 20.81 21.8501C21.53 21.5501 22 20.8401 22 20.0601V5.49005C22 4.59005 21.46 3.78005 20.63 3.43005C19.8 3.08005 18.84 3.27005 18.2 3.90005L11.37 10.6401" />
      <path d="M12 2H2" />
      <path d="M2 7H7" />
    </svg>
  );
}

/** Iconsax `briefcase` */
export function BriefcaseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7.99995 22H15.9999C20.0199 22 20.7399 20.39 20.9499 18.43L21.6999 10.43C21.9699 7.99 21.2699 6 16.9999 6H6.99995C2.72995 6 2.02995 7.99 2.29995 10.43L3.04995 18.43C3.25995 20.39 3.97995 22 7.99995 22Z" />
      <path d="M8 6V5.2C8 3.43 8 2 11.2 2H12.8C16 2 16 3.43 16 5.2V6" />
      <path d="M14 13V14C14 14.01 14 14.01 14 14.02C14 15.11 13.99 16 12 16C10.02 16 10 15.12 10 14.03V13C10 12 10 12 11 12H13C14 12 14 12 14 13Z" />
      <path d="M21.65 11C19.34 12.68 16.7 13.68 14 14.02" />
      <path d="M2.62 11.2695C4.87 12.8095 7.41 13.7395 10 14.0295" />
    </svg>
  );
}

/** Iconsax `radar-2` */
export function BroadcastIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 4C7.67 2.75 9.75 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12C2 10.19 2.47999 8.48999 3.32999 7.01999L12 12" />
      <path d="M6.82999 8.95999C6.29999 9.84999 6 10.89 6 12C6 15.31 8.69 18 12 18C15.31 18 18 15.31 18 12C18 8.69 15.31 6 12 6C11.09 6 10.22 6.20001 9.45001 6.57001" />
    </svg>
  );
}

/** Iconsax `buildings` */
export function BuildingsIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M13 22H5C3 22 2 21 2 19V11C2 9 3 8 5 8H10V19C10 21 11 22 13 22Z" />
      <path d="M10.11 4C10.03 4.3 10 4.63 10 5V8H5V6C5 4.9 5.9 4 7 4H10.11Z" />
      <path d="M14 8V13" />
      <path d="M18 8V13" />
      <path d="M17 17H15C14.45 17 14 17.45 14 18V22H18V18C18 17.45 17.55 17 17 17Z" />
      <path d="M6 13V17" />
      <path d="M10 19V5C10 3 11 2 13 2H19C21 2 22 3 22 5V19C22 21 21 22 19 22H13C11 22 10 21 10 19Z" />
    </svg>
  );
}

/** Iconsax `calendar` */
export function CalendarBlankIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 2V5" />
      <path d="M16 2V5" />
      <path d="M3.5 9.08984H20.5" />
      <path d="M21 8.5V17C21 20 19.5 22 16 22H8C4.5 22 3 20 3 17V8.5C3 5.5 4.5 3.5 8 3.5H16C19.5 3.5 21 5.5 21 8.5Z" />
      <path d="M15.6947 13.6992H15.7037" />
      <path d="M15.6947 16.6992H15.7037" />
      <path d="M11.9955 13.6992H12.0045" />
      <path d="M11.9955 16.6992H12.0045" />
      <path d="M8.29431 13.6992H8.30329" />
      <path d="M8.29431 16.6992H8.30329" />
    </svg>
  );
}

/** Iconsax `cards` */
export function CardsThreeIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2 12.6104H19" />
      <path d="M19 10.2798V17.4298C18.97 20.2798 18.19 20.9998 15.22 20.9998H5.78003C2.76003 20.9998 2 20.2498 2 17.2698V10.2798C2 7.5798 2.63 6.70981 5 6.56981C5.24 6.55981 5.50003 6.5498 5.78003 6.5498H15.22C18.24 6.5498 19 7.2998 19 10.2798Z" />
      <path d="M22 6.73V13.72C22 16.42 21.37 17.29 19 17.43V10.28C19 7.3 18.24 6.55 15.22 6.55H5.78003C5.50003 6.55 5.24 6.56 5 6.57C5.03 3.72 5.81003 3 8.78003 3H18.22C21.24 3 22 3.75 22 6.73Z" />
      <path d="M5.25 17.8096H6.96997" />
      <path d="M9.10999 17.8096H12.55" />
    </svg>
  );
}

/** Iconsax `arrow-down-02` */
export function CaretDownIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M19.9201 8.9502L13.4001 15.4702C12.6301 16.2402 11.3701 16.2402 10.6001 15.4702L4.08008 8.9502" />
    </svg>
  );
}

/** Iconsax `arrow-left-02` */
export function CaretLeftIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M14.9998 19.9201L8.47984 13.4001C7.70984 12.6301 7.70984 11.3701 8.47984 10.6001L14.9998 4.08008" />
    </svg>
  );
}

/** Iconsax `arrow-right-02` */
export function CaretRightIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8.90991 19.9201L15.4299 13.4001C16.1999 12.6301 16.1999 11.3701 15.4299 10.6001L8.90991 4.08008" />
    </svg>
  );
}

/** Iconsax `arrow-swap-01` */
export function CaretUpDownIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9.01023 20.5002L3.99023 15.4902" />
      <path d="M9.00977 3.5V20.5" />
      <path d="M14.9902 3.5L20.0102 8.51" />
      <path d="M14.9902 20.5V3.5" />
    </svg>
  );
}

/** Iconsax `arrow-up-02` */
export function CaretUpIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M19.9201 15.0496L13.4001 8.52965C12.6301 7.75965 11.3701 7.75965 10.6001 8.52965L4.08008 15.0496" />
    </svg>
  );
}

/** Iconsax `chart` */
export function ChartLineIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 22H21" />
      <path d="M5.59998 8.38086H4C3.45 8.38086 3 8.83086 3 9.38086V18.0009C3 18.5509 3.45 19.0009 4 19.0009H5.59998C6.14998 19.0009 6.59998 18.5509 6.59998 18.0009V9.38086C6.59998 8.83086 6.14998 8.38086 5.59998 8.38086Z" />
      <path d="M12.7999 5.18945H11.2C10.65 5.18945 10.2 5.63945 10.2 6.18945V17.9995C10.2 18.5495 10.65 18.9995 11.2 18.9995H12.7999C13.3499 18.9995 13.7999 18.5495 13.7999 17.9995V6.18945C13.7999 5.63945 13.3499 5.18945 12.7999 5.18945Z" />
      <path d="M20 2H18.4C17.85 2 17.4 2.45 17.4 3V18C17.4 18.55 17.85 19 18.4 19H20C20.55 19 21 18.55 21 18V3C21 2.45 20.55 2 20 2Z" />
    </svg>
  );
}

/** Iconsax `message-text-1` */
export function ChatCenteredDotsIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8.5 19H8C4 19 2 18 2 13V8C2 4 4 2 8 2H16C20 2 22 4 22 8V13C22 17 20 19 16 19H15.5C15.19 19 14.89 19.15 14.7 19.4L13.2 21.4C12.54 22.28 11.46 22.28 10.8 21.4L9.3 19.4C9.14 19.18 8.77 19 8.5 19Z" />
      <path d="M7 8H17" />
      <path d="M7 13H13" />
    </svg>
  );
}

/** Iconsax `message-text` */
export function ChatIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16 2H8C4 2 2 4 2 8V21C2 21.55 2.45 22 3 22H16C20 22 22 20 22 16V8C22 4 20 2 16 2Z" />
      <path d="M7 9.5H17" />
      <path d="M7 14.5H14" />
    </svg>
  );
}

/** Iconsax `tick-circle` */
export function CheckCircleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z" />
      <path d="M7.75 11.9999L10.58 14.8299L16.25 9.16992" />
    </svg>
  );
}

/** Iconsax `check` */
export function CheckIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4.78 12L9.59 16.81L19.23 7.19" />
    </svg>
  );
}

/** Iconsax `tick-square` */
export function ChecksIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z" />
      <path d="M7.75 11.9999L10.58 14.8299L16.25 9.16992" />
    </svg>
  );
}

/** Iconsax `record` */
export function CircleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21Z" />
    </svg>
  );
}

/** Iconsax `spinner` */
export function SpinnerIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 2.75A9.25 9.25 0 1 1 2.75 12" />
    </svg>
  );
}

/** Iconsax `clipboard-text` */
export function ClipboardIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 12.1992H15" />
      <path d="M8 16.1992H12.38" />
      <path d="M10 6H14C16 6 16 5 16 4C16 2 15 2 14 2H10C9 2 8 2 8 4C8 6 9 6 10 6Z" />
      <path d="M16 4.01953C19.33 4.19953 21 5.42953 21 9.99953V15.9995C21 19.9995 20 21.9995 15 21.9995H9C4 21.9995 3 19.9995 3 15.9995V9.99953C3 5.43953 4.67 4.19953 8 4.01953" />
    </svg>
  );
}

/** Iconsax `clock` */
export function ClockIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22Z" />
      <path d="M12 6.44V12" />
      <path d="M8.11035 8.11L12.0004 12" />
    </svg>
  );
}

/** Iconsax `row-vertical` */
export function ColumnsIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M19.9 13.5H4.1C2.6 13.5 2 14.14 2 15.73V19.77C2 21.36 2.6 22 4.1 22H19.9C21.4 22 22 21.36 22 19.77V15.73C22 14.14 21.4 13.5 19.9 13.5Z" />
      <path d="M19.9 2H4.1C2.6 2 2 2.64 2 4.23V8.27C2 9.86 2.6 10.5 4.1 10.5H19.9C21.4 10.5 22 9.86 22 8.27V4.23C22 2.64 21.4 2 19.9 2Z" />
    </svg>
  );
}

/** Iconsax `command` */
export function CommandIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16 8H8V16H16V8Z" />
      <path d="M5 22C6.65 22 8 20.65 8 19V16H5C3.35 16 2 17.35 2 19C2 20.65 3.35 22 5 22Z" />
      <path d="M5 8H8V5C8 3.35 6.65 2 5 2C3.35 2 2 3.35 2 5C2 6.65 3.35 8 5 8Z" />
      <path d="M16 8H19C20.65 8 22 6.65 22 5C22 3.35 20.65 2 19 2C17.35 2 16 3.35 16 5V8Z" />
      <path d="M19 22C20.65 22 22 20.65 22 19C22 17.35 20.65 16 19 16H16V19C16 20.65 17.35 22 19 22Z" />
    </svg>
  );
}

/** Iconsax `copy` */
export function CopyIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16 12.9V17.1C16 20.6 14.6 22 11.1 22H6.9C3.4 22 2 20.6 2 17.1V12.9C2 9.4 3.4 8 6.9 8H11.1C14.6 8 16 9.4 16 12.9Z" />
      <path d="M22 6.9V11.1C22 14.6 20.6 16 17.1 16H16V12.9C16 9.4 14.6 8 11.1 8H8V6.9C8 3.4 9.4 2 12.9 2H17.1C20.6 2 22 3.4 22 6.9Z" />
    </svg>
  );
}

/** Iconsax `cpu` */
export function CpuIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9.6 20H14.4C18.4 20 20 18.4 20 14.4V9.6C20 5.6 18.4 4 14.4 4H9.6C5.6 4 4 5.6 4 9.6V14.4C4 18.4 5.6 20 9.6 20Z" />
      <path d="M10.5 17H13.5C16 17 17 16 17 13.5V10.5C17 8 16 7 13.5 7H10.5C8 7 7 8 7 10.5V13.5C7 16 8 17 10.5 17Z" />
      <path d="M8.01001 4V2" />
      <path d="M12 4V2" />
      <path d="M16 4V2" />
      <path d="M20 8H22" />
      <path d="M20 12H22" />
      <path d="M20 16H22" />
      <path d="M16 20V22" />
      <path d="M12.01 20V22" />
      <path d="M8.01001 20V22" />
      <path d="M2 8H4" />
      <path d="M2 12H4" />
      <path d="M2 16H4" />
    </svg>
  );
}

/** Iconsax `card` */
export function CreditCardIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2 8.50488H22" />
      <path d="M6 16.5049H8" />
      <path d="M10.5 16.5049H14.5" />
      <path d="M6.44 3.50488H17.55C21.11 3.50488 22 4.38488 22 7.89488V16.1049C22 19.6149 21.11 20.4949 17.56 20.4949H6.44C2.89 20.5049 2 19.6249 2 16.1149V7.89488C2 4.38488 2.89 3.50488 6.44 3.50488Z" />
    </svg>
  );
}

/** Iconsax `gps` */
export function CrosshairIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 19.5C16.1421 19.5 19.5 16.1421 19.5 12C19.5 7.85786 16.1421 4.5 12 4.5C7.85786 4.5 4.5 7.85786 4.5 12C4.5 16.1421 7.85786 19.5 12 19.5Z" />
      <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" />
      <path d="M12 4V2" />
      <path d="M4 12H2" />
      <path d="M12 20V22" />
      <path d="M20 12H22" />
    </svg>
  );
}

/** Iconsax `3dcube` */
export function CubeIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12.92 2.25984L19.43 5.76984C20.19 6.17984 20.19 7.34984 19.43 7.75984L12.92 11.2698C12.34 11.5798 11.66 11.5798 11.08 11.2698L4.57 7.75984C3.81 7.34984 3.81 6.17984 4.57 5.76984L11.08 2.25984C11.66 1.94984 12.34 1.94984 12.92 2.25984Z" />
      <path d="M3.61 10.1297L9.66 13.1597C10.41 13.5397 10.89 14.3097 10.89 15.1497V20.8697C10.89 21.6997 10.02 22.2297 9.28 21.8597L3.23 18.8297C2.48 18.4497 2 17.6797 2 16.8397V11.1197C2 10.2897 2.87 9.75968 3.61 10.1297Z" />
      <path d="M20.39 10.1297L14.34 13.1597C13.59 13.5397 13.11 14.3097 13.11 15.1497V20.8697C13.11 21.6997 13.98 22.2297 14.72 21.8597L20.77 18.8297C21.52 18.4497 22 17.6797 22 16.8397V11.1197C22 10.2897 21.13 9.75968 20.39 10.1297Z" />
    </svg>
  );
}

/** Iconsax `dollar-circle` */
export function CurrencyDollarIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8.67188 14.3298C8.67188 15.6198 9.66188 16.6598 10.8919 16.6598H13.4019C14.4719 16.6598 15.3419 15.7498 15.3419 14.6298C15.3419 13.4098 14.8119 12.9798 14.0219 12.6998L9.99187 11.2998C9.20187 11.0198 8.67188 10.5898 8.67188 9.36984C8.67188 8.24984 9.54187 7.33984 10.6119 7.33984H13.1219C14.3519 7.33984 15.3419 8.37984 15.3419 9.66984" />
      <path d="M12 6V18" />
      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" />
    </svg>
  );
}

/** Iconsax `driver` */
export function DatabaseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M19.32 9.99977H4.69002C3.21002 9.99977 2.01001 8.78978 2.01001 7.31978V4.68977C2.01001 3.20977 3.22002 2.00977 4.69002 2.00977H19.32C20.8 2.00977 22 3.21977 22 4.68977V7.31978C22 8.78978 20.79 9.99977 19.32 9.99977Z" />
      <path d="M19.32 21.9998H4.69002C3.21002 21.9998 2.01001 20.7898 2.01001 19.3198V16.6898C2.01001 15.2098 3.22002 14.0098 4.69002 14.0098H19.32C20.8 14.0098 22 15.2198 22 16.6898V19.3198C22 20.7898 20.79 21.9998 19.32 21.9998Z" />
      <path d="M6 5V7" />
      <path d="M10 5V7" />
      <path d="M6 17V19" />
      <path d="M10 17V19" />
      <path d="M14 6H18" />
      <path d="M14 18H18" />
    </svg>
  );
}

/** Iconsax `3-dots-more` */
export function DotsThreeIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 10C3.9 10 3 10.9 3 12C3 13.1 3.9 14 5 14C6.1 14 7 13.1 7 12C7 10.9 6.1 10 5 10Z" />
      <path d="M19 10C17.9 10 17 10.9 17 12C17 13.1 17.9 14 19 14C20.1 14 21 13.1 21 12C21 10.9 20.1 10 19 10Z" />
      <path d="M12 10C10.9 10 10 10.9 10 12C10 13.1 10.9 14 12 14C13.1 14 14 13.1 14 12C14 10.9 13.1 10 12 10Z" />
    </svg>
  );
}

/** Iconsax `import-arrow-01` */
export function DownloadSimpleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16.44 8.90039C20.04 9.21039 21.51 11.0604 21.51 15.1104V15.2404C21.51 19.7104 19.72 21.5004 15.25 21.5004H8.73998C4.26998 21.5004 2.47998 19.7104 2.47998 15.2404V15.1104C2.47998 11.0904 3.92998 9.24039 7.46998 8.91039" />
      <path d="M12 2V14.88" />
      <path d="M15.3499 12.6504L11.9999 16.0004L8.6499 12.6504" />
    </svg>
  );
}

/** Iconsax `sms` */
export function EnvelopeIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M17 20.5H7C4 20.5 2 19 2 15.5V8.5C2 5 4 3.5 7 3.5H17C20 3.5 22 5 22 8.5V15.5C22 19 20 20.5 17 20.5Z" />
      <path d="M17 9L13.87 11.5C12.84 12.32 11.15 12.32 10.12 11.5L7 9" />
    </svg>
  );
}

/** Iconsax `eye` */
export function EyeIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M15.58 11.9999C15.58 13.9799 13.98 15.5799 12 15.5799C10.02 15.5799 8.42004 13.9799 8.42004 11.9999C8.42004 10.0199 10.02 8.41992 12 8.41992C13.98 8.41992 15.58 10.0199 15.58 11.9999Z" />
      <path d="M12 20.2707C15.53 20.2707 18.82 18.1907 21.11 14.5907C22.01 13.1807 22.01 10.8107 21.11 9.4007C18.82 5.8007 15.53 3.7207 12 3.7207C8.46997 3.7207 5.17997 5.8007 2.88997 9.4007C1.98997 10.8107 1.98997 13.1807 2.88997 14.5907C5.17997 18.1907 8.46997 20.2707 12 20.2707Z" />
    </svg>
  );
}

/** Iconsax `eye-slash` */
export function EyeSlashIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M14.53 9.46992L9.47004 14.5299C8.82004 13.8799 8.42004 12.9899 8.42004 11.9999C8.42004 10.0199 10.02 8.41992 12 8.41992C12.99 8.41992 13.88 8.81992 14.53 9.46992Z" />
      <path d="M17.82 5.77047C16.07 4.45047 14.07 3.73047 12 3.73047C8.46997 3.73047 5.17997 5.81047 2.88997 9.41047C1.98997 10.8205 1.98997 13.1905 2.88997 14.6005C3.67997 15.8405 4.59997 16.9105 5.59997 17.7705" />
      <path d="M8.42004 19.5297C9.56004 20.0097 10.77 20.2697 12 20.2697C15.53 20.2697 18.82 18.1897 21.11 14.5897C22.01 13.1797 22.01 10.8097 21.11 9.39969C20.78 8.87969 20.42 8.38969 20.05 7.92969" />
      <path d="M15.5099 12.6992C15.2499 14.1092 14.0999 15.2592 12.6899 15.5192" />
      <path d="M9.47 14.5293L2 21.9993" />
      <path d="M22 2L14.53 9.47" />
    </svg>
  );
}

/** Iconsax `colorfilter` */
export function EyedropperIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M14 16.0009C14 17.7709 13.23 19.3709 12 20.4609C10.94 21.4209 9.54 22.0009 8 22.0009C4.69 22.0009 2 19.3109 2 16.0009C2 13.2409 3.88 10.9009 6.42 10.2109C7.11 11.9509 8.59 13.2909 10.42 13.7909C10.92 13.9309 11.45 14.0009 12 14.0009C12.55 14.0009 13.08 13.9309 13.58 13.7909C13.85 14.4709 14 15.2209 14 16.0009Z" />
      <path d="M18 8C18 8.78 17.85 9.53 17.58 10.21C16.89 11.95 15.41 13.29 13.58 13.79C13.08 13.93 12.55 14 12 14C11.45 14 10.92 13.93 10.42 13.79C8.59 13.29 7.11 11.95 6.42 10.21C6.15 9.53 6 8.78 6 8C6 4.69 8.69 2 12 2C15.31 2 18 4.69 18 8Z" />
      <path d="M22 16.0009C22 19.3109 19.31 22.0009 16 22.0009C14.46 22.0009 13.06 21.4209 12 20.4609C13.23 19.3709 14 17.7709 14 16.0009C14 15.2209 13.85 14.4709 13.58 13.7909C15.41 13.2909 16.89 11.9509 17.58 10.2109C20.12 10.9009 22 13.2409 22 16.0009Z" />
    </svg>
  );
}

/** Iconsax `receipt-search` */
export function FileMagnifyingGlassIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M20.5 11.3V7.04001C20.5 3.01001 19.56 2 15.78 2H8.22C4.44 2 3.5 3.01001 3.5 7.04001V18.3C3.5 20.96 4.96001 21.59 6.73001 19.69L6.73999 19.68C7.55999 18.81 8.80999 18.88 9.51999 19.83L10.53 21.18" />
      <path d="M18.2 21.4C19.9673 21.4 21.4 19.9673 21.4 18.2C21.4 16.4327 19.9673 15 18.2 15C16.4327 15 15 16.4327 15 18.2C15 19.9673 16.4327 21.4 18.2 21.4Z" />
      <path d="M22 22L21 21" />
      <path d="M8 7H16" />
      <path d="M9 11H15" />
    </svg>
  );
}

/** Iconsax `document-text` */
export function FileTextIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M21 7V17C21 20 19.5 22 16 22H8C4.5 22 3 20 3 17V7C3 4 4.5 2 8 2H16C19.5 2 21 4 21 7Z" />
      <path d="M14.5 4.5V6.5C14.5 7.6 15.4 8.5 16.5 8.5H18.5" />
      <path d="M8 13H12" />
      <path d="M8 17H16" />
    </svg>
  );
}

/** Iconsax `finger-scan` */
export function FingerprintIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 14.8794C11.09 14.8794 10.35 14.1394 10.35 13.2294V10.7594C10.35 9.8494 11.09 9.10938 12 9.10938C12.91 9.10938 13.65 9.8494 13.65 10.7594V13.2294C13.65 14.1394 12.91 14.8794 12 14.8794Z" />
      <path d="M16.98 13.4697C16.78 16.0497 14.62 18.0697 12 18.0697C9.24 18.0697 7 15.8297 7 13.0697V10.9297C7 8.16969 9.24 5.92969 12 5.92969C14.59 5.92969 16.72 7.89968 16.97 10.4197" />
      <path d="M15 2H17C20 2 22 4 22 7V9" />
      <path d="M2 9V7C2 4 4 2 7 2H9" />
      <path d="M15 22H17C20 22 22 20 22 17V15" />
      <path d="M2 15V17C2 20 4 22 7 22H9" />
    </svg>
  );
}

/** Iconsax `magicpen` */
export function FlaskIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3.49994 20.4995C4.32994 21.3295 5.66994 21.3295 6.49994 20.4995L19.4999 7.49945C20.3299 6.66945 20.3299 5.32945 19.4999 4.49945C18.6699 3.66945 17.3299 3.66945 16.4999 4.49945L3.49994 17.4995C2.66994 18.3295 2.66994 19.6695 3.49994 20.4995Z" />
      <path d="M18.01 8.99023L15.01 5.99023" />
      <path d="M8.5 2.44L10 2L9.56 3.5L10 5L8.5 4.56L7 5L7.44 3.5L7 2L8.5 2.44Z" />
      <path d="M4.5 8.44L6 8L5.56 9.5L6 11L4.5 10.56L3 11L3.44 9.5L3 8L4.5 8.44Z" />
      <path d="M19.5 13.44L21 13L20.56 14.5L21 16L19.5 15.56L18 16L18.44 14.5L18 13L19.5 13.44Z" />
    </svg>
  );
}

/** Iconsax `save-2` */
export function FloppyDiskIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12.89 5.88086H5.10999C3.39999 5.88086 2 7.28084 2 8.99084V20.3509C2 21.8009 3.04 22.4208 4.31 21.7108L8.23999 19.5208C8.65999 19.2908 9.34 19.2908 9.75 19.5208L13.68 21.7108C14.95 22.4208 15.99 21.8009 15.99 20.3509V8.99084C16 7.28084 14.6 5.88086 12.89 5.88086Z" />
      <path d="M16 8.99084V20.3509C16 21.8009 14.96 22.4108 13.69 21.7108L9.76001 19.5208C9.34001 19.2908 8.65999 19.2908 8.23999 19.5208L4.31 21.7108C3.04 22.4108 2 21.8009 2 20.3509V8.99084C2 7.28084 3.39999 5.88086 5.10999 5.88086H12.89C14.6 5.88086 16 7.28084 16 8.99084Z" />
      <path d="M22 5.10999V16.47C22 17.92 20.96 18.53 19.69 17.83L16 15.77V8.98999C16 7.27999 14.6 5.88 12.89 5.88H8V5.10999C8 3.39999 9.39999 2 11.11 2H18.89C20.6 2 22 3.39999 22 5.10999Z" />
    </svg>
  );
}

/** Iconsax `filter` */
export function FunnelSimpleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M5.40002 2.09961H18.6C19.7 2.09961 20.6 2.99961 20.6 4.09961V6.29961C20.6 7.09961 20.1 8.09961 19.6 8.59961L15.3 12.3996C14.7 12.8996 14.3 13.8996 14.3 14.6996V18.9996C14.3 19.5996 13.9 20.3996 13.4 20.6996L12 21.5996C10.7 22.3996 8.90002 21.4996 8.90002 19.8996V14.5996C8.90002 13.8996 8.50002 12.9996 8.10002 12.4996L4.30002 8.49961C3.80002 7.99961 3.40002 7.09961 3.40002 6.49961V4.19961C3.40002 2.99961 4.30002 2.09961 5.40002 2.09961Z" />
      <path d="M10.93 2.09961L6 9.99961" />
    </svg>
  );
}

/** Iconsax `speedometer` */
export function GaugeIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M19.14 19.5C20.91 17.7 22 15.22 22 12.5C22 6.98 17.52 2.5 12 2.5C6.48 2.5 2 6.98 2 12.5C2 15.22 3.08 17.68 4.84 19.49" />
      <path d="M12 21.5002C13.8667 21.5002 15.38 19.987 15.38 18.1202C15.38 16.2535 13.8667 14.7402 12 14.7402C10.1333 14.7402 8.62 16.2535 8.62 18.1202C8.62 19.987 10.1333 21.5002 12 21.5002Z" />
      <path d="M15.25 12H16C16.82 12 17.5 11.33 17.5 10.5C17.5 9.68 16.82 9 16 9C15.18 9 14.5 9.67 14.5 10.5V11.25C14.5 11.66 14.84 12 15.25 12Z" />
    </svg>
  );
}

/** Iconsax `setting-2` */
export function GearIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" />
      <path d="M2 12.8794V11.1194C2 10.0794 2.85 9.21945 3.9 9.21945C5.71 9.21945 6.45 7.93945 5.54 6.36945C5.02 5.46945 5.33 4.29945 6.24 3.77945L7.97 2.78945C8.76 2.31945 9.78 2.59945 10.25 3.38945L10.36 3.57945C11.26 5.14945 12.74 5.14945 13.65 3.57945L13.76 3.38945C14.23 2.59945 15.25 2.31945 16.04 2.78945L17.77 3.77945C18.68 4.29945 18.99 5.46945 18.47 6.36945C17.56 7.93945 18.3 9.21945 20.11 9.21945C21.15 9.21945 22.01 10.0694 22.01 11.1194V12.8794C22.01 13.9194 21.16 14.7794 20.11 14.7794C18.3 14.7794 17.56 16.0594 18.47 17.6294C18.99 18.5394 18.68 19.6994 17.77 20.2194L16.04 21.2094C15.25 21.6794 14.23 21.3994 13.76 20.6094L13.65 20.4194C12.75 18.8494 11.27 18.8494 10.36 20.4194L10.25 20.6094C9.78 21.3994 8.76 21.6794 7.97 21.2094L6.24 20.2194C5.33 19.6994 5.02 18.5294 5.54 17.6294C6.45 16.0594 5.71 14.7794 3.9 14.7794C2.85 14.7794 2 13.9194 2 12.8794Z" />
    </svg>
  );
}

/** Iconsax `gift-11` */
export function GiftIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9.78 4.22H4.22C2.99 4.22 2 5.21 2 6.44V19.77C2 21 2.99 21.99 4.22 21.99H9.78C11.01 21.99 12 21 12 19.77V6.44C12 5.21 11.01 4.22 9.78 4.22Z" />
      <path d="M19.78 12H14.22C12.99 12 12 12.99 12 14.22V19.78C12 21.01 12.99 22 14.22 22H19.78C21.01 22 22 21.01 22 19.78V14.22C22 12.99 21.01 12 19.78 12Z" />
      <path d="M4.78027 2L7.00027 4.22L9.22027 2" />
      <path d="M14.7803 9.78L17.0003 12L19.2203 9.78" />
    </svg>
  );
}

/** Iconsax `hierarchy-2` */
export function GitBranchIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 15V8" />
      <path d="M5.25 22C7.04493 22 8.5 20.5449 8.5 18.75C8.5 16.9551 7.04493 15.5 5.25 15.5C3.45507 15.5 2 16.9551 2 18.75C2 20.5449 3.45507 22 5.25 22Z" />
      <path d="M5 8C6.65685 8 8 6.65685 8 5C8 3.34315 6.65685 2 5 2C3.34315 2 2 3.34315 2 5C2 6.65685 3.34315 8 5 8Z" />
      <path d="M19 8C20.6569 8 22 6.65685 22 5C22 3.34315 20.6569 2 19 2C17.3431 2 16 3.34315 16 5C16 6.65685 17.3431 8 19 8Z" />
      <path d="M5.13 15.0009C5.58 13.2509 7.18 11.9509 9.07 11.9609L12.5 11.9709C15.12 11.9809 17.35 10.3009 18.17 7.96094" />
    </svg>
  );
}

/** Iconsax `hierarchy-3` */
export function GitDiffIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 8C6.65685 8 8 6.65685 8 5C8 3.34315 6.65685 2 5 2C3.34315 2 2 3.34315 2 5C2 6.65685 3.34315 8 5 8Z" />
      <path d="M19 15C20.6569 15 22 13.6569 22 12C22 10.3431 20.6569 9 19 9C17.3431 9 16 10.3431 16 12C16 13.6569 17.3431 15 19 15Z" />
      <path d="M5 22C6.65685 22 8 20.6569 8 19C8 17.3431 6.65685 16 5 16C3.34315 16 2 17.3431 2 19C2 20.6569 3.34315 22 5 22Z" />
      <path d="M16 12H9C6.8 12 5 11 5 8V16" />
    </svg>
  );
}

/** Iconsax `global` */
export function GlobeIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" />
      <path d="M7.99998 3H8.99998C7.04998 8.84 7.04998 15.16 8.99998 21H7.99998" />
      <path d="M15 3C16.95 8.84 16.95 15.16 15 21" />
      <path d="M3 16V15C8.84 16.95 15.16 16.95 21 15V16" />
      <path d="M3 8.99961C8.84 7.04961 15.16 7.04961 21 8.99961" />
    </svg>
  );
}

/** Iconsax `grid-4` */
export function GridFourIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z" />
      <path d="M9 2V22" />
    </svg>
  );
}

/** Iconsax `health` */
export function HeartbeatIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8.96997 22H14.97C19.97 22 21.97 20 21.97 15V9C21.97 4 19.97 2 14.97 2H8.96997C3.96997 2 1.96997 4 1.96997 9V15C1.96997 20 3.96997 22 8.96997 22Z" />
      <path d="M1.96997 12.7001L7.96997 12.6801C8.71997 12.6801 9.55997 13.2501 9.83997 13.9501L10.98 16.8301C11.24 17.4801 11.65 17.4801 11.91 16.8301L14.2 11.0201C14.42 10.4601 14.83 10.4401 15.11 10.9701L16.15 12.9401C16.46 13.5301 17.26 14.0101 17.92 14.0101H21.98" />
    </svg>
  );
}

/** Iconsax `personalcard` */
export function IdentificationCardIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M17 21H7C3 21 2 20 2 16V8C2 4 3 3 7 3H17C21 3 22 4 22 8V16C22 20 21 21 17 21Z" />
      <path d="M14 8H19" />
      <path d="M15 12H19" />
      <path d="M17 16H19" />
      <path d="M8.49994 11.2899C9.49958 11.2899 10.3099 10.4796 10.3099 9.47992C10.3099 8.48029 9.49958 7.66992 8.49994 7.66992C7.50031 7.66992 6.68994 8.48029 6.68994 9.47992C6.68994 10.4796 7.50031 11.2899 8.49994 11.2899Z" />
      <path d="M12 16.3298C11.86 14.8798 10.71 13.7398 9.26 13.6098C8.76 13.5598 8.25 13.5598 7.74 13.6098C6.29 13.7498 5.14 14.8798 5 16.3298" />
    </svg>
  );
}

/** Iconsax `info-circle` */
export function InfoIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z" />
      <path d="M12 8V13" />
      <path d="M11.9945 16H12.0035" />
    </svg>
  );
}

/** Iconsax `key` */
export function KeyIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M19.79 14.9303C17.73 16.9803 14.78 17.6103 12.19 16.8003L7.48002 21.5003C7.14002 21.8503 6.47002 22.0603 5.99002 21.9903L3.81002 21.6903C3.09002 21.5903 2.42002 20.9103 2.31002 20.1903L2.01002 18.0103C1.94002 17.5303 2.17002 16.8603 2.50002 16.5203L7.20002 11.8203C6.40002 9.22031 7.02002 6.27031 9.08002 4.22031C12.03 1.27031 16.82 1.27031 19.78 4.22031C22.74 7.17031 22.74 11.9803 19.79 14.9303Z" />
      <path d="M6.89001 17.4902L9.19001 19.7902" />
      <path d="M14.5 11C15.3284 11 16 10.3284 16 9.5C16 8.67157 15.3284 8 14.5 8C13.6716 8 13 8.67157 13 9.5C13 10.3284 13.6716 11 14.5 11Z" />
    </svg>
  );
}

/** Iconsax `keyboard` */
export function KeyboardIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7.5 4H16.5C17.12 4 17.67 4.02 18.16 4.09C20.79 4.38 21.5 5.62 21.5 9V15C21.5 18.38 20.79 19.62 18.16 19.91C17.67 19.98 17.12 20 16.5 20H7.5C6.88 20 6.33 19.98 5.84 19.91C3.21 19.62 2.5 18.38 2.5 15V9C2.5 5.62 3.21 4.38 5.84 4.09C6.33 4.02 6.88 4 7.5 4Z" />
      <path d="M13.5 10H17" />
      <path d="M7 15.5H7.02H17" />
      <path d="M10.0946 10H10.1036" />
      <path d="M7.0946 10H7.10359" />
    </svg>
  );
}

/** Iconsax `lamp-on` */
export function LightbulbIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8.29999 18.0402V16.8802C5.99999 15.4902 4.10999 12.7802 4.10999 9.90018C4.10999 4.95018 8.65999 1.07018 13.8 2.19018C16.06 2.69018 18.04 4.19018 19.07 6.26018C21.16 10.4602 18.96 14.9202 15.73 16.8702V18.0302C15.73 18.3202 15.84 18.9902 14.77 18.9902H9.25999C8.15999 19.0002 8.29999 18.5702 8.29999 18.0402Z" />
      <path d="M8.5 21.9992C10.79 21.3492 13.21 21.3492 15.5 21.9992" />
    </svg>
  );
}

/** Iconsax `flash` */
export function LightningIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6.08998 13.2809H9.17998V20.4809C9.17998 22.1609 10.09 22.5009 11.2 21.2409L18.77 12.6409C19.7 11.5909 19.31 10.7209 17.9 10.7209H14.81V3.52087C14.81 1.84087 13.9 1.50087 12.79 2.76087L5.21998 11.3609C4.29998 12.4209 4.68998 13.2809 6.08998 13.2809Z" />
    </svg>
  );
}

/** Iconsax `link-2` */
export function LinkBreakIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M13.5 12C13.5 15.18 10.93 17.75 7.75 17.75C4.57 17.75 2 15.18 2 12C2 8.82 4.57 6.25 7.75 6.25" />
      <path d="M10 12C10 8.69 12.69 6 16 6C19.31 6 22 8.69 22 12C22 15.31 19.31 18 16 18" />
    </svg>
  );
}

/** Iconsax `link` */
export function LinkIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M14.99 17.5H16.5C19.52 17.5 22 15.03 22 12C22 8.98 19.53 6.5 16.5 6.5H14.99" />
      <path d="M9 6.5H7.5C4.47 6.5 2 8.97 2 12C2 15.02 4.47 17.5 7.5 17.5H9" />
      <path d="M8 12H16" />
    </svg>
  );
}

/** Iconsax `task-square` */
export function ListChecksIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12.37 8.88086H17.62" />
      <path d="M6.38 8.88086L7.13 9.63086L9.38 7.38086" />
      <path d="M12.37 15.8809H17.62" />
      <path d="M6.38 15.8809L7.13 16.6309L9.38 14.3809" />
      <path d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z" />
    </svg>
  );
}

/** Iconsax `menu` */
export function ListIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 7H21" />
      <path d="M3 12H21" />
      <path d="M3 17H21" />
    </svg>
  );
}

/** Iconsax `lock` */
export function LockIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 10V8C6 4.69 7 2 12 2C17 2 18 4.69 18 8V10" />
      <path d="M17 22H7C3 22 2 21 2 17V15C2 11 3 10 7 10H17C21 10 22 11 22 15V17C22 21 21 22 17 22Z" />
      <path d="M15.9965 16H16.0054" />
      <path d="M11.9955 16H12.0045" />
      <path d="M7.99451 16H8.00349" />
    </svg>
  );
}

/** Iconsax `search-normal` */
export function MagnifyingGlassIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M11 20C15.9706 20 20 15.9706 20 11C20 6.02944 15.9706 2 11 2C6.02944 2 2 6.02944 2 11C2 15.9706 6.02944 20 11 20Z" />
      <path d="M18.8978 20.4629C19.1822 22.1242 20.3546 22.4637 21.4838 21.2188C22.5159 20.0805 22.1195 18.9585 20.5969 18.7278C19.4713 18.5472 18.7052 19.3313 18.8978 20.4629Z" />
    </svg>
  );
}

/** Iconsax `volume-high` */
export function MegaphoneIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2 9.99979V13.9998C2 15.9998 3 16.9998 5 16.9998H6.43C6.8 16.9998 7.17 17.1098 7.49 17.2998L10.41 19.1298C12.93 20.7098 15 19.5598 15 16.5898V7.40979C15 4.42979 12.93 3.28979 10.41 4.86979L7.49 6.69979C7.17 6.88979 6.8 6.99979 6.43 6.99979H5C3 6.99979 2 7.99979 2 9.99979Z" />
      <path d="M18 8C19.78 10.37 19.78 13.63 18 16" />
      <path d="M19.83 5.5C22.72 9.35 22.72 14.65 19.83 18.5" />
    </svg>
  );
}

/** Iconsax `minus` */
export function MinusIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 12H18" />
    </svg>
  );
}

/** Iconsax `monitor` */
export function MonitorIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6.44 2H17.55C21.11 2 22 2.89 22 6.44V12.77C22 16.33 21.11 17.21 17.56 17.21H6.44C2.89 17.22 2 16.33 2 12.78V6.44C2 2.89 2.89 2 6.44 2Z" />
      <path d="M12 17.2207V22.0007" />
      <path d="M2 13H22" />
      <path d="M7.5 22H16.5" />
    </svg>
  );
}

/** Iconsax `moon` */
export function MoonIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2.02997 12.42C2.38997 17.57 6.75997 21.76 11.99 21.99C15.68 22.15 18.98 20.43 20.96 17.72C21.78 16.61 21.34 15.87 19.97 16.12C19.3 16.24 18.61 16.29 17.89 16.26C13 16.06 8.99997 11.97 8.97997 7.13996C8.96997 5.83996 9.23997 4.60996 9.72997 3.48996C10.27 2.24996 9.61997 1.65996 8.36997 2.18996C4.40997 3.85996 1.69997 7.84996 2.02997 12.42Z" />
    </svg>
  );
}

/** Iconsax `note-text` */
export function NewspaperIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 2V5" />
      <path d="M16 2V5" />
      <path d="M21 8.5V17C21 20 19.5 22 16 22H8C4.5 22 3 20 3 17V8.5C3 5.5 4.5 3.5 8 3.5H16C19.5 3.5 21 5.5 21 8.5Z" />
      <path d="M8 11H16" />
      <path d="M8 16H12" />
    </svg>
  );
}

/** Iconsax `edit` */
export function NotePencilIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M11 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22H15C20 22 22 20 22 15V13" />
      <path d="M16.04 3.01928L8.16 10.8993C7.86 11.1993 7.56 11.7893 7.5 12.2193L7.07 15.2293C6.91 16.3193 7.68 17.0793 8.77 16.9293L11.78 16.4993C12.2 16.4393 12.79 16.1393 13.1 15.8393L20.98 7.95928C22.34 6.59928 22.98 5.01928 20.98 3.01928C18.98 1.01928 17.4 1.65928 16.04 3.01928Z" />
      <path d="M14.91 4.15039C15.58 6.54039 17.45 8.41039 19.85 9.09039" />
    </svg>
  );
}

/** Iconsax `box-2` */
export function PackageIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3.17004 7.43945L12 12.5494L20.77 7.46942" />
      <path d="M12 21.6091V12.5391" />
      <path d="M9.92999 2.48L4.59 5.45003C3.38 6.12003 2.39001 7.80001 2.39001 9.18001V14.83C2.39001 16.21 3.38 17.89 4.59 18.56L9.92999 21.53C11.07 22.16 12.94 22.16 14.08 21.53L19.42 18.56C20.63 17.89 21.62 16.21 21.62 14.83V9.18001C21.62 7.80001 20.63 6.12003 19.42 5.45003L14.08 2.48C12.93 1.84 11.07 1.84 9.92999 2.48Z" />
      <path d="M17 13.2396V9.57965L7.51001 4.09961" />
    </svg>
  );
}

/** Iconsax `color-swatch` */
export function PaletteIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 4.5V18C10 19.08 9.55999 20.07 8.85999 20.79L8.82001 20.83C8.73001 20.92 8.63001 21.01 8.54001 21.08C8.24001 21.34 7.89999 21.54 7.54999 21.68C7.43999 21.73 7.33 21.77 7.22 21.81C6.83 21.94 6.41 22 6 22C5.73 22 5.46001 21.97 5.20001 21.92C5.07001 21.89 4.94 21.86 4.81 21.82C4.65 21.77 4.50001 21.72 4.35001 21.65C4.35001 21.64 4.35 21.64 4.34 21.65C4.06 21.51 3.79001 21.35 3.54001 21.16L3.53 21.15C3.4 21.05 3.28001 20.95 3.17001 20.83C3.06001 20.71 2.95 20.59 2.84 20.46C2.65 20.21 2.49001 19.94 2.35001 19.66C2.36001 19.65 2.36001 19.65 2.35001 19.65C2.35001 19.65 2.35 19.64 2.34 19.63C2.28 19.49 2.22999 19.34 2.17999 19.19C2.13999 19.06 2.10999 18.93 2.07999 18.8C2.02999 18.54 2 18.27 2 18V4.5C2 3 3 2 4.5 2H7.5C9 2 10 3 10 4.5Z" />
      <path d="M22 16.5V19.5C22 21 21 22 19.5 22H6C6.41 22 6.83 21.94 7.22 21.81C7.33 21.77 7.43999 21.73 7.54999 21.68C7.89999 21.54 8.24001 21.34 8.54001 21.08C8.63001 21.01 8.73001 20.92 8.82001 20.83L8.85999 20.79L15.66 14H19.5C21 14 22 15 22 16.5Z" />
      <path d="M4.80994 21.8195C4.20994 21.6395 3.63995 21.3095 3.16995 20.8295C2.68995 20.3595 2.35993 19.7895 2.17993 19.1895C2.56993 20.4395 3.55994 21.4295 4.80994 21.8195Z" />
      <path d="M18.37 11.2909L15.66 14.0009L8.85999 20.7909C9.55999 20.0709 10 19.0809 10 18.0009V8.34093L12.71 5.63094C13.77 4.57094 15.19 4.57094 16.25 5.63094L18.37 7.75093C19.43 8.81093 19.43 10.2309 18.37 11.2909Z" />
      <path d="M6 19C6.55228 19 7 18.5523 7 18C7 17.4477 6.55228 17 6 17C5.44772 17 5 17.4477 5 18C5 18.5523 5.44772 19 6 19Z" />
    </svg>
  );
}

/** Iconsax `send` */
export function PaperPlaneTiltIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3.5 22H20.5" />
      <path d="M5 3.5L19 17.5" />
      <path d="M5 13.77V3.5H15.27" />
    </svg>
  );
}

/** Iconsax `pause-circle` */
export function PauseCircleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M11.97 22C17.4928 22 21.97 17.5228 21.97 12C21.97 6.47715 17.4928 2 11.97 2C6.44712 2 1.96997 6.47715 1.96997 12C1.96997 17.5228 6.44712 22 11.97 22Z" />
      <path d="M10.72 14.5298V9.4698C10.72 8.9898 10.52 8.7998 10.01 8.7998H8.71C8.2 8.7998 8 8.9898 8 9.4698V14.5298C8 15.0098 8.2 15.1998 8.71 15.1998H10C10.52 15.1998 10.72 15.0098 10.72 14.5298Z" />
      <path d="M16 14.5298V9.4698C16 8.9898 15.8 8.7998 15.29 8.7998H14C13.49 8.7998 13.29 8.9898 13.29 9.4698V14.5298C13.29 15.0098 13.49 15.1998 14 15.1998H15.29C15.8 15.1998 16 15.0098 16 14.5298Z" />
    </svg>
  );
}

/** Iconsax `pause` */
export function PauseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10.65 19.11V4.89C10.65 3.54 10.08 3 8.64 3H5.01C3.57 3 3 3.54 3 4.89V19.11C3 20.46 3.57 21 5.01 21H8.64C10.08 21 10.65 20.46 10.65 19.11Z" />
      <path d="M21 19.11V4.89C21 3.54 20.43 3 18.99 3H15.36C13.93 3 13.35 3.54 13.35 4.89V19.11C13.35 20.46 13.92 21 15.36 21H18.99C20.43 21 21 20.46 21 19.11Z" />
    </svg>
  );
}

/** Iconsax `edit-2` */
export function PencilIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M13.26 3.59924L5.04997 12.2892C4.73997 12.6192 4.43997 13.2692 4.37997 13.7192L4.00997 16.9592C3.87997 18.1292 4.71997 18.9292 5.87997 18.7292L9.09997 18.1792C9.54997 18.0992 10.18 17.7692 10.49 17.4292L18.7 8.73924C20.12 7.23924 20.76 5.52924 18.55 3.43924C16.35 1.36924 14.68 2.09924 13.26 3.59924Z" />
      <path d="M11.89 5.05078C12.32 7.81078 14.56 9.92078 17.34 10.2008" />
      <path d="M3 22H21" />
    </svg>
  );
}

/** Iconsax `edit` */
export function PencilSimpleLineIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M11 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22H15C20 22 22 20 22 15V13" />
      <path d="M16.04 3.01928L8.16 10.8993C7.86 11.1993 7.56 11.7893 7.5 12.2193L7.07 15.2293C6.91 16.3193 7.68 17.0793 8.77 16.9293L11.78 16.4993C12.2 16.4393 12.79 16.1393 13.1 15.8393L20.98 7.95928C22.34 6.59928 22.98 5.01928 20.98 3.01928C18.98 1.01928 17.4 1.65928 16.04 3.01928Z" />
      <path d="M14.91 4.15039C15.58 6.54039 17.45 8.41039 19.85 9.09039" />
    </svg>
  );
}

/** Iconsax `tree` */
export function PlantIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16.17 10.0603H7.82994C6.64995 10.0603 6.23995 9.27031 6.92995 8.31031L11.1 2.47031C11.59 1.77031 12.41 1.77031 12.89 2.47031L17.06 8.31031C17.76 9.27031 17.35 10.0603 16.17 10.0603Z" />
      <path d="M17.59 18.0005H6.41998C4.83998 18.0005 4.29998 16.9505 5.22998 15.6705L9.21997 10.0605H14.79L18.78 15.6705C19.71 16.9505 19.17 18.0005 17.59 18.0005Z" />
      <path d="M12 22V18" />
    </svg>
  );
}

/** Iconsax `play` */
export function PlayIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 12.0004V8.44038C4 4.02038 7.13 2.21038 10.96 4.42038L14.05 6.20038L17.14 7.98038C20.97 10.1904 20.97 13.8104 17.14 16.0204L14.05 17.8004L10.96 19.5804C7.13 21.7904 4 19.9804 4 15.5604V12.0004Z" />
    </svg>
  );
}

/** Iconsax `electricity` */
export function PlugsIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10.5 16H13.5C16 16 17.5 14.2 17.5 12V6.91C17.5 5.86 16.64 5 15.59 5H8.42006C7.37006 5 6.51006 5.86 6.51006 6.91V12C6.50006 14.2 8.00005 16 10.5 16Z" />
      <path d="M9.5 2V5" />
      <path d="M14.5 2V5" />
      <path d="M12 22V16" />
    </svg>
  );
}

/** Iconsax `add` */
export function PlusIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 12H18" />
      <path d="M12 18V6" />
    </svg>
  );
}

/** Iconsax `toggle-on` */
export function PowerIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M13.3 16H15.7C17.7 16 18.5 15.2 18.5 13.2V10.8C18.5 8.8 17.7 8 15.7 8H13.3C11.3 8 10.5 8.8 10.5 10.8V13.2C10.5 15.2 11.3 16 13.3 16Z" />
      <path d="M17 20H7C3 20 2 19 2 15V9C2 5 3 4 7 4H17C21 4 22 5 22 9V15C22 19 21 20 17 20Z" />
    </svg>
  );
}

/** Iconsax `printer` */
export function PrinterIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7.25 7H16.75V5C16.75 3 16 2 13.75 2H10.25C8 2 7.25 3 7.25 5V7Z" />
      <path d="M16 15V19C16 21 15 22 13 22H11C9 22 8 21 8 19V15H16Z" />
      <path d="M21 10V15C21 17 20 18 18 18H16V15H8V18H6C4 18 3 17 3 15V10C3 8 4 7 6 7H18C20 7 21 8 21 10Z" />
      <path d="M17 15H15.79H7" />
      <path d="M7 11H10" />
    </svg>
  );
}

/** Iconsax `slash` */
export function ProhibitIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22Z" />
      <path d="M18.9 5L4.90002 19" />
    </svg>
  );
}

/** Iconsax `activity` */
export function PulseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z" />
      <path d="M7.32996 14.4898L9.70996 11.3998C10.05 10.9598 10.68 10.8798 11.12 11.2198L12.95 12.6598C13.39 12.9998 14.02 12.9198 14.36 12.4898L16.67 9.50977" />
    </svg>
  );
}

/** Iconsax `shapes` */
export function PuzzlePieceIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M13.43 14.9995H4.39997C2.57997 14.9995 1.41997 13.0495 2.29997 11.4495L4.62997 7.20945L6.80997 3.23945C7.71997 1.58945 10.1 1.58945 11.01 3.23945L13.2 7.20945L14.25 9.11946L15.53 11.4495C16.41 13.0495 15.25 14.9995 13.43 14.9995Z" />
      <path d="M22 15.5C22 19.09 19.09 22 15.5 22C11.91 22 9 19.09 9 15.5C9 15.33 9.01 15.17 9.02 15H13.43C15.25 15 16.41 13.05 15.53 11.45L14.25 9.12C14.65 9.04 15.07 9 15.5 9C19.09 9 22 11.91 22 15.5Z" />
    </svg>
  );
}

/** Iconsax `message-question` */
export function QuestionIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M17 18.4297H13L8.54999 21.3897C7.88999 21.8297 7 21.3598 7 20.5598V18.4297C4 18.4297 2 16.4297 2 13.4297V7.42969C2 4.42969 4 2.42969 7 2.42969H17C20 2.42969 22 4.42969 22 7.42969V13.4297C22 16.4297 20 18.4297 17 18.4297Z" />
      <path d="M12.0001 11.3594V11.1494C12.0001 10.4694 12.4201 10.1094 12.8401 9.8194C13.2501 9.5394 13.66 9.17941 13.66 8.51941C13.66 7.59941 12.9201 6.85938 12.0001 6.85938C11.0801 6.85938 10.3401 7.59941 10.3401 8.51941" />
      <path d="M11.9955 13.75H12.0045" />
    </svg>
  );
}

/** Iconsax `send-2` */
export function RocketIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7.40005 6.32015L15.8901 3.49015C19.7001 2.22015 21.7701 4.30015 20.5101 8.11015L17.6801 16.6002C15.7801 22.3102 12.6601 22.3102 10.7601 16.6002L9.92005 14.0802L7.40005 13.2402C1.69005 11.3402 1.69005 8.23015 7.40005 6.32015Z" />
      <path d="M10.11 13.6505L13.69 10.0605" />
    </svg>
  );
}

/** Iconsax `row-horizontal` */
export function RowsIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10.5 19.9V4.1C10.5 2.6 9.86 2 8.27 2H4.23C2.64 2 2 2.6 2 4.1V19.9C2 21.4 2.64 22 4.23 22H8.27C9.86 22 10.5 21.4 10.5 19.9Z" />
      <path d="M22 19.9V4.1C22 2.6 21.36 2 19.77 2H15.73C14.14 2 13.5 2.6 13.5 4.1V19.9C13.5 21.4 14.14 22 15.73 22H19.77C21.36 22 22 21.4 22 19.9Z" />
    </svg>
  );
}

/** Iconsax `status` */
export function RssIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2.44995 14.9707C3.51995 18.4107 6.39996 21.0607 9.97996 21.7907" />
      <path d="M2.05005 10.98C2.56005 5.93 6.82005 2 12 2C17.18 2 21.44 5.94 21.95 10.98" />
      <path d="M14.01 21.7995C17.58 21.0695 20.45 18.4495 21.54 15.0195" />
    </svg>
  );
}

/** Iconsax `scan` */
export function ScanIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2 9V6.5C2 4.01 4.01 2 6.5 2H9" />
      <path d="M15 2H17.5C19.99 2 22 4.01 22 6.5V9" />
      <path d="M22 16V17.5C22 19.99 19.99 22 17.5 22H16" />
      <path d="M9 22H6.5C4.01 22 2 19.99 2 17.5V15" />
      <path d="M17 9.5V14.5C17 16.5 16 17.5 14 17.5H10C8 17.5 7 16.5 7 14.5V9.5C7 7.5 8 6.5 10 6.5H14C16 6.5 17 7.5 17 9.5Z" />
      <path d="M19 12H5" />
    </svg>
  );
}

/** Iconsax `scroll` */
export function ScrollIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z" />
      <path d="M9.59996 8.9707L7.10996 11.4607C6.81996 11.7507 6.81996 12.2407 7.10996 12.5307L9.59996 15.0207" />
      <path d="M14.4 8.9707L16.89 11.4607C17.18 11.7507 17.18 12.2407 16.89 12.5307L14.4 15.0207" />
    </svg>
  );
}

/** Iconsax `share` */
export function ShareNetworkIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16.96 6.16992C18.96 7.55992 20.34 9.76992 20.62 12.3199" />
      <path d="M3.48999 12.3707C3.74999 9.8307 5.10999 7.6207 7.08999 6.2207" />
      <path d="M8.18994 20.9395C9.34994 21.5295 10.6699 21.8595 12.0599 21.8595C13.3999 21.8595 14.6599 21.5595 15.7899 21.0095" />
      <path d="M12.06 7.70062C13.5954 7.70062 14.84 6.45598 14.84 4.92062C14.84 3.38527 13.5954 2.14062 12.06 2.14062C10.5247 2.14062 9.28003 3.38527 9.28003 4.92062C9.28003 6.45598 10.5247 7.70062 12.06 7.70062Z" />
      <path d="M4.83005 19.9194C6.3654 19.9194 7.61005 18.6747 7.61005 17.1394C7.61005 15.604 6.3654 14.3594 4.83005 14.3594C3.2947 14.3594 2.05005 15.604 2.05005 17.1394C2.05005 18.6747 3.2947 19.9194 4.83005 19.9194Z" />
      <path d="M19.17 19.9194C20.7054 19.9194 21.95 18.6747 21.95 17.1394C21.95 15.604 20.7054 14.3594 19.17 14.3594C17.6347 14.3594 16.39 15.604 16.39 17.1394C16.39 18.6747 17.6347 19.9194 19.17 19.9194Z" />
    </svg>
  );
}

/** Iconsax `shield-tick` */
export function ShieldCheckIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10.49 2.23055L5.50003 4.11055C4.35003 4.54055 3.41003 5.90055 3.41003 7.12055V14.5505C3.41003 15.7305 4.19003 17.2805 5.14003 17.9905L9.44003 21.2005C10.85 22.2605 13.17 22.2605 14.58 21.2005L18.88 17.9905C19.83 17.2805 20.61 15.7305 20.61 14.5505V7.12055C20.61 5.89055 19.67 4.53055 18.52 4.10055L13.53 2.23055C12.68 1.92055 11.32 1.92055 10.49 2.23055Z" />
      <path d="M9.05005 11.8697L10.66 13.4797L14.96 9.17969" />
    </svg>
  );
}

/** Iconsax `shield` */
export function ShieldIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10.49 2.23055L5.50003 4.11055C4.35003 4.54055 3.41003 5.90055 3.41003 7.12055V14.5505C3.41003 15.7305 4.19003 17.2805 5.14003 17.9905L9.44003 21.2005C10.85 22.2605 13.17 22.2605 14.58 21.2005L18.88 17.9905C19.83 17.2805 20.61 15.7305 20.61 14.5505V7.12055C20.61 5.89055 19.67 4.53055 18.52 4.10055L13.53 2.23055C12.68 1.92055 11.32 1.92055 10.49 2.23055Z" />
    </svg>
  );
}

/** Iconsax `shield-slash` */
export function ShieldSlashIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7.83997 20.0191L9.42997 21.2091C10.84 22.2691 13.16 22.2691 14.57 21.2091L18.87 17.9991C19.82 17.2891 20.6 15.7391 20.6 14.5591V7.11914" />
      <path d="M18.98 4.34055C18.83 4.25055 18.67 4.17055 18.51 4.10055L13.52 2.23055C12.69 1.92055 11.33 1.92055 10.5 2.23055L5.50003 4.11055C4.35003 4.54055 3.41003 5.90055 3.41003 7.12055V14.5505C3.41003 15.7305 4.19003 17.2805 5.14003 17.9905L5.34003 18.1405" />
      <path d="M22 2L2 22" />
    </svg>
  );
}

/** Iconsax `shield-security` */
export function ShieldWarningIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10.49 2.23055L5.50003 4.11055C4.35003 4.54055 3.41003 5.90055 3.41003 7.12055V14.5505C3.41003 15.7305 4.19003 17.2805 5.14003 17.9905L9.44003 21.2005C10.85 22.2605 13.17 22.2605 14.58 21.2005L18.88 17.9905C19.83 17.2805 20.61 15.7305 20.61 14.5505V7.12055C20.61 5.89055 19.67 4.53055 18.52 4.10055L13.53 2.23055C12.68 1.92055 11.32 1.92055 10.49 2.23055Z" />
      <path d="M12 12.5C13.1046 12.5 14 11.6046 14 10.5C14 9.39543 13.1046 8.5 12 8.5C10.8954 8.5 10 9.39543 10 10.5C10 11.6046 10.8954 12.5 12 12.5Z" />
      <path d="M12 12.5V15.5" />
    </svg>
  );
}

/** Iconsax `sidebar-left` */
export function SidebarSimpleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M21.97 15V9C21.97 4 19.97 2 14.97 2H8.96997C3.96997 2 1.96997 4 1.96997 9V15C1.96997 20 3.96997 22 8.96997 22H14.97C19.97 22 21.97 20 21.97 15Z" />
      <path d="M7.96997 2V22" />
      <path d="M14.97 9.43945L12.41 11.9995L14.97 14.5595" />
    </svg>
  );
}

/** Iconsax `logout-01` */
export function SignOutIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M17.4399 14.62L19.9999 12.06L17.4399 9.5" />
      <path d="M9.75977 12.0596H19.9298" />
      <path d="M11.7598 20C7.33977 20 3.75977 17 3.75977 12C3.75977 7 7.33977 4 11.7598 4" />
    </svg>
  );
}

/** Iconsax `slider-horizontal` */
export function SlidersHorizontalIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M18 7V17C18 17.62 17.98 18.17 17.91 18.66C17.62 21.29 16.38 22 13 22H11C7.62 22 6.38 21.29 6.09 18.66C6.02 18.17 6 17.62 6 17V7C6 6.38 6.02 5.83 6.09 5.34C6.38 2.71 7.62 2 11 2H13C16.38 2 17.62 2.71 17.91 5.34C17.98 5.83 18 6.38 18 7Z" />
      <path d="M6 17.0001C6 17.6201 6.02 18.1701 6.09 18.6601C5.95 18.6701 5.82 18.6701 5.67 18.6701H5.33C2.67 18.6701 2 18.0001 2 15.3301V8.67008C2 6.00008 2.67 5.33008 5.33 5.33008H5.67C5.82 5.33008 5.95 5.33008 6.09 5.34008C6.02 5.83008 6 6.38008 6 7.00008V17.0001Z" />
      <path d="M22 8.67008V15.3301C22 18.0001 21.33 18.6701 18.67 18.6701H18.33C18.18 18.6701 18.05 18.6701 17.91 18.6601C17.98 18.1701 18 17.6201 18 17.0001V7.00008C18 6.38008 17.98 5.83008 17.91 5.34008C18.05 5.33008 18.18 5.33008 18.33 5.33008H18.67C21.33 5.33008 22 6.00008 22 8.67008Z" />
    </svg>
  );
}

/** Iconsax `magic-star` */
export function SparkleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M17.29 4.14097L17.22 7.93095C17.21 8.45095 17.54 9.14097 17.96 9.45097L20.44 11.3309C22.03 12.5309 21.77 14.001 19.87 14.601L16.64 15.6109C16.1 15.7809 15.53 16.371 15.39 16.921L14.62 19.8609C14.01 22.1809 12.49 22.411 11.23 20.371L9.46999 17.5209C9.14999 17.0009 8.39 16.611 7.79 16.641L4.45003 16.811C2.06003 16.931 1.38002 15.551 2.94002 13.731L4.92 11.4309C5.29 11.0009 5.46 10.201 5.29 9.66096L4.28005 6.43095C3.69005 4.53095 4.75004 3.48096 6.64004 4.10096L9.59005 5.07096C10.09 5.23096 10.84 5.12095 11.26 4.81095L14.34 2.59095C16 1.39095 17.33 2.09097 17.29 4.14097Z" />
      <path d="M21.91 22.0007L18.88 18.9707" />
    </svg>
  );
}

/** Iconsax `category` */
export function SquaresFourIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 10H7C9 10 10 9 10 7V5C10 3 9 2 7 2H5C3 2 2 3 2 5V7C2 9 3 10 5 10Z" />
      <path d="M17 10H19C21 10 22 9 22 7V5C22 3 21 2 19 2H17C15 2 14 3 14 5V7C14 9 15 10 17 10Z" />
      <path d="M17 22H19C21 22 22 21 22 19V17C22 15 21 14 19 14H17C15 14 14 15 14 17V19C14 21 15 22 17 22Z" />
      <path d="M5 22H7C9 22 10 21 10 19V17C10 15 9 14 7 14H5C3 14 2 15 2 17V19C2 21 3 22 5 22Z" />
    </svg>
  );
}

/** Iconsax `layer` */
export function StackIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M13.01 2.92031L18.91 5.54031C20.61 6.29031 20.61 7.53031 18.91 8.28031L13.01 10.9003C12.34 11.2003 11.24 11.2003 10.57 10.9003L4.67002 8.28031C2.97002 7.53031 2.97002 6.29031 4.67002 5.54031L10.57 2.92031C11.24 2.62031 12.34 2.62031 13.01 2.92031Z" />
      <path d="M3 11C3 11.84 3.63 12.81 4.4 13.15L11.19 16.17C11.71 16.4 12.3 16.4 12.81 16.17L19.6 13.15C20.37 12.81 21 11.84 21 11" />
      <path d="M3 16C3 16.93 3.55 17.77 4.4 18.15L11.19 21.17C11.71 21.4 12.3 21.4 12.81 21.17L19.6 18.15C20.45 17.77 21 16.93 21 16" />
    </svg>
  );
}

/** Iconsax `star` */
export function StarIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M17.1696 10.9C16.8896 11.18 16.7596 11.58 16.8296 11.97L17.2696 14.49C17.3796 15.12 17.1296 15.75 16.5996 16.12C16.0896 16.5 15.4096 16.54 14.8296 16.24L14.4596 16.05L12.5496 15.05C12.2096 14.87 11.7796 14.87 11.4396 15.05L9.52957 16.05L9.15957 16.24C8.59957 16.54 7.91957 16.5 7.38957 16.12C6.86957 15.74 6.60957 15.12 6.71957 14.49L7.15957 11.97C7.22957 11.58 7.08957 11.18 6.81957 10.9L4.98957 9.11C4.51957 8.68 4.36957 8.01 4.55957 7.4C4.74957 6.8 5.26957 6.36 5.89957 6.27L8.42957 5.9C8.81957 5.84 9.15957 5.6 9.33957 5.24L10.4696 2.93H10.4996C10.7896 2.36 11.3596 2 11.9896 2C12.6196 2 13.2096 2.37 13.4896 2.93L14.6196 5.24C14.7996 5.6 15.1396 5.84 15.5296 5.9L18.0596 6.27C18.6896 6.36 19.2196 6.8 19.3996 7.4C19.5896 8.01 19.4296 8.68 18.9696 9.11L17.1396 10.9H17.1696Z" />
      <path d="M14.8998 22H9.08978C8.32978 22 7.79978 21.26 8.03978 20.54L9.52978 16.06L11.4398 15.06C11.7898 14.88 12.1998 14.88 12.5498 15.06L14.4598 16.06L15.9498 20.54C16.1898 21.26 15.6498 22 14.8998 22Z" />
    </svg>
  );
}

/** Iconsax `shop` */
export function StorefrontIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3.01001 11.2207V15.7107C3.01001 20.2007 4.81001 22.0007 9.30001 22.0007H14.69C19.18 22.0007 20.98 20.2007 20.98 15.7107V11.2207" />
      <path d="M12 12C13.83 12 15.18 10.51 15 8.68L14.34 2H9.66999L8.99999 8.68C8.81999 10.51 10.17 12 12 12Z" />
      <path d="M18.31 12C20.33 12 21.81 10.36 21.61 8.35L21.33 5.6C20.97 3 19.97 2 17.35 2H14.3L15 9.01C15.17 10.66 16.66 12 18.31 12Z" />
      <path d="M5.64 12C7.29 12 8.78 10.66 8.94 9.01L9.16 6.8L9.64001 2H6.59C3.97001 2 2.97 3 2.61 5.6L2.34 8.35C2.14 10.36 3.62 12 5.64 12Z" />
      <path d="M12 17C10.33 17 9.5 17.83 9.5 19.5V22H14.5V19.5C14.5 17.83 13.67 17 12 17Z" />
    </svg>
  );
}

/** Iconsax `sun` */
export function SunIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 18.5C15.5899 18.5 18.5 15.5899 18.5 12C18.5 8.41015 15.5899 5.5 12 5.5C8.41015 5.5 5.5 8.41015 5.5 12C5.5 15.5899 8.41015 18.5 12 18.5Z" />
      <path d="M19.14 19.14L19.01 19.01M19.01 4.99L19.14 4.86L19.01 4.99ZM4.86 19.14L4.99 19.01L4.86 19.14ZM12 2.08V2V2.08ZM12 22V21.92V22ZM2.08 12H2H2.08ZM22 12H21.92H22ZM4.99 4.99L4.86 4.86L4.99 4.99Z" />
    </svg>
  );
}

/** Iconsax `medal` */
export function SwordIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 15C15.7279 15 18.75 12.0899 18.75 8.5C18.75 4.91015 15.7279 2 12 2C8.27208 2 5.25 4.91015 5.25 8.5C5.25 12.0899 8.27208 15 12 15Z" />
      <path d="M7.51999 13.5198L7.51001 20.8998C7.51001 21.7998 8.14001 22.2398 8.92001 21.8698L11.6 20.5999C11.82 20.4899 12.19 20.4899 12.41 20.5999L15.1 21.8698C15.87 22.2298 16.51 21.7998 16.51 20.8998V13.3398" />
    </svg>
  );
}

/** Iconsax `tag` */
export function TagIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4.16989 15.2998L8.69989 19.8298C10.5599 21.6898 13.5799 21.6898 15.4499 19.8298L19.8399 15.4398C21.6999 13.5798 21.6999 10.5598 19.8399 8.6898L15.2999 4.1698C14.3499 3.2198 13.0399 2.7098 11.6999 2.7798L6.69989 3.0198C4.69989 3.1098 3.10989 4.6998 3.00989 6.6898L2.76989 11.6898C2.70989 13.0398 3.21989 14.3498 4.16989 15.2998Z" />
      <path d="M9.49988 12C10.8806 12 11.9999 10.8807 11.9999 9.5C11.9999 8.11929 10.8806 7 9.49988 7C8.11917 7 6.99988 8.11929 6.99988 9.5C6.99988 10.8807 8.11917 12 9.49988 12Z" />
    </svg>
  );
}

/** Iconsax `gps` */
export function TargetIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 19.5C16.1421 19.5 19.5 16.1421 19.5 12C19.5 7.85786 16.1421 4.5 12 4.5C7.85786 4.5 4.5 7.85786 4.5 12C4.5 16.1421 7.85786 19.5 12 19.5Z" />
      <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" />
      <path d="M12 4V2" />
      <path d="M4 12H2" />
      <path d="M12 20V22" />
      <path d="M20 12H22" />
    </svg>
  );
}

/** Iconsax `dislike` */
export function ThumbsDownIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16.52 5.65039L13.42 3.25039C13.02 2.85039 12.12 2.65039 11.52 2.65039H7.71998C6.51998 2.65039 5.21998 3.55039 4.91998 4.75039L2.51998 12.0504C2.01998 13.4504 2.91998 14.6504 4.41998 14.6504H8.41998C9.01998 14.6504 9.51998 15.1504 9.41998 15.8504L8.91998 19.0504C8.71998 19.9504 9.31998 20.9504 10.22 21.2504C11.02 21.5504 12.02 21.1504 12.42 20.5504L16.52 14.4504" />
      <path d="M21.62 5.65V15.45C21.62 16.85 21.02 17.35 19.62 17.35H18.62C17.22 17.35 16.62 16.85 16.62 15.45V5.65C16.62 4.25 17.22 3.75 18.62 3.75H19.62C21.02 3.75 21.62 4.25 21.62 5.65Z" />
    </svg>
  );
}

/** Iconsax `like` */
export function ThumbsUpIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M18 18.8597H17.24C16.44 18.8597 15.68 19.1697 15.12 19.7297L13.41 21.4197C12.63 22.1897 11.36 22.1897 10.58 21.4197L8.87 19.7297C8.31 19.1697 7.54 18.8597 6.75 18.8597H6C4.34 18.8597 3 17.5298 3 15.8898V4.97974C3 3.33974 4.34 2.00977 6 2.00977H18C19.66 2.00977 21 3.33974 21 4.97974V15.8898C21 17.5198 19.66 18.8597 18 18.8597Z" />
      <path d="M12.28 14.96C12.13 15.01 11.88 15.01 11.72 14.96C10.42 14.51 7.5 12.66 7.5 9.51001C7.5 8.12001 8.62 7 10 7C10.82 7 11.54 7.39 12 8C12.46 7.39 13.18 7 14 7C15.38 7 16.5 8.12001 16.5 9.51001C16.49 12.66 13.58 14.51 12.28 14.96Z" />
    </svg>
  );
}

/** Iconsax `translate` */
export function TranslateIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M19.06 18.6703L16.92 14.4004L14.78 18.6703" />
      <path d="M15.17 17.9102H18.69" />
      <path d="M16.92 21.9998C14.12 21.9998 11.84 19.7298 11.84 16.9198C11.84 14.1198 14.11 11.8398 16.92 11.8398C19.72 11.8398 22 14.1098 22 16.9198C22 19.7298 19.73 21.9998 16.92 21.9998Z" />
      <path d="M5.02 2H8.94C11.01 2 12.01 3.00002 11.96 5.02002V8.94C12.01 11.01 11.01 12.01 8.94 11.96H5.02C3 12 2 11 2 8.92999V5.01001C2 3.00001 3 2 5.02 2Z" />
      <path d="M9.00995 5.84961H4.94995" />
      <path d="M6.96997 5.16992V5.84991" />
      <path d="M7.98994 5.83984C7.98994 7.58984 6.61994 9.00983 4.93994 9.00983" />
      <path d="M9.0099 9.01001C8.2799 9.01001 7.61991 8.62 7.15991 8" />
      <path d="M2 15C2 18.87 5.13 22 9 22L7.95 20.25" />
      <path d="M22 9C22 5.13 18.87 2 15 2L16.05 3.75" />
    </svg>
  );
}

/** Iconsax `trash` */
export function TrashIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M21 5.98047C17.67 5.65047 14.32 5.48047 10.98 5.48047C9 5.48047 7.02 5.58047 5.04 5.78047L3 5.98047" />
      <path d="M8.5 4.97L8.72 3.66C8.88 2.71 9 2 10.69 2H13.31C15 2 15.13 2.75 15.28 3.67L15.5 4.97" />
      <path d="M18.85 9.14062L18.2 19.2106C18.09 20.7806 18 22.0006 15.21 22.0006H8.79002C6.00002 22.0006 5.91002 20.7806 5.80002 19.2106L5.15002 9.14062" />
      <path d="M10.33 16.5H13.66" />
      <path d="M9.5 12.5H14.5" />
    </svg>
  );
}

/** Iconsax `direct-inbox` */
export function TrayIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 2V9L14 7" />
      <path d="M12 9L10 7" />
      <path d="M1.97998 13H6.38998C6.76998 13 7.10998 13.21 7.27998 13.55L8.44998 15.89C8.78998 16.57 9.47998 17 10.24 17H13.77C14.53 17 15.22 16.57 15.56 15.89L16.73 13.55C16.9 13.21 17.25 13 17.62 13H21.98" />
      <path d="M7 4.13086C3.46 4.65086 2 6.73086 2 11.0009V15.0009C2 20.0009 4 22.0009 9 22.0009H15C20 22.0009 22 20.0009 22 15.0009V11.0009C22 6.73086 20.54 4.65086 17 4.13086" />
    </svg>
  );
}

/** Iconsax `hierarchy` */
export function TreeStructureIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 9V16" />
      <path d="M5.25 8.5C7.04493 8.5 8.5 7.04493 8.5 5.25C8.5 3.45507 7.04493 2 5.25 2C3.45507 2 2 3.45507 2 5.25C2 7.04493 3.45507 8.5 5.25 8.5Z" />
      <path d="M5 22C6.65685 22 8 20.6569 8 19C8 17.3431 6.65685 16 5 16C3.34315 16 2 17.3431 2 19C2 20.6569 3.34315 22 5 22Z" />
      <path d="M19 22C20.6569 22 22 20.6569 22 19C22 17.3431 20.6569 16 19 16C17.3431 16 16 17.3431 16 19C16 20.6569 17.3431 22 19 22Z" />
      <path d="M5.13 9C5.58 10.75 7.18 12.05 9.07 12.04L12.5 12.03C15.12 12.02 17.35 13.7 18.17 16.04" />
    </svg>
  );
}

/** Iconsax `trend-up` */
export function TrendUpIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16.5 9.5L12.3 13.7L10.7 11.3L7.5 14.5" />
      <path d="M14.5 9.5H16.5V11.5" />
      <path d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z" />
    </svg>
  );
}

/** Iconsax `export-arrow-01` */
export function UploadSimpleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16.44 8.90039C20.04 9.21039 21.51 11.0604 21.51 15.1104V15.2404C21.51 19.7104 19.72 21.5004 15.25 21.5004H8.73998C4.26998 21.5004 2.47998 19.7104 2.47998 15.2404V15.1104C2.47998 11.0904 3.92998 9.24039 7.46998 8.91039" />
      <path d="M12 15.0001V3.62012" />
      <path d="M15.3499 5.85L11.9999 2.5L8.6499 5.85" />
    </svg>
  );
}

/** Iconsax `user` */
export function UserIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z" />
      <path d="M20.5901 22C20.5901 18.13 16.7402 15 12.0002 15C7.26015 15 3.41016 18.13 3.41016 22" />
    </svg>
  );
}

/** Iconsax `profile-2user` */
export function UsersIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9.16006 10.87C9.06006 10.86 8.94006 10.86 8.83006 10.87C6.45006 10.79 4.56006 8.84 4.56006 6.44C4.56006 3.99 6.54006 2 9.00006 2C11.4501 2 13.4401 3.99 13.4401 6.44C13.4301 8.84 11.5401 10.79 9.16006 10.87Z" />
      <path d="M16.4098 4C18.3498 4 19.9098 5.57 19.9098 7.5C19.9098 9.39 18.4098 10.93 16.5398 11C16.4598 10.99 16.3698 10.99 16.2798 11" />
      <path d="M4.16021 14.56C1.74021 16.18 1.74021 18.82 4.16021 20.43C6.91021 22.27 11.4202 22.27 14.1702 20.43C16.5902 18.81 16.5902 16.17 14.1702 14.56C11.4302 12.73 6.92021 12.73 4.16021 14.56Z" />
      <path d="M18.3398 20C19.0598 19.85 19.7398 19.56 20.2998 19.13C21.8598 17.96 21.8598 16.03 20.2998 14.86C19.7498 14.44 19.0798 14.16 18.3698 14" />
    </svg>
  );
}

/** Iconsax `warning-2` */
export function WarningCircleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 7.75V13" />
      <path d="M21.08 8.58003V15.42C21.08 16.54 20.4799 17.58 19.5099 18.15L13.5699 21.58C12.5999 22.14 11.3999 22.14 10.4199 21.58L4.47992 18.15C3.50992 17.59 2.90991 16.55 2.90991 15.42V8.58003C2.90991 7.46003 3.50992 6.41999 4.47992 5.84999L10.4199 2.42C11.3899 1.86 12.5899 1.86 13.5699 2.42L19.5099 5.84999C20.4799 6.41999 21.08 7.45003 21.08 8.58003Z" />
      <path d="M12 16.1992V16.2992" />
    </svg>
  );
}

/** Iconsax `danger` */
export function WarningIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 9V14" />
      <path d="M12.0001 21.4093H5.94005C2.47005 21.4093 1.02005 18.9293 2.70005 15.8993L5.82006 10.2793L8.76006 4.9993C10.5401 1.7893 13.4601 1.7893 15.2401 4.9993L18.1801 10.2893L21.3001 15.9093C22.9801 18.9393 21.5201 21.4193 18.0601 21.4193H12.0001V21.4093Z" />
      <path d="M11.9945 17H12.0035" />
    </svg>
  );
}

/** Iconsax `link-square` */
export function WebhooksLogoIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8.17997 16.0204C7.41997 15.9504 6.66998 15.6004 6.08998 14.9904C4.76998 13.6004 4.76998 11.3204 6.08998 9.93038L8.27998 7.63039C9.59998 6.24039 11.77 6.24039 13.1 7.63039C14.42 9.02039 14.42 11.3004 13.1 12.6904L12.01 13.8404" />
      <path d="M15.8199 7.98047C16.5799 8.05047 17.3299 8.40047 17.9099 9.01047C19.2299 10.4005 19.2299 12.6805 17.9099 14.0705L15.7199 16.3705C14.3999 17.7605 12.2299 17.7605 10.8999 16.3705C9.57991 14.9805 9.57991 12.7005 10.8999 11.3105L11.9899 10.1605" />
      <path d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z" />
    </svg>
  );
}

/** Iconsax `close-circle` */
export function XCircleIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z" />
      <path d="M9.17004 14.8299L14.83 9.16992" />
      <path d="M14.83 14.8299L9.17004 9.16992" />
    </svg>
  );
}

/** Iconsax `rotated-add` */
export function XIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <g transform="rotate(45 12 12)"><path d="M6 12H18" /><path d="M12 18V6" /></g>
    </svg>
  );
}
