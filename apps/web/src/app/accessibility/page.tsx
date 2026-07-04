import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/legal-doc";
import { CONTACT, LEGAL_VERSION } from "@/lib/legal/entity";

export const metadata: Metadata = {
  title: "Accessibility Statement",
  description:
    "Outrival's commitment to digital accessibility under the European Accessibility Act.",
  alternates: { canonical: "/accessibility" },
};

export default function AccessibilityPage() {
  return (
    <LegalDoc
      title={{ en: "Accessibility Statement", fr: "Déclaration d'accessibilité" }}
      intro={{
        en: "We want Outrival to be usable by everyone. This statement describes our accessibility commitment, the standard we target, current status, and how to give feedback.",
        fr: "Nous voulons qu'Outrival soit utilisable par tous. Cette déclaration décrit notre engagement d'accessibilité, le standard visé, l'état actuel et la manière de nous faire un retour.",
      }}
      en={
        <>
          <h2>1. Our commitment</h2>
          <p>
            We are committed to making Outrival accessible to people with
            disabilities, in the spirit of the European Accessibility Act (EAA) and
            the French accessibility framework (RGAA).
          </p>

          <h2>2. Target standard</h2>
          <p>
            We aim to conform to <strong>WCAG 2.1 level AA</strong> and the
            harmonised European standard EN 301 549, following the four principles:
            content that is perceivable, operable, understandable and robust.
          </p>

          <h2>3. Current status</h2>
          <p>
            Outrival is in <strong>partial conformity</strong>. We build with
            semantic HTML, keyboard support, theme-aware contrast and focus states,
            and continuously improve. We have not yet completed a full independent
            audit, so some components may not fully meet every criterion.
          </p>

          <h2>4. Known limitations</h2>
          <p>
            Some data-dense views (charts, comparison tables) and third-party
            embedded content may present accessibility gaps. We are working to
            improve them; if a barrier stops you from completing a task, tell us and
            we will help and prioritise a fix.
          </p>

          <h2>5. Feedback &amp; contact</h2>
          <p>
            If you encounter an accessibility barrier, contact{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>. Describe the
            page and the problem; we aim to respond promptly and to offer an
            accessible alternative where needed.
          </p>

          <h2>6. About this statement</h2>
          <p>
            Prepared on {LEGAL_VERSION.updatedEn} based on self-assessment. As a
            micro-enterprise we are not subject to the full RGAA multi-year scheme,
            but we publish this statement voluntarily and review it periodically.
          </p>
        </>
      }
      fr={
        <>
          <h2>1. Notre engagement</h2>
          <p>
            Nous nous engageons à rendre Outrival accessible aux personnes en
            situation de handicap, dans l'esprit de l'European Accessibility Act
            (EAA) et du référentiel français (RGAA).
          </p>

          <h2>2. Standard visé</h2>
          <p>
            Nous visons la conformité au niveau{" "}
            <strong>WCAG 2.1 AA</strong> et à la norme européenne harmonisée EN 301
            549, selon les quatre principes : contenu perceptible, utilisable,
            compréhensible et robuste.
          </p>

          <h2>3. État actuel</h2>
          <p>
            Outrival est en <strong>conformité partielle</strong>. Nous développons
            avec du HTML sémantique, un support clavier, des contrastes adaptés au
            thème et des états de focus, et améliorons en continu. Nous n'avons pas
            encore réalisé d'audit indépendant complet ; certains composants peuvent
            donc ne pas satisfaire tous les critères.
          </p>

          <h2>4. Limitations connues</h2>
          <p>
            Certaines vues denses (graphiques, tableaux de comparaison) et contenus
            tiers embarqués peuvent présenter des lacunes d'accessibilité. Nous
            travaillons à les corriger ; si un obstacle vous empêche d'accomplir une
            tâche, dites-le-nous et nous vous aiderons et prioriserons un correctif.
          </p>

          <h2>5. Retour &amp; contact</h2>
          <p>
            Si vous rencontrez un obstacle d'accessibilité, écrivez à{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>. Décrivez la
            page et le problème ; nous visons une réponse rapide et une alternative
            accessible si nécessaire.
          </p>

          <h2>6. À propos de cette déclaration</h2>
          <p>
            Établie le {LEGAL_VERSION.updatedFr} sur la base d'une auto-évaluation.
            En tant que micro-entreprise, nous ne sommes pas soumis au schéma
            pluriannuel RGAA complet, mais nous publions cette déclaration
            volontairement et la révisons périodiquement.
          </p>
        </>
      }
    />
  );
}
