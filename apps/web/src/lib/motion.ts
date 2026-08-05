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

// The one curve every fold on the site opens on — a detail panel inside a row, a
// band of rows behind a summary, a sub-list in the sidebar. Deliberately the same
// `--duration-standard` / `--ease-out` the CSS `grid-rows-[0fr]` folds use, so a
// disclosure reads identically whether its height is animated by the browser or
// by Motion.
//
// NOT the feed spring, which this used to be. A spring settles on velocity: the
// height covered most of its travel in ~100ms and then crept for another 400,
// and every row under the panel drifted along with it. That tail is what reads
// as a bounce on the whole row instead of a box changing size. A fold IS a size
// change, so it gets a tween.
export const disclosureTransition: Transition = {
  duration: 0.22,
  ease: [0.2, 0.7, 0.3, 1],
};

// Open/close for a detail panel revealed in place (a run's detail, a question's
// evidence). Pair with <AnimatePresence>. The wrapper that GROWS around it must
// not carry `layout: true` — projecting the old box onto the new one scales the
// row and its text while the panel opens, which is the distortion this
// choreography exists to avoid. Use layout="position" there.
export const disclosureMotion = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: disclosureTransition,
  style: { overflow: "hidden" },
} as const;
