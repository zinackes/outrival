"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronRight, Plus, X } from "lucide-react";
import {
  api,
  type DiscoveredCompetitor,
  type ProductProfile,
} from "@/lib/api";

type SourceType = "homepage" | "pricing" | "blog";
type Frequency = "daily" | "weekly";

interface Selection extends DiscoveredCompetitor {
  selected: boolean;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [productUrl, setProductUrl] = useState("");
  const [profile, setProfile] = useState<ProductProfile | null>(null);
  const [competitors, setCompetitors] = useState<Selection[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [sources, setSources] = useState<SourceType[]>(["homepage", "pricing", "blog"]);

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setLoadingLabel("Analyse de votre produit…");
    try {
      const res = await api.analyzeProduct(productUrl);
      setProfile(res.profile);
      setStep(2);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleProfileConfirm() {
    if (!profile) return;
    setError(null);
    setLoading(true);
    setLoadingLabel("Recherche de vos concurrents…");
    try {
      await api.patchProductProfile(profile);
      const res = await api.discoverCompetitors(productUrl, profile);
      setCompetitors(
        res.competitors.map((c) => ({ ...c, selected: c.overlapScore > 60 })),
      );
      setStep(3);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggleCompetitor(url: string) {
    setCompetitors((prev) =>
      prev.map((c) => (c.url === url ? { ...c, selected: !c.selected } : c)),
    );
  }

  function addManualCompetitor() {
    if (!manualUrl) return;
    try {
      const u = new URL(manualUrl);
      const title = u.hostname.replace(/^www\./, "");
      setCompetitors((prev) => [
        ...prev,
        {
          url: manualUrl,
          title,
          snippet: "Ajouté manuellement",
          overlapScore: 0,
          reason: "Manuel",
          selected: true,
        },
      ]);
      setManualUrl("");
    } catch {
      setError("URL invalide");
    }
  }

  function toggleSource(s: SourceType) {
    setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function handleComplete() {
    setError(null);
    setLoading(true);
    setLoadingLabel("Configuration de votre veille…");
    try {
      const selected = competitors
        .filter((c) => c.selected)
        .map((c) => {
          const u = new URL(c.url);
          return {
            name: c.title || u.hostname,
            url: c.url,
            overlapScore: c.overlapScore || undefined,
          };
        });
      if (selected.length === 0) {
        setError("Sélectionnez au moins un concurrent");
        setLoading(false);
        return;
      }
      if (sources.length === 0) {
        setError("Sélectionnez au moins une source");
        setLoading(false);
        return;
      }
      await api.completeOnboarding({
        selectedCompetitors: selected,
        monitoringPrefs: { frequency, sources },
      });
      router.push("/dashboard");
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  const selectedCount = competitors.filter((c) => c.selected).length;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
        className="w-full max-w-2xl p-10"
      >
        <Header step={step} />

        {loading && (
          <div className="flex items-center gap-3 my-12 justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--accent)" }} />
            <span style={{ color: "var(--muted)" }} className="text-sm">
              {loadingLabel}
            </span>
          </div>
        )}

        {!loading && step === 1 && (
          <form onSubmit={handleAnalyze} className="flex flex-col gap-4 mt-6">
            <Field label="URL de votre produit">
              <input
                type="url"
                required
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://votreproduit.com"
                style={inputStyle}
                className="px-3 py-2 text-sm outline-none focus:ring-1 ring-amber-500"
              />
            </Field>
            <PrimaryButton type="submit">
              Analyser <ChevronRight size={16} />
            </PrimaryButton>
          </form>
        )}

        {!loading && step === 2 && profile && (
          <div className="flex flex-col gap-4 mt-6">
            <p style={{ color: "var(--muted)" }} className="text-sm mb-2">
              Voici ce qu'on a compris de votre produit. Corrigez ce qui ne va pas.
            </p>
            {(["category", "audience", "valueProp", "pricingModel"] as const).map((k) => (
              <Field key={k} label={labelFor(k)}>
                <input
                  value={profile[k]}
                  onChange={(e) => setProfile({ ...profile, [k]: e.target.value })}
                  style={inputStyle}
                  className="px-3 py-2 text-sm outline-none focus:ring-1 ring-amber-500"
                />
              </Field>
            ))}
            <PrimaryButton onClick={handleProfileConfirm}>
              C'est ça <ChevronRight size={16} />
            </PrimaryButton>
          </div>
        )}

        {!loading && step === 3 && (
          <div className="flex flex-col gap-3 mt-6">
            <p style={{ color: "var(--muted)" }} className="text-sm mb-2">
              {competitors.length} concurrents trouvés. {selectedCount} sélectionnés.
            </p>
            <ul className="flex flex-col gap-2 max-h-[400px] overflow-auto pr-2">
              {competitors.map((c) => (
                <li
                  key={c.url}
                  style={{
                    background: c.selected ? "var(--background)" : "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                  }}
                  className="flex items-start gap-3 p-3 cursor-pointer hover:bg-white/5"
                  onClick={() => toggleCompetitor(c.url)}
                  title={c.reason}
                >
                  <input
                    type="checkbox"
                    checked={c.selected}
                    onChange={() => toggleCompetitor(c.url)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{c.title}</span>
                      <OverlapBadge score={c.overlapScore} />
                    </div>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: "var(--muted)" }}
                      className="text-xs hover:underline"
                    >
                      {c.url}
                    </a>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex gap-2 mt-2">
              <input
                type="url"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://autre-concurrent.com"
                style={inputStyle}
                className="flex-1 px-3 py-2 text-sm outline-none focus:ring-1 ring-amber-500"
              />
              <button
                type="button"
                onClick={addManualCompetitor}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  color: "var(--foreground)",
                }}
                className="px-3 text-sm flex items-center gap-1 hover:bg-white/5"
              >
                <Plus size={14} /> Ajouter
              </button>
            </div>

            <PrimaryButton onClick={() => setStep(4)}>
              Suivant <ChevronRight size={16} />
            </PrimaryButton>
          </div>
        )}

        {!loading && step === 4 && (
          <div className="flex flex-col gap-6 mt-6">
            <div>
              <p style={{ color: "var(--muted)" }} className="text-xs uppercase tracking-wider mb-3">
                Fréquence
              </p>
              <div className="flex gap-2">
                {(["daily", "weekly"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrequency(f)}
                    style={{
                      background: frequency === f ? "var(--accent)" : "transparent",
                      color: frequency === f ? "var(--accent-foreground)" : "var(--foreground)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                    }}
                    className="px-4 py-2 text-sm"
                  >
                    {f === "daily" ? "Quotidien" : "Hebdomadaire"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ color: "var(--muted)" }} className="text-xs uppercase tracking-wider mb-3">
                Sources à surveiller
              </p>
              <div className="flex flex-wrap gap-2">
                {(["homepage", "pricing", "blog"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSource(s)}
                    style={{
                      background: sources.includes(s) ? "var(--accent)" : "transparent",
                      color: sources.includes(s) ? "var(--accent-foreground)" : "var(--foreground)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                    }}
                    className="px-4 py-2 text-sm capitalize"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <PrimaryButton onClick={() => { setStep(5); void handleComplete(); }}>
              Lancer la veille <ChevronRight size={16} />
            </PrimaryButton>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-xs mt-4 flex items-center gap-2">
            <X size={12} /> {error}
          </p>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--background)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--foreground)",
};

function labelFor(k: "category" | "audience" | "valueProp" | "pricingModel"): string {
  return {
    category: "Catégorie",
    audience: "Audience",
    valueProp: "Proposition de valeur",
    pricingModel: "Modèle de pricing",
  }[k];
}

function Header({ step }: { step: number }) {
  const titles: Record<number, string> = {
    1: "Ton produit",
    2: "On a bien compris ?",
    3: "Tes concurrents",
    4: "Préférences de veille",
    5: "Tout est prêt",
  };
  return (
    <div className="mb-4">
      <p style={{ color: "var(--muted)" }} className="text-xs uppercase tracking-wider">
        Étape {step} / 5
      </p>
      <h1
        style={{ fontFamily: "var(--font-syne)" }}
        className="text-2xl font-bold mt-1"
      >
        {titles[step]}
      </h1>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label style={{ color: "var(--muted)" }} className="text-xs">
        {label}
      </label>
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        background: "var(--accent)",
        color: "var(--accent-foreground)",
        borderRadius: "var(--radius)",
      }}
      className="py-2.5 px-4 text-sm font-medium mt-2 disabled:opacity-50 flex items-center justify-center gap-2"
    >
      {children}
    </button>
  );
}

function OverlapBadge({ score }: { score: number }) {
  const color = score > 75 ? "#10B981" : score > 50 ? "#F59E0B" : "#6B7280";
  return (
    <span
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
        borderRadius: "var(--radius)",
      }}
      className="text-[10px] px-1.5 py-0.5 font-medium"
    >
      {Math.round(score)}%
    </span>
  );
}
