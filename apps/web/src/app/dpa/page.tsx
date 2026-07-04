import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/legal-doc";
import { ENTITY, CONTACT } from "@/lib/legal/entity";

export const metadata: Metadata = {
  title: "Data Processing Agreement",
  description:
    "Outrival's GDPR Article 28 Data Processing Agreement for business customers.",
  alternates: { canonical: "/dpa" },
};

export default function DpaPage() {
  return (
    <LegalDoc
      title={{ en: "Data Processing Agreement", fr: "Accord de traitement des données" }}
      intro={{
        en: "This Data Processing Agreement (DPA) governs Outrival's processing of personal data on your behalf under Article 28 GDPR. It forms part of the agreement when you use Outrival to process personal data; a signed copy is available on request.",
        fr: "Cet Accord de traitement des données (DPA) régit le traitement de données personnelles par Outrival pour votre compte au titre de l'article 28 du RGPD. Il fait partie du contrat lorsque vous utilisez Outrival pour traiter des données personnelles ; une copie signée est disponible sur demande.",
      }}
      en={
        <>
          <h2>1. Roles</h2>
          <p>
            You (the customer) are the <strong>controller</strong>;{" "}
            {ENTITY.legalName} (“Outrival”) is the <strong>processor</strong>,
            acting only on your documented instructions. Where Outrival determines
            purposes and means for its own operations (e.g. billing, security), it
            acts as controller under our{" "}
            <a href="/privacy">Privacy Policy</a>.
          </p>

          <h2>2. Details of the processing</h2>
          <ul>
            <li><strong>Subject matter:</strong> provision of the Outrival service.</li>
            <li><strong>Duration:</strong> the term of your subscription (plus deletion period).</li>
            <li><strong>Nature &amp; purpose:</strong> hosting, monitoring, change detection, AI-assisted analysis, notifications.</li>
            <li><strong>Types of personal data:</strong> account &amp; contact identifiers, usage data, and any personal data incidentally present in monitored public sources you configure.</li>
            <li><strong>Categories of data subjects:</strong> your users and, incidentally, individuals mentioned in public sources you monitor.</li>
          </ul>

          <h2>3. Our obligations as processor (Art. 28.3)</h2>
          <ul>
            <li>(a) process personal data only on your documented instructions, including for transfers, unless required by law (in which case we inform you unless prohibited);</li>
            <li>(b) ensure persons authorised to process are bound by confidentiality;</li>
            <li>(c) implement the security measures required by Article 32 (see §5);</li>
            <li>(d) engage subprocessors only under §4 and impose equivalent data-protection obligations on them;</li>
            <li>(e) assist you, by appropriate measures, to respond to data-subject rights requests;</li>
            <li>(f) assist you with security, breach notification (Art. 33–34), data protection impact assessments (Art. 35) and prior consultation (Art. 36);</li>
            <li>(g) at the end of the service, delete or return all personal data, and delete existing copies unless retention is required by law;</li>
            <li>(h) make available the information needed to demonstrate compliance and allow for and contribute to audits, and immediately inform you if an instruction appears to infringe data-protection law.</li>
          </ul>

          <h2>4. Subprocessors</h2>
          <p>
            You grant <strong>general authorisation</strong> for us to engage the
            subprocessors listed on our{" "}
            <a href="/subprocessors">subprocessors page</a>. We impose data
            protection obligations on each subprocessor equivalent to those in this
            DPA and remain responsible for their performance. We will give{" "}
            <strong>advance notice</strong> of any addition or replacement, and you
            may object on reasonable data-protection grounds.
          </p>

          <h2>5. Security</h2>
          <p>
            We implement appropriate technical and organisational measures,
            including encryption in transit, access controls, strong
            authentication options, logging, EU-hosted core infrastructure and
            regular review, taking into account the state of the art and the risks
            of the processing.
          </p>

          <h2>6. Breach notification</h2>
          <p>
            We will notify you without undue delay after becoming aware of a
            personal data breach affecting your data, with the information you need
            to meet your own notification obligations.
          </p>

          <h2>7. International transfers</h2>
          <p>
            Where a subprocessor is outside the EEA, transfers are covered by the
            European Commission’s Standard Contractual Clauses and, where
            applicable, an adequacy decision, plus additional safeguards. See the{" "}
            <a href="/subprocessors">subprocessors page</a> for per-provider
            details.
          </p>

          <h2>8. Deletion &amp; return</h2>
          <p>
            You can export your data at any time from the app. On termination, we
            delete or return personal data in accordance with §3(g) and our
            retention schedule.
          </p>

          <h2>9. Liability &amp; precedence</h2>
          <p>
            This DPA is incorporated into the{" "}
            <a href="/terms">Terms of Service</a>. In case of conflict on data
            protection matters, this DPA prevails. Liability is subject to the
            limitations in the Terms of Service, to the extent permitted by law.
          </p>

          <h2>10. Signed copy</h2>
          <p>
            To receive a countersigned copy, email{" "}
            <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a> with your
            company details.
          </p>
        </>
      }
      fr={
        <>
          <h2>1. Rôles</h2>
          <p>
            Vous (le client) êtes le <strong>responsable de traitement</strong> ;{" "}
            {ENTITY.legalName} (« Outrival ») est le{" "}
            <strong>sous-traitant</strong>, agissant uniquement sur vos
            instructions documentées. Lorsqu'Outrival détermine les finalités et
            moyens de ses propres opérations (ex. facturation, sécurité), il agit en
            responsable au titre de notre{" "}
            <a href="/privacy">Politique de confidentialité</a>.
          </p>

          <h2>2. Détails du traitement</h2>
          <ul>
            <li><strong>Objet :</strong> fourniture du service Outrival.</li>
            <li><strong>Durée :</strong> la durée de votre abonnement (plus la période de suppression).</li>
            <li><strong>Nature &amp; finalité :</strong> hébergement, surveillance, détection de changements, analyse assistée par IA, notifications.</li>
            <li><strong>Types de données :</strong> identifiants de compte &amp; de contact, données d'usage, et toute donnée personnelle présente incidemment dans les sources publiques surveillées que vous configurez.</li>
            <li><strong>Catégories de personnes :</strong> vos utilisateurs et, incidemment, les personnes mentionnées dans les sources publiques surveillées.</li>
          </ul>

          <h2>3. Nos obligations de sous-traitant (art. 28.3)</h2>
          <ul>
            <li>(a) ne traiter les données que sur vos instructions documentées, y compris pour les transferts, sauf obligation légale (auquel cas nous vous en informons sauf interdiction) ;</li>
            <li>(b) veiller à ce que les personnes autorisées à traiter soient soumises à la confidentialité ;</li>
            <li>(c) mettre en œuvre les mesures de sécurité requises par l'article 32 (voir §5) ;</li>
            <li>(d) ne recourir à des sous-traitants ultérieurs que selon le §4 et leur imposer des obligations équivalentes ;</li>
            <li>(e) vous aider, par des mesures appropriées, à répondre aux demandes d'exercice des droits ;</li>
            <li>(f) vous aider en matière de sécurité, de notification de violation (art. 33–34), d'analyses d'impact (art. 35) et de consultation préalable (art. 36) ;</li>
            <li>(g) à la fin du service, supprimer ou restituer toutes les données et détruire les copies existantes, sauf conservation exigée par la loi ;</li>
            <li>(h) mettre à disposition les informations nécessaires pour démontrer la conformité, permettre et contribuer aux audits, et vous informer immédiatement si une instruction semble enfreindre le droit de la protection des données.</li>
          </ul>

          <h2>4. Sous-traitants ultérieurs</h2>
          <p>
            Vous accordez une <strong>autorisation générale</strong> pour recourir
            aux sous-traitants listés sur notre{" "}
            <a href="/subprocessors">page sous-traitants</a>. Nous imposons à chacun
            des obligations équivalentes à celles du présent DPA et restons
            responsables de leur exécution. Nous vous donnerons un{" "}
            <strong>préavis</strong> de tout ajout ou remplacement, et vous pourrez
            vous y opposer pour des motifs raisonnables tenant à la protection des
            données.
          </p>

          <h2>5. Sécurité</h2>
          <p>
            Nous mettons en œuvre des mesures techniques et organisationnelles
            appropriées : chiffrement en transit, contrôles d'accès, options
            d'authentification forte, journalisation, infrastructure principale
            hébergée dans l'UE et revue régulière, en tenant compte de l'état de
            l'art et des risques du traitement.
          </p>

          <h2>6. Notification de violation</h2>
          <p>
            Nous vous notifierons sans retard injustifié après avoir eu
            connaissance d'une violation affectant vos données, avec les
            informations nécessaires au respect de vos propres obligations.
          </p>

          <h2>7. Transferts internationaux</h2>
          <p>
            Lorsqu'un sous-traitant est hors EEE, les transferts sont couverts par
            les Clauses Contractuelles Types de la Commission européenne et, le cas
            échéant, une décision d'adéquation, assorties de garanties
            complémentaires. Voir la{" "}
            <a href="/subprocessors">page sous-traitants</a> pour le détail par
            prestataire.
          </p>

          <h2>8. Suppression &amp; restitution</h2>
          <p>
            Vous pouvez exporter vos données à tout moment depuis l'application. À
            la résiliation, nous supprimons ou restituons les données conformément
            au §3(g) et à notre calendrier de conservation.
          </p>

          <h2>9. Responsabilité &amp; hiérarchie</h2>
          <p>
            Le présent DPA est incorporé aux{" "}
            <a href="/terms">CGU</a>. En cas de conflit sur des questions de
            protection des données, le présent DPA prévaut. La responsabilité est
            soumise aux limitations des CGU, dans la mesure permise par la loi.
          </p>

          <h2>10. Copie signée</h2>
          <p>
            Pour recevoir une copie contresignée, écrivez à{" "}
            <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a> avec les
            informations de votre société.
          </p>
        </>
      }
    />
  );
}
