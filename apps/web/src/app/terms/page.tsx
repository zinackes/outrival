import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/legal-doc";
import { ENTITY, CONTACT } from "@/lib/legal/entity";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing your use of Outrival.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalDoc
      title={{ en: "Terms of Service", fr: "Conditions générales d'utilisation" }}
      intro={{
        en: "These terms govern access to and use of the Outrival service. Paid subscriptions are additionally governed by our Terms of Sale. Please read them carefully.",
        fr: "Ces conditions régissent l'accès et l'utilisation du service Outrival. Les abonnements payants sont en outre régis par nos Conditions générales de vente. Merci de les lire attentivement.",
      }}
      en={
        <>
          <h2>1. Acceptance</h2>
          <p>
            By creating an account or using Outrival (the “Service”), you agree to
            these Terms of Service (the “Terms”) with {ENTITY.legalName} (“we”,
            “us”, “Outrival”). If you use the Service on behalf of an
            organisation, you confirm you are authorised to bind it.
          </p>

          <h2>2. The Service</h2>
          <p>
            Outrival is a competitive-intelligence platform that monitors publicly
            accessible sources you configure and generates change detections,
            signals, digests and battle cards using automated and AI-assisted
            processing. Features vary by plan and may evolve.
          </p>

          <h2>3. Eligibility &amp; account</h2>
          <p>
            You must be at least 16 and provide accurate information. You are
            responsible for your account, credentials, and all activity under it.
            Enable strong authentication where offered. Notify us of any
            unauthorised use at{" "}
            <a href={`mailto:${CONTACT.security}`}>{CONTACT.security}</a>.
          </p>

          <h2>4. Plans &amp; billing</h2>
          <p>
            Free and paid plans are available. Prices, billing, renewal,
            cancellation and withdrawal are set out in our{" "}
            <a href="/terms-of-sale">Terms of Sale</a>, which form part of your
            agreement when you subscribe.
          </p>

          <h2>5. Acceptable use</h2>
          <p>
            Your use must comply with our{" "}
            <a href="/acceptable-use">Acceptable Use Policy</a>. In particular, you
            must not use the Service to break the law, infringe third-party
            rights, or circumvent access controls of monitored sources.
          </p>

          <h2>6. Your data &amp; responsibilities</h2>
          <p>
            You decide which competitors and sources to monitor and remain
            responsible for that choice. You represent that your monitoring and
            your use of the outputs are lawful in your context. As between us, you
            own the content you submit; where the Service processes personal data
            on your behalf, our{" "}
            <a href="/dpa">Data Processing Agreement</a> applies and you act as
            controller.
          </p>

          <h2>7. Intelligence output &amp; AI</h2>
          <p>
            Signals, summaries, digests, battle cards and “Ask Outrival” answers
            are produced automatically from public data and{" "}
            <strong>AI models</strong>. They are provided on a best-effort basis,
            may be incomplete or inaccurate, and are{" "}
            <strong>decision-support, not professional, legal, financial or
            investment advice</strong>. You are responsible for verifying outputs
            before relying on them. AI-generated content is identified as such in
            the product.
          </p>

          <h2>8. Third-party sources</h2>
          <p>
            The Service observes third-party websites you designate. We are not
            affiliated with, endorsed by, or responsible for those sites, their
            content, terms or availability. Trademarks and content of monitored
            companies remain their owners’.
          </p>

          <h2>9. Intellectual property</h2>
          <p>
            The Service, its software and brand are owned by Outrival or its
            licensors. We grant you a limited, non-exclusive, non-transferable
            right to use the Service during your subscription. You grant us the
            rights needed to operate the Service and, if you send feedback, a
            right to use it without restriction.
          </p>

          <h2>10. Availability &amp; changes</h2>
          <p>
            We work to keep the Service available but do not guarantee
            uninterrupted operation, and some monitored sources may be technically
            unscrapable. We may add, change or discontinue features; material
            changes affecting a paid plan are handled under the Terms of Sale.
          </p>

          <h2>11. Suspension &amp; termination</h2>
          <p>
            You may stop using the Service and delete your workspace at any time.
            We may suspend or terminate access for breach of these Terms, unlawful
            use, or risk to the Service, with notice where practicable. On
            termination, you can export your data as described in our{" "}
            <a href="/privacy">Privacy Policy</a>.
          </p>

          <h2>12. Warranties</h2>
          <p>
            The Service is provided “as is” and “as available”. To the extent
            permitted by law, we disclaim implied warranties. Nothing in these
            Terms excludes rights that cannot be excluded under applicable law,
            including consumers’ statutory guarantees.
          </p>

          <h2>13. Limitation of liability</h2>
          <p>
            To the extent permitted by law, we are not liable for indirect or
            consequential loss, loss of profits, data or opportunity, or for
            decisions made in reliance on Service outputs. Our aggregate liability
            is limited to the amounts you paid for the Service in the 12 months
            before the event. These limits do not apply to liability that cannot
            be limited by law (e.g. gross negligence, or consumers’ mandatory
            rights).
          </p>

          <h2>14. Indemnity (business users)</h2>
          <p>
            If you are a business user, you will defend and indemnify us against
            third-party claims arising from your unlawful use of the Service or
            breach of these Terms.
          </p>

          <h2>15. Changes to these Terms</h2>
          <p>
            We may update these Terms; the “last updated” date reflects the
            current version and we will notify you of material changes. Continued
            use after changes take effect constitutes acceptance.
          </p>

          <h2>16. Governing law &amp; disputes</h2>
          <p>
            These Terms are governed by French law. Consumers benefit from the
            mandatory provisions of their country of residence and may use
            consumer mediation before going to court; business disputes are
            subject to the competent French courts. Contact us first at{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a> — we try to
            resolve issues amicably.
          </p>
        </>
      }
      fr={
        <>
          <h2>1. Acceptation</h2>
          <p>
            En créant un compte ou en utilisant Outrival (le « Service »), vous
            acceptez les présentes conditions générales d'utilisation (les
            « CGU ») avec {ENTITY.legalName} (« nous », « Outrival »). Si vous
            utilisez le Service pour le compte d'une organisation, vous confirmez
            être habilité à l'engager.
          </p>

          <h2>2. Le Service</h2>
          <p>
            Outrival est une plateforme de veille concurrentielle qui surveille des
            sources publiquement accessibles que vous configurez et génère
            détections de changement, signaux, digests et battle cards via des
            traitements automatisés et assistés par IA. Les fonctionnalités varient
            selon le plan et peuvent évoluer.
          </p>

          <h2>3. Éligibilité &amp; compte</h2>
          <p>
            Vous devez avoir au moins 16 ans et fournir des informations exactes.
            Vous êtes responsable de votre compte, de vos identifiants et de toute
            activité s'y rapportant. Activez l'authentification forte lorsqu'elle
            est proposée. Signalez tout usage non autorisé à{" "}
            <a href={`mailto:${CONTACT.security}`}>{CONTACT.security}</a>.
          </p>

          <h2>4. Plans &amp; facturation</h2>
          <p>
            Des plans gratuits et payants sont proposés. Les prix, la facturation,
            le renouvellement, la résiliation et la rétractation figurent dans nos{" "}
            <a href="/terms-of-sale">Conditions générales de vente</a>, qui font
            partie de votre contrat lors de la souscription.
          </p>

          <h2>5. Usage acceptable</h2>
          <p>
            Votre usage doit respecter notre{" "}
            <a href="/acceptable-use">Charte d'usage acceptable</a>. En
            particulier, vous ne devez pas utiliser le Service pour enfreindre la
            loi, violer des droits de tiers ou contourner les contrôles d'accès des
            sources surveillées.
          </p>

          <h2>6. Vos données &amp; responsabilités</h2>
          <p>
            Vous décidez des concurrents et sources à surveiller et restez
            responsable de ce choix. Vous déclarez que votre surveillance et votre
            usage des résultats sont licites dans votre contexte. Entre nous, vous
            êtes propriétaire du contenu que vous soumettez ; lorsque le Service
            traite des données personnelles pour votre compte, notre{" "}
            <a href="/dpa">Accord de traitement des données</a> s'applique et vous
            agissez en qualité de responsable de traitement.
          </p>

          <h2>7. Résultats de veille &amp; IA</h2>
          <p>
            Les signaux, résumés, digests, battle cards et réponses « Ask
            Outrival » sont produits automatiquement à partir de données publiques
            et de <strong>modèles d'IA</strong>. Ils sont fournis au mieux, peuvent
            être incomplets ou inexacts, et constituent une{" "}
            <strong>aide à la décision, non un conseil professionnel, juridique,
            financier ou d'investissement</strong>. Il vous appartient de vérifier
            les résultats avant de vous y fier. Les contenus générés par IA sont
            identifiés comme tels dans le produit.
          </p>

          <h2>8. Sources tierces</h2>
          <p>
            Le Service observe des sites tiers que vous désignez. Nous ne sommes ni
            affiliés à ces sites, ni approuvés par eux, ni responsables de leur
            contenu, de leurs conditions ou de leur disponibilité. Les marques et
            contenus des entreprises surveillées restent la propriété de leurs
            titulaires.
          </p>

          <h2>9. Propriété intellectuelle</h2>
          <p>
            Le Service, son logiciel et sa marque appartiennent à Outrival ou à ses
            concédants. Nous vous accordons un droit d'utilisation limité, non
            exclusif et non transférable pendant votre abonnement. Vous nous
            accordez les droits nécessaires à l'exploitation du Service et, si vous
            transmettez des retours, un droit de les utiliser sans restriction.
          </p>

          <h2>10. Disponibilité &amp; évolutions</h2>
          <p>
            Nous œuvrons à la disponibilité du Service sans garantir un
            fonctionnement ininterrompu ; certaines sources surveillées peuvent
            être techniquement inaccessibles. Nous pouvons ajouter, modifier ou
            arrêter des fonctionnalités ; les changements substantiels affectant un
            plan payant sont régis par les CGV.
          </p>

          <h2>11. Suspension &amp; résiliation</h2>
          <p>
            Vous pouvez cesser d'utiliser le Service et supprimer votre workspace à
            tout moment. Nous pouvons suspendre ou résilier l'accès en cas de
            manquement aux présentes CGU, d'usage illicite ou de risque pour le
            Service, avec préavis lorsque c'est possible. À la résiliation, vous
            pouvez exporter vos données comme décrit dans notre{" "}
            <a href="/privacy">Politique de confidentialité</a>.
          </p>

          <h2>12. Garanties</h2>
          <p>
            Le Service est fourni « en l'état » et « selon disponibilité ». Dans la
            mesure permise par la loi, nous excluons les garanties implicites. Rien
            dans les présentes n'exclut les droits qui ne peuvent l'être en vertu
            de la loi applicable, notamment les garanties légales des
            consommateurs.
          </p>

          <h2>13. Limitation de responsabilité</h2>
          <p>
            Dans la mesure permise par la loi, nous ne sommes pas responsables des
            dommages indirects ou consécutifs, de la perte de profits, de données
            ou d'opportunités, ni des décisions prises sur la foi des résultats du
            Service. Notre responsabilité globale est limitée aux montants versés
            au titre du Service durant les 12 mois précédant le fait générateur.
            Ces limites ne s'appliquent pas à la responsabilité qui ne peut être
            limitée par la loi (ex. faute lourde, ou droits impératifs des
            consommateurs).
          </p>

          <h2>14. Indemnisation (utilisateurs professionnels)</h2>
          <p>
            Si vous êtes un utilisateur professionnel, vous nous garantissez contre
            les réclamations de tiers résultant de votre usage illicite du Service
            ou d'un manquement aux présentes CGU.
          </p>

          <h2>15. Modifications des CGU</h2>
          <p>
            Nous pouvons mettre à jour les présentes CGU ; la date de « dernière
            mise à jour » reflète la version en vigueur et nous vous notifierons les
            changements substantiels. La poursuite de l'utilisation après leur
            entrée en vigueur vaut acceptation.
          </p>

          <h2>16. Droit applicable &amp; litiges</h2>
          <p>
            Les présentes CGU sont régies par le droit français. Les consommateurs
            bénéficient des dispositions impératives de leur pays de résidence et
            peuvent recourir à la médiation de la consommation avant toute action
            judiciaire ; les litiges entre professionnels relèvent des tribunaux
            français compétents. Contactez-nous d'abord à{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a> — nous
            cherchons une résolution amiable.
          </p>
        </>
      }
    />
  );
}
