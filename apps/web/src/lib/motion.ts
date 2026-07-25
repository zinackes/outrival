import type { Transition, Variants } from "motion/react";

// Shared enter/exit + reorder choreography for filtered feeds
// (signals, competitors, discovery). Pair with <AnimatePresence> for
// enter/exit and the `layout` prop for FLIP reordering. Users who ask for
// less motion get opacity-only via <MotionConfig reducedMotion="user"> in
// DashboardShell.
export const feedItemVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97 },
};

// Springy but quick — snappy enough that fast filter toggling never feels laggy.
export const feedItemTransition: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.7,
};

// Props bundle for an animated feed item. Spread onto a <motion.*> element.
// A row that can grow in place (a detail panel opens inside it) should override
// with layout="position": its own height is already animated by the panel, and
// projecting the box on top of that distorts the row while it opens.
export const feedItemMotion = {
  layout: true,
  variants: feedItemVariants,
  initial: "initial",
  animate: "animate",
  exit: "exit",
  transition: feedItemTransition,
} as const;

// Open/close for a detail panel revealed in place (a run's detail, a question's
// evidence). Same spring as the feed, so a list and the panels inside it move
// with one hand. The spring is overdamped, so the height settles without the
// overshoot that would clip the panel's last line.
export const disclosureMotion = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: feedItemTransition,
  style: { overflow: "hidden" },
} as const;
