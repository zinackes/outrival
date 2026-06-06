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
export const feedItemMotion = {
  layout: true,
  variants: feedItemVariants,
  initial: "initial",
  animate: "animate",
  exit: "exit",
  transition: feedItemTransition,
} as const;
