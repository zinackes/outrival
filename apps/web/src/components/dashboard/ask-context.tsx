"use client";

import * as React from "react";

// The entity the current page is "about", so the Ask dock can scope questions to
// it (Linear's inline-agent pattern). Pages declare it with useSetAskContext;
// the dock reads it with useAskContext. Kept tiny on purpose — one entity at a time.
export interface AskEntity {
  kind: "competitor" | "signal";
  id: string;
  name: string;
}

const AskContext = React.createContext<{
  entity: AskEntity | null;
  setEntity: (e: AskEntity | null) => void;
}>({ entity: null, setEntity: () => {} });

export function AskContextProvider({ children }: { children: React.ReactNode }) {
  const [entity, setEntity] = React.useState<AskEntity | null>(null);
  return (
    <AskContext.Provider value={{ entity, setEntity }}>
      {children}
    </AskContext.Provider>
  );
}

export function useAskContext(): AskEntity | null {
  return React.useContext(AskContext).entity;
}

/** Declare the current page's entity; cleared automatically on unmount. */
export function useSetAskContext(entity: AskEntity | null) {
  const { setEntity } = React.useContext(AskContext);
  // Depend on the primitive fields (not the object, which the caller recreates
  // each render → would loop) so the effect only fires when the entity changes.
  const kind = entity?.kind ?? null;
  const id = entity?.id ?? null;
  const name = entity?.name ?? null;
  React.useEffect(() => {
    setEntity(kind && id && name ? { kind, id, name } : null);
    return () => setEntity(null);
  }, [kind, id, name, setEntity]);
}
