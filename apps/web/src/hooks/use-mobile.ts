import * as React from "react"

// 1024, not 768: this is the width below which the sidebar goes off-canvas, and
// at exactly 768 — iPad portrait, the single most common tablet width — the old
// value left the sidebar rendered full-width with its labels, so the shell was
// 256px of chrome plus a topbar that no longer fit, and every authenticated route
// forced a 55px horizontal scrollbar (`ux:82`, 44 of 45 routes). The sidebar is
// the only consumer; "mobile" here means "no room for a permanent rail".
const MOBILE_BREAKPOINT = 1024

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
