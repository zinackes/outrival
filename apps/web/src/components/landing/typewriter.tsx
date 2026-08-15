"use client";

import { useEffect, useState } from "react";

// The hero's cycling verb. Screen readers get a stable "moved"; the animated
// copy is aria-hidden. Under prefers-reduced-motion the word stays "moved" and
// the caret is dropped entirely.
const WORDS = ["moved", "changed", "shipped", "hired", "pivoted", "launched"];
const TYPE = 72;
const ERASE = 42;
const HOLD = 2300;
const GAP = 350;

export function Typewriter() {
  const [text, setText] = useState(WORDS[0] ?? "moved");
  const [blink, setBlink] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduced(true);
      return;
    }
    let wi = 0;
    let current = WORDS[0] ?? "moved";
    let timer: ReturnType<typeof setTimeout>;
    function erase() {
      setBlink(false);
      if (current.length > 0) {
        current = current.slice(0, -1);
        setText(current);
        timer = setTimeout(erase, ERASE);
      } else {
        wi = (wi + 1) % WORDS.length;
        timer = setTimeout(type, GAP);
      }
    }
    function type() {
      const target = WORDS[wi] ?? "moved";
      if (current.length < target.length) {
        current = target.slice(0, current.length + 1);
        setText(current);
        timer = setTimeout(type, TYPE);
      } else {
        setBlink(true);
        timer = setTimeout(erase, HOLD);
      }
    }
    timer = setTimeout(erase, HOLD);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <span className="sr-only">moved</span>
      <span className="lp-cycle" aria-hidden>
        <span>{text}</span>
        {!reduced && <span className={blink ? "lp-caret blink" : "lp-caret"} />}
      </span>
    </>
  );
}
