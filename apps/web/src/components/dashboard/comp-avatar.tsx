export function CompAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const letter = name ? name[0]!.toUpperCase() : "?";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-display)",
        fontWeight: 600,
        fontSize: Math.round(size * 0.46),
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
}
