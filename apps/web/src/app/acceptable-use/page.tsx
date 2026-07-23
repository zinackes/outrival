import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { LegalDoc } from "@/components/legal/legal-doc";
import { CONTACT } from "@/lib/legal/entity";

export const metadata: Metadata = pageMetadata({
  path: "/acceptable-use",
  title: "Acceptable Use Policy",
  description:
    "What you may and may not do with Outrival.",
});

export default function AcceptableUsePage() {
  return (
    <LegalDoc
      title={{ en: "Acceptable Use Policy", fr: "Charte d'usage acceptable" }}
      intro={{
        en: "This policy sets out what is not allowed when using Outrival. It is part of our Terms of Service. Because Outrival monitors third-party sources, responsible use matters.",
        fr: "Cette charte définit ce qui n'est pas autorisé lors de l'utilisation d'Outrival. Elle fait partie de nos CGU. Comme Outrival surveille des sources tierces, un usage responsable est essentiel.",
      }}
      en={
        <>
          <h2>1. Prohibited uses</h2>
          <p>You must not use Outrival to:</p>
          <ul>
            <li>break the law or facilitate illegal activity;</li>
            <li>infringe intellectual-property, privacy or other third-party rights;</li>
            <li>direct us to bypass logins, paywalls, or technical access controls of a monitored source, or to monitor sources you have no right to observe;</li>
            <li>collect or process special-category personal data, or build profiles of, harass, or discriminate against individuals;</li>
            <li>place an unreasonable load on third-party sites or interfere with their operation;</li>
            <li>resell, redistribute, or expose the raw captured data in violation of a source’s rights or applicable law;</li>
            <li>reverse-engineer, scrape, or misuse the Outrival service itself, or attempt to breach its security;</li>
            <li>upload malware, send spam, or impersonate others;</li>
            <li>rely solely on AI-generated outputs to make decisions producing legal or similarly significant effects on individuals.</li>
          </ul>

          <h2>2. Responsible monitoring</h2>
          <p>
            Outrival collects only publicly accessible content and respects{" "}
            <code>robots.txt</code> and reasonable rate limits at the platform
            level. You must not ask us to circumvent these protections, and you are
            responsible for ensuring your monitoring is lawful in your context.
          </p>

          <h2>3. Enforcement</h2>
          <p>
            We may investigate suspected violations and suspend or terminate access
            where necessary, as described in our{" "}
            <a href="/terms">Terms of Service</a>.
          </p>

          <h2>4. Reporting abuse</h2>
          <p>
            Report suspected abuse or security issues to{" "}
            <a href={`mailto:${CONTACT.security}`}>{CONTACT.security}</a>.
          </p>
        </>
      }
      fr={
        <>
          <h2>1. Usages interdits</h2>
          <p>Vous ne devez pas utiliser Outrival pour :</p>
          <ul>
            <li>enfreindre la loi ou faciliter une activité illégale ;</li>
            <li>violer des droits de propriété intellectuelle, de vie privée ou d'autres droits de tiers ;</li>
            <li>nous demander de contourner des identifications, paywalls ou contrôles techniques d'accès d'une source surveillée, ou surveiller des sources que vous n'avez pas le droit d'observer ;</li>
            <li>collecter ou traiter des données sensibles, ou profiler, harceler ou discriminer des individus ;</li>
            <li>imposer une charge déraisonnable aux sites tiers ou perturber leur fonctionnement ;</li>
            <li>revendre, redistribuer ou exposer les données brutes capturées en violation des droits d'une source ou de la loi applicable ;</li>
            <li>faire de l'ingénierie inverse, scraper ou détourner le service Outrival lui-même, ou tenter d'en violer la sécurité ;</li>
            <li>déposer des logiciels malveillants, envoyer du spam ou usurper une identité ;</li>
            <li>vous fonder uniquement sur des résultats générés par IA pour prendre des décisions produisant des effets juridiques ou significatifs sur des individus.</li>
          </ul>

          <h2>2. Surveillance responsable</h2>
          <p>
            Outrival ne collecte que du contenu publiquement accessible et respecte{" "}
            <code>robots.txt</code> et des limites de débit raisonnables au niveau
            de la plateforme. Vous ne devez pas nous demander de contourner ces
            protections et êtes responsable de la licéité de votre surveillance dans
            votre contexte.
          </p>

          <h2>3. Application</h2>
          <p>
            Nous pouvons enquêter sur des violations présumées et suspendre ou
            résilier l'accès si nécessaire, comme décrit dans nos{" "}
            <a href="/terms">CGU</a>.
          </p>

          <h2>4. Signaler un abus</h2>
          <p>
            Signalez tout abus ou problème de sécurité présumé à{" "}
            <a href={`mailto:${CONTACT.security}`}>{CONTACT.security}</a>.
          </p>
        </>
      }
    />
  );
}
