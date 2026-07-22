import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import Link from "next/link";
import { LegalDoc } from "@/components/legal/legal-doc";

export const metadata: Metadata = pageMetadata({
  path: "/legal",
  title: "Legal Center",
  description:
    "All of Outrival's legal, privacy and compliance documents.",
});

const DOCS: {
  href: string;
  title: { en: string; fr: string };
  desc: { en: string; fr: string };
}[] = [
  {
    href: "/legal-notice",
    title: { en: "Legal Notice", fr: "Mentions légales" },
    desc: {
      en: "Publisher, host and contact information (LCEN).",
      fr: "Éditeur, hébergeur et contact (LCEN).",
    },
  },
  {
    href: "/privacy",
    title: { en: "Privacy Policy", fr: "Politique de confidentialité" },
    desc: {
      en: "What personal data we process, why, and your GDPR rights.",
      fr: "Quelles données nous traitons, pourquoi, et vos droits RGPD.",
    },
  },
  {
    href: "/cookies",
    title: { en: "Cookie Policy", fr: "Politique cookies" },
    desc: {
      en: "Cookies we use and how to control them.",
      fr: "Cookies utilisés et comment les contrôler.",
    },
  },
  {
    href: "/terms",
    title: { en: "Terms of Service", fr: "Conditions générales d'utilisation" },
    desc: {
      en: "The terms governing use of Outrival.",
      fr: "Les conditions d'utilisation d'Outrival.",
    },
  },
  {
    href: "/terms-of-sale",
    title: { en: "Terms of Sale", fr: "Conditions générales de vente" },
    desc: {
      en: "Prices, billing, withdrawal and cancellation for paid plans.",
      fr: "Prix, facturation, rétractation et résiliation des plans payants.",
    },
  },
  {
    href: "/dpa",
    title: { en: "Data Processing Agreement", fr: "Accord de traitement des données" },
    desc: {
      en: "GDPR Article 28 terms for business customers.",
      fr: "Termes de l'article 28 du RGPD pour les clients professionnels.",
    },
  },
  {
    href: "/subprocessors",
    title: { en: "Subprocessors", fr: "Sous-traitants" },
    desc: {
      en: "Third-party providers, with location and transfer safeguards.",
      fr: "Prestataires tiers, localisation et garanties de transfert.",
    },
  },
  {
    href: "/acceptable-use",
    title: { en: "Acceptable Use Policy", fr: "Charte d'usage acceptable" },
    desc: {
      en: "What you may and may not do with Outrival.",
      fr: "Ce que vous pouvez et ne pouvez pas faire avec Outrival.",
    },
  },
  {
    href: "/accessibility",
    title: { en: "Accessibility Statement", fr: "Déclaration d'accessibilité" },
    desc: {
      en: "Our accessibility commitment and how to give feedback.",
      fr: "Notre engagement d'accessibilité et comment nous faire un retour.",
    },
  },
];

function List({ lang }: { lang: "en" | "fr" }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {DOCS.map((d) => (
        <Link
          key={d.href}
          href={d.href}
          style={{ textDecoration: "none" }}
          className="rounded-md border border-border bg-background-2 p-4 transition-colors hover:border-border-strong"
        >
          <div className="font-medium text-foreground">{d.title[lang]}</div>
          <div className="mt-1 text-xs text-text-subtle">{d.desc[lang]}</div>
        </Link>
      ))}
    </div>
  );
}

export default function LegalCenterPage() {
  return (
    <LegalDoc
      title={{ en: "Legal Center", fr: "Centre légal" }}
      intro={{
        en: "All of Outrival's legal, privacy and compliance documents in one place.",
        fr: "Tous les documents légaux, de confidentialité et de conformité d'Outrival au même endroit.",
      }}
      en={<List lang="en" />}
      fr={<List lang="fr" />}
    />
  );
}
