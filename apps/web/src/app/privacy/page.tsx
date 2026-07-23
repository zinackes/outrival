import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { LegalDoc } from "@/components/legal/legal-doc";
import { ENTITY, CONTACT } from "@/lib/legal/entity";

export const metadata: Metadata = pageMetadata({
  path: "/privacy",
  title: "Privacy Policy",
  description:
    "How Outrival collects, uses, shares and protects personal data under the GDPR.",
});

export default function PrivacyPage() {
  return (
    <LegalDoc
      title={{ en: "Privacy Policy", fr: "Politique de confidentialité" }}
      intro={{
        en: "This policy explains what personal data Outrival processes, why, on what legal basis, who we share it with, how long we keep it, and the rights you can exercise. It is written to satisfy Articles 13 and 14 of the GDPR.",
        fr: "Cette politique explique quelles données personnelles Outrival traite, pourquoi, sur quelle base légale, avec qui nous les partageons, combien de temps nous les conservons et les droits que vous pouvez exercer. Elle est rédigée pour satisfaire aux articles 13 et 14 du RGPD.",
      }}
      en={
        <>
          <h2>1. Data controller</h2>
          <p>
            The controller for the processing described here is {ENTITY.legalName}{" "}
            ({ENTITY.legalForm}), {ENTITY.address}. For any privacy question or to
            exercise your rights, contact us at{" "}
            <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a> (or{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>).
          </p>
          <p className="fine">
            No Data Protection Officer is mandatory for our activity; the address
            above is our single point of contact for data protection.
          </p>

          <h2>2. Scope</h2>
          <p>
            This policy covers our website, the Outrival application, and related
            communications (transactional email, product analytics, the demo /
            contact form). It does not cover third-party websites we link to, nor
            the privacy practices of the competitor websites we monitor on your
            instruction.
          </p>

          <h2>3. What we process and why</h2>
          <p>
            We only process data we need. The table below summarizes each
            processing activity, the data involved, the legal basis under Article
            6 GDPR, and how long we keep it.
          </p>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Processing</th>
                  <th>Data</th>
                  <th>Legal basis</th>
                  <th>Retention</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Account & authentication</td>
                  <td>Name, email, sign-in method, sessions, 2FA/passkey metadata</td>
                  <td>Performance of the contract (6.1.b)</td>
                  <td>Life of the account, then deleted on erasure</td>
                </tr>
                <tr>
                  <td>Workspace & service delivery</td>
                  <td>Organisation, monitored competitors/sources you configure, generated signals & digests</td>
                  <td>Performance of the contract (6.1.b)</td>
                  <td>Life of the account; snapshots per your plan’s retention window</td>
                </tr>
                <tr>
                  <td>Billing & subscriptions</td>
                  <td>Billing identity, email, plan, payment metadata (card data handled by Stripe, never stored by us)</td>
                  <td>Contract (6.1.b) + legal obligation for invoices (6.1.c)</td>
                  <td>Invoices retained 10 years (accounting law)</td>
                </tr>
                <tr>
                  <td>Security & anti-abuse</td>
                  <td>IP address, request logs, captcha & rate-limit signals</td>
                  <td>Legitimate interest — securing the service (6.1.f)</td>
                  <td>Up to 12 months</td>
                </tr>
                <tr>
                  <td>Demo / contact form</td>
                  <td>Name, work email, company, team size, message</td>
                  <td>Pre-contractual steps at your request (6.1.b) / legitimate interest (6.1.f)</td>
                  <td>Up to 3 years from last contact</td>
                </tr>
                <tr>
                  <td>Product analytics</td>
                  <td>Pseudonymised usage events (PostHog, EU)</td>
                  <td>Consent (6.1.a)</td>
                  <td>Up to 12 months; withdrawn any time</td>
                </tr>
                <tr>
                  <td>Competitive monitoring</td>
                  <td>Public competitor pages; may incidentally include personal data (e.g. names in job posts or reviews)</td>
                  <td>Legitimate interest — competitive intelligence (6.1.f)</td>
                  <td>Per your plan’s retention window</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2>4. Competitive monitoring &amp; web data (important)</h2>
          <p>
            Outrival monitors <strong>publicly accessible</strong> competitor
            sources you configure (homepages, pricing, job boards, changelogs,
            public reviews). This is our core function and our legal basis is our
            and your <strong>legitimate interest</strong> in competitive
            intelligence (Article 6.1.f), assessed against the three-step
            balancing test and informed by EDPB Opinion 28/2024.
          </p>
          <p>To keep this proportionate, we:</p>
          <ul>
            <li>collect only publicly available content — we do not bypass logins or paywalls;</li>
            <li>respect <code>robots.txt</code> and reasonable rate limits;</li>
            <li>focus on companies and products, not individuals — we do not build profiles of natural persons;</li>
            <li>minimise incidental personal data and do not use it to contact or evaluate individuals;</li>
            <li>never scrape special-category data.</li>
          </ul>
          <p>
            If you are an individual whose public information appeared in a
            monitored source and you want it removed from a customer’s workspace,
            contact <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a>.
          </p>

          <h2>5. Artificial intelligence</h2>
          <p>
            We use AI models (via the providers listed on our{" "}
            <a href="/subprocessors">subprocessors page</a>) to classify changes
            and generate insights, summaries, digests and battle cards, and to
            power “Ask Outrival”. AI outputs are generated automatically and may
            contain errors; they are decision-support, not advice, and do not
            produce legal or similarly significant effects on any individual. We
            do not use your data to train third-party foundation models.
          </p>

          <h2>6. Cookies &amp; tracking</h2>
          <p>
            We use strictly necessary cookies and, with your consent, product
            analytics. Full details and your controls are in our{" "}
            <a href="/cookies">Cookie Policy</a>.
          </p>

          <h2>7. Who we share data with</h2>
          <p>
            We do not sell personal data. We share it only with processors acting
            on our instructions (hosting, database, email, payments, AI
            inference, analytics). The complete, current list — with purpose,
            location and transfer safeguards — is on our{" "}
            <a href="/subprocessors">subprocessors page</a>. We may also disclose
            data where required by law.
          </p>

          <h2>8. International transfers</h2>
          <p>
            Our core infrastructure is in the EU. Some processors are located
            outside the EEA (notably in the United States). For those transfers
            we rely on the European Commission’s Standard Contractual Clauses
            and, where applicable, adequacy decisions such as the EU–US Data
            Privacy Framework, together with additional safeguards. The transfer
            mechanism for each provider is shown on our{" "}
            <a href="/subprocessors">subprocessors page</a>.
          </p>

          <h2>9. Your rights</h2>
          <p>
            Under the GDPR you have the right to access, rectify, erase, restrict
            and object to processing, the right to data portability, and the
            right to withdraw consent at any time (without affecting prior
            processing). You can:
          </p>
          <ul>
            <li>
              <strong>export</strong> all your workspace data yourself from{" "}
              <a href="/dashboard/settings/data">Settings → Data</a>;
            </li>
            <li>
              <strong>permanently delete</strong> your account or workspace from{" "}
              <a href="/dashboard/settings/danger">Settings → Danger zone</a>;
            </li>
            <li>
              exercise any other right by emailing{" "}
              <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a> — we
              respond within one month.
            </li>
          </ul>

          <h2>10. Security</h2>
          <p>
            We apply appropriate technical and organisational measures (Article
            32): encryption in transit, access controls, strong authentication
            options (2FA, passkeys), logging, and EU-hosted infrastructure. No
            system is perfectly secure, but we work to protect your data and to
            notify you and the CNIL of any qualifying breach.
          </p>

          <h2>11. Children</h2>
          <p>
            Outrival is a business tool not directed to minors. We do not
            knowingly collect data from anyone under 16.
          </p>

          <h2>12. Changes</h2>
          <p>
            We may update this policy; the “last updated” date at the top
            reflects the current version and we will flag material changes.
          </p>

          <h2>13. Complaints</h2>
          <p>
            You can lodge a complaint with the CNIL: Commission Nationale de
            l’Informatique et des Libertés, 3 Place de Fontenoy, TSA 80715, 75334
            Paris Cedex 07 — <a href="https://www.cnil.fr">www.cnil.fr</a>.
          </p>
        </>
      }
      fr={
        <>
          <h2>1. Responsable de traitement</h2>
          <p>
            Le responsable des traitements décrits ici est {ENTITY.legalName}{" "}
            ({ENTITY.legalForm}), {ENTITY.address}. Pour toute question relative à
            la protection des données ou pour exercer vos droits, écrivez-nous à{" "}
            <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a> (ou{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>).
          </p>
          <p className="fine">
            La désignation d'un délégué à la protection des données n'est pas
            obligatoire pour notre activité ; l'adresse ci-dessus constitue notre
            point de contact unique en matière de données.
          </p>

          <h2>2. Champ d'application</h2>
          <p>
            Cette politique couvre notre site, l'application Outrival et les
            communications associées (emails transactionnels, analytics produit,
            formulaire de démo / contact). Elle ne couvre pas les sites tiers vers
            lesquels nous renvoyons, ni les pratiques des sites concurrents que
            nous surveillons sur votre instruction.
          </p>

          <h2>3. Ce que nous traitons et pourquoi</h2>
          <p>
            Nous ne traitons que les données nécessaires. Le tableau ci-dessous
            résume chaque traitement, les données concernées, la base légale au
            titre de l'article 6 du RGPD et la durée de conservation.
          </p>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Traitement</th>
                  <th>Données</th>
                  <th>Base légale</th>
                  <th>Conservation</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Compte & authentification</td>
                  <td>Nom, email, méthode de connexion, sessions, métadonnées 2FA/passkey</td>
                  <td>Exécution du contrat (6.1.b)</td>
                  <td>Durée du compte, puis suppression</td>
                </tr>
                <tr>
                  <td>Workspace & fourniture du service</td>
                  <td>Organisation, concurrents/sources configurés, signaux & digests générés</td>
                  <td>Exécution du contrat (6.1.b)</td>
                  <td>Durée du compte ; snapshots selon la fenêtre de rétention du plan</td>
                </tr>
                <tr>
                  <td>Facturation & abonnements</td>
                  <td>Identité de facturation, email, plan, métadonnées de paiement (carte gérée par Stripe, jamais stockée par nous)</td>
                  <td>Contrat (6.1.b) + obligation légale (factures, 6.1.c)</td>
                  <td>Factures conservées 10 ans (droit comptable)</td>
                </tr>
                <tr>
                  <td>Sécurité & anti-abus</td>
                  <td>Adresse IP, journaux de requêtes, signaux captcha & rate-limit</td>
                  <td>Intérêt légitime — sécurisation du service (6.1.f)</td>
                  <td>Jusqu'à 12 mois</td>
                </tr>
                <tr>
                  <td>Formulaire démo / contact</td>
                  <td>Nom, email professionnel, société, taille d'équipe, message</td>
                  <td>Mesures précontractuelles à votre demande (6.1.b) / intérêt légitime (6.1.f)</td>
                  <td>Jusqu'à 3 ans après le dernier contact</td>
                </tr>
                <tr>
                  <td>Analytics produit</td>
                  <td>Événements d'usage pseudonymisés (PostHog, UE)</td>
                  <td>Consentement (6.1.a)</td>
                  <td>Jusqu'à 12 mois ; retirable à tout moment</td>
                </tr>
                <tr>
                  <td>Veille concurrentielle</td>
                  <td>Pages concurrentes publiques ; peut inclure incidemment des données personnelles (ex. noms dans des offres d'emploi ou avis)</td>
                  <td>Intérêt légitime — veille concurrentielle (6.1.f)</td>
                  <td>Selon la fenêtre de rétention du plan</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2>4. Veille concurrentielle &amp; données web (important)</h2>
          <p>
            Outrival surveille des sources concurrentes{" "}
            <strong>publiquement accessibles</strong> que vous configurez (pages
            d'accueil, tarifs, offres d'emploi, changelogs, avis publics). C'est
            notre fonction principale et notre base légale est notre{" "}
            <strong>intérêt légitime</strong> et le vôtre à la veille
            concurrentielle (article 6.1.f), apprécié au regard du test de mise en
            balance en trois étapes et éclairé par l'avis EDPB 28/2024.
          </p>
          <p>Pour rester proportionnés, nous :</p>
          <ul>
            <li>ne collectons que du contenu public — sans contourner d'identification ni de paywall ;</li>
            <li>respectons <code>robots.txt</code> et des limites de débit raisonnables ;</li>
            <li>ciblons les entreprises et les produits, pas les individus — nous ne profilons pas de personnes physiques ;</li>
            <li>minimisons les données personnelles incidentes et ne les utilisons pas pour contacter ou évaluer des individus ;</li>
            <li>ne collectons jamais de données sensibles.</li>
          </ul>
          <p>
            Si vous êtes une personne physique dont des informations publiques
            sont apparues dans une source surveillée et souhaitez leur retrait du
            workspace d'un client, écrivez à{" "}
            <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a>.
          </p>

          <h2>5. Intelligence artificielle</h2>
          <p>
            Nous utilisons des modèles d'IA (via les prestataires listés sur notre{" "}
            <a href="/subprocessors">page sous-traitants</a>) pour classifier les
            changements et générer insights, résumés, digests et battle cards, et
            pour alimenter « Ask Outrival ». Les résultats d'IA sont générés
            automatiquement et peuvent comporter des erreurs ; ils constituent une
            aide à la décision, non un conseil, et ne produisent aucun effet
            juridique ou significatif sur une personne. Nous n'utilisons pas vos
            données pour entraîner des modèles de fondation tiers.
          </p>

          <h2>6. Cookies &amp; traceurs</h2>
          <p>
            Nous utilisons des cookies strictement nécessaires et, avec votre
            consentement, des analytics produit. Le détail et vos réglages figurent
            dans notre <a href="/cookies">Politique cookies</a>.
          </p>

          <h2>7. Avec qui nous partageons</h2>
          <p>
            Nous ne vendons pas de données personnelles. Nous ne les partageons
            qu'avec des sous-traitants agissant sur nos instructions (hébergement,
            base de données, email, paiements, inférence IA, analytics). La liste
            complète et à jour — avec finalité, localisation et garanties de
            transfert — figure sur notre{" "}
            <a href="/subprocessors">page sous-traitants</a>. Nous pouvons aussi
            communiquer des données lorsque la loi l'exige.
          </p>

          <h2>8. Transferts internationaux</h2>
          <p>
            Notre infrastructure principale est dans l'UE. Certains sous-traitants
            sont situés hors EEE (notamment aux États-Unis). Pour ces transferts,
            nous nous appuyons sur les Clauses Contractuelles Types de la
            Commission européenne et, le cas échéant, sur des décisions
            d'adéquation comme le EU–US Data Privacy Framework, assorties de
            garanties complémentaires. Le mécanisme de transfert de chaque
            prestataire est indiqué sur notre{" "}
            <a href="/subprocessors">page sous-traitants</a>.
          </p>

          <h2>9. Vos droits</h2>
          <p>
            En vertu du RGPD, vous disposez des droits d'accès, de rectification,
            d'effacement, de limitation et d'opposition, du droit à la portabilité
            et du droit de retirer votre consentement à tout moment (sans effet
            sur les traitements antérieurs). Vous pouvez :
          </p>
          <ul>
            <li>
              <strong>exporter</strong> vous-même toutes vos données depuis{" "}
              <a href="/dashboard/settings/data">Réglages → Données</a> ;
            </li>
            <li>
              <strong>supprimer définitivement</strong> votre compte ou workspace
              depuis <a href="/dashboard/settings/danger">Réglages → Zone de danger</a> ;
            </li>
            <li>
              exercer tout autre droit en écrivant à{" "}
              <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a> — nous
              répondons sous un mois.
            </li>
          </ul>

          <h2>10. Sécurité</h2>
          <p>
            Nous appliquons des mesures techniques et organisationnelles
            appropriées (article 32) : chiffrement en transit, contrôles d'accès,
            options d'authentification forte (2FA, passkeys), journalisation, et
            infrastructure hébergée dans l'UE. Aucun système n'est parfaitement
            sûr, mais nous œuvrons à protéger vos données et à vous notifier, ainsi
            que la CNIL, toute violation qualifiée.
          </p>

          <h2>11. Mineurs</h2>
          <p>
            Outrival est un outil professionnel non destiné aux mineurs. Nous ne
            collectons pas sciemment de données de personnes de moins de 16 ans.
          </p>

          <h2>12. Modifications</h2>
          <p>
            Nous pouvons mettre à jour cette politique ; la date de « dernière mise
            à jour » en haut reflète la version en vigueur et nous signalerons les
            changements substantiels.
          </p>

          <h2>13. Réclamations</h2>
          <p>
            Vous pouvez introduire une réclamation auprès de la CNIL : Commission
            Nationale de l'Informatique et des Libertés, 3 Place de Fontenoy, TSA
            80715, 75334 Paris Cedex 07 —{" "}
            <a href="https://www.cnil.fr">www.cnil.fr</a>.
          </p>
        </>
      }
    />
  );
}
