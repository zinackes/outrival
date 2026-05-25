import { DigestsList } from "@/components/outrival/digests-list";

export default function DigestsPage() {
  return (
    <div>
      <h1
        style={{ fontFamily: "var(--font-syne)" }}
        className="text-2xl font-bold mb-6"
      >
        Digests hebdomadaires
      </h1>
      <DigestsList />
    </div>
  );
}
