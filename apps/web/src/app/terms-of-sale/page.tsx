import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { LegalDoc } from "@/components/legal/legal-doc";
import { ENTITY, CONTACT } from "@/lib/legal/entity";

export const metadata: Metadata = pageMetadata({
  path: "/terms-of-sale",
  title: "Terms of Sale",
  description:
    "Terms and conditions of sale for Outrival paid subscriptions (prices, billing, withdrawal, cancellation).",
});

export default function TermsOfSalePage() {
  return (
    <LegalDoc
      title={{ en: "Terms of Sale", fr: "Conditions générales de vente" }}
      intro={{
        en: "These Terms of Sale govern paid Outrival subscriptions. They complement our Terms of Service and apply to both consumers and business customers; consumer-specific rights are highlighted.",
        fr: "Ces Conditions générales de vente régissent les abonnements payants Outrival. Elles complètent nos CGU et s'appliquent aux consommateurs comme aux professionnels ; les droits propres aux consommateurs sont signalés.",
      }}
      en={
        <>
          <h2>1. Seller &amp; scope</h2>
          <p>
            Paid subscriptions are sold by {ENTITY.legalName}, {ENTITY.address}
            (“Outrival”). These Terms of Sale apply to every paid order placed on{" "}
            our website. Placing a paid order constitutes acceptance of these
            terms.
          </p>

          <h2>2. Plans &amp; features</h2>
          <p>
            The essential characteristics of each plan (limits, sources,
            frequency, features) are described on our pricing page and in the app
            at the time of purchase. Free plans are governed by the{" "}
            <a href="/terms">Terms of Service</a> only.
          </p>

          <h2>3. Order &amp; contract formation</h2>
          <p>
            You select a plan and billing period and confirm payment. The contract
            is formed when we confirm the order/payment. You receive a
            confirmation by email.
          </p>

          <h2>4. Prices</h2>
          <p>
            Prices are shown on the pricing page and at checkout, per plan and
            billing period (monthly or yearly). Applicable VAT and its treatment
            are shown at checkout. {ENTITY.legalName} may update prices; changes do
            not affect the current paid period and are notified before renewal.
          </p>
          <p className="fine">
            VAT status will be confirmed on incorporation and reflected at
            checkout (e.g. the applicable rate, or a VAT-exemption mention).
          </p>

          <h2>5. Payment</h2>
          <p>
            Payment is processed securely by Stripe. We do not store your full card
            details. You authorise recurring charges for the chosen billing period
            until cancellation.
          </p>

          <h2>6. Duration, renewal &amp; cancellation</h2>
          <p>
            Subscriptions run for the chosen period and{" "}
            <strong>renew automatically</strong> unless cancelled. You can cancel
            at any time <strong>online</strong> from your billing settings, in a
            few clicks and without penalty; cancellation takes effect at the end of
            the current paid period and access continues until then. Consumers on
            an auto-renewing plan are reminded of their right to cancel as required
            by law.
          </p>

          <h2>7. Right of withdrawal (consumers)</h2>
          <p>
            If you are a consumer, you have{" "}
            <strong>14 days</strong> from conclusion of the contract to withdraw,
            without giving a reason, using the model form below or any clear
            statement to{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>.
          </p>
          <p>
            Because Outrival is a digital service supplied immediately, if you ask
            us to start the service during the withdrawal period you expressly
            request immediate performance and acknowledge that:
          </p>
          <ul>
            <li>
              if you withdraw before the service is fully performed, you owe an
              amount proportionate to what was provided up to your withdrawal; and
            </li>
            <li>
              you lose the right of withdrawal once the service has been fully
              performed with your prior express consent.
            </li>
          </ul>
          <p className="fine">
            A withdrawal button is available in the app in accordance with Article
            L.221-21 of the French Consumer Code (applicable since 19 June 2026).
          </p>

          <h3>Model withdrawal form</h3>
          <p className="fine">
            To the attention of {ENTITY.legalName}, {CONTACT.general}. I/we hereby
            notify you of my/our withdrawal from the contract for the following
            service: [plan]. Ordered on [date]. Name of consumer(s). Address of
            consumer(s). Date. (Signature if paper form.)
          </p>

          <h2>8. Refunds</h2>
          <p>
            Valid withdrawals are refunded within 14 days using the same payment
            method, less any amount due for a service already provided at your
            request. Outside the withdrawal right, subscriptions are non-refundable
            for the current period unless required by law.
          </p>

          <h2>9. Legal guarantees</h2>
          <p>
            Consumers benefit from the statutory guarantee of conformity for
            digital services (Articles L.224-25-1 et seq. of the French Consumer
            Code) and the guarantee against hidden defects (Articles 1641 et seq.
            of the Civil Code), independently of any commercial commitment.
          </p>

          <h2>10. Liability &amp; force majeure</h2>
          <p>
            Our liability is set out in the{" "}
            <a href="/terms">Terms of Service</a>. We are not liable for
            non-performance due to force majeure. Consumers’ mandatory rights are
            unaffected.
          </p>

          <h2>11. Consumer mediation &amp; disputes</h2>
          <p>
            In case of an unresolved dispute, a consumer may refer the matter free
            of charge to a consumer mediator and use the EU Online Dispute
            Resolution platform (
            <a href="https://ec.europa.eu/consumers/odr">
              ec.europa.eu/consumers/odr
            </a>
            ). Our mediator’s details will be provided here on incorporation.
            These terms are governed by French law.
          </p>
        </>
      }
      fr={
        <>
          <h2>1. Vendeur &amp; champ d'application</h2>
          <p>
            Les abonnements payants sont vendus par {ENTITY.legalName},{" "}
            {ENTITY.address} (« Outrival »). Les présentes CGV s'appliquent à toute
            commande payante passée sur notre site. Passer une commande payante
            vaut acceptation des présentes.
          </p>

          <h2>2. Plans &amp; fonctionnalités</h2>
          <p>
            Les caractéristiques essentielles de chaque plan (limites, sources,
            fréquence, fonctionnalités) sont décrites sur notre page tarifs et dans
            l'application au moment de l'achat. Les plans gratuits relèvent
            uniquement des <a href="/terms">CGU</a>.
          </p>

          <h2>3. Commande &amp; formation du contrat</h2>
          <p>
            Vous sélectionnez un plan et une périodicité et confirmez le paiement.
            Le contrat est formé à la confirmation de la commande/du paiement. Vous
            recevez une confirmation par email.
          </p>

          <h2>4. Prix</h2>
          <p>
            Les prix sont affichés sur la page tarifs et au moment du paiement, par
            plan et par périodicité (mensuelle ou annuelle). La TVA applicable et
            son traitement sont indiqués au paiement. {ENTITY.legalName} peut faire
            évoluer ses prix ; les changements n'affectent pas la période payée en
            cours et sont notifiés avant renouvellement.
          </p>
          <p className="fine">
            Le régime de TVA sera confirmé à l'immatriculation et reflété au
            paiement (ex. taux applicable, ou mention d'exonération de TVA).
          </p>

          <h2>5. Paiement</h2>
          <p>
            Le paiement est traité de façon sécurisée par Stripe. Nous ne stockons
            pas vos données de carte complètes. Vous autorisez les prélèvements
            récurrents pour la périodicité choisie jusqu'à résiliation.
          </p>

          <h2>6. Durée, renouvellement &amp; résiliation</h2>
          <p>
            Les abonnements courent pour la période choisie et se{" "}
            <strong>renouvellent automatiquement</strong> sauf résiliation. Vous
            pouvez résilier à tout moment <strong>en ligne</strong> depuis vos
            réglages de facturation, en quelques clics et sans pénalité ; la
            résiliation prend effet à la fin de la période payée en cours, l'accès
            étant maintenu jusque-là. Les consommateurs en reconduction sont
            informés de leur droit de résilier dans les conditions prévues par la
            loi.
          </p>

          <h2>7. Droit de rétractation (consommateurs)</h2>
          <p>
            Si vous êtes consommateur, vous disposez de{" "}
            <strong>14 jours</strong> à compter de la conclusion du contrat pour
            vous rétracter, sans motif, via le formulaire type ci-dessous ou toute
            déclaration dénuée d'ambiguïté adressée à{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>.
          </p>
          <p>
            Outrival étant un service numérique fourni immédiatement, si vous nous
            demandez de commencer l'exécution pendant le délai de rétractation, vous
            demandez expressément une exécution immédiate et reconnaissez que :
          </p>
          <ul>
            <li>
              si vous vous rétractez avant l'exécution complète du service, vous
              devez un montant proportionnel à ce qui a été fourni jusqu'à votre
              rétractation ; et
            </li>
            <li>
              vous perdez le droit de rétractation une fois le service pleinement
              exécuté avec votre accord préalable exprès.
            </li>
          </ul>
          <p className="fine">
            Un bouton de rétractation est disponible dans l'application
            conformément à l'article L.221-21 du Code de la consommation
            (applicable depuis le 19 juin 2026).
          </p>

          <h3>Formulaire type de rétractation</h3>
          <p className="fine">
            À l'attention de {ENTITY.legalName}, {CONTACT.general}. Je/nous vous
            notifie/notifions ma/notre rétractation du contrat portant sur le
            service suivant : [plan]. Commandé le [date]. Nom du/des
            consommateur(s). Adresse du/des consommateur(s). Date. (Signature en
            cas de formulaire papier.)
          </p>

          <h2>8. Remboursements</h2>
          <p>
            Les rétractations valables sont remboursées sous 14 jours par le même
            moyen de paiement, déduction faite du montant dû pour un service déjà
            fourni à votre demande. Hors droit de rétractation, les abonnements ne
            sont pas remboursables pour la période en cours, sauf disposition légale
            contraire.
          </p>

          <h2>9. Garanties légales</h2>
          <p>
            Les consommateurs bénéficient de la garantie légale de conformité des
            services numériques (articles L.224-25-1 et suivants du Code de la
            consommation) et de la garantie contre les vices cachés (articles 1641
            et suivants du Code civil), indépendamment de tout engagement
            commercial.
          </p>

          <h2>10. Responsabilité &amp; force majeure</h2>
          <p>
            Notre responsabilité est définie dans les{" "}
            <a href="/terms">CGU</a>. Nous ne sommes pas responsables d'une
            inexécution due à un cas de force majeure. Les droits impératifs des
            consommateurs ne sont pas affectés.
          </p>

          <h2>11. Médiation de la consommation &amp; litiges</h2>
          <p>
            En cas de litige non résolu, le consommateur peut recourir gratuitement
            à un médiateur de la consommation et à la plateforme européenne de
            règlement en ligne des litiges (
            <a href="https://ec.europa.eu/consumers/odr">
              ec.europa.eu/consumers/odr
            </a>
            ). Les coordonnées de notre médiateur seront indiquées ici à
            l'immatriculation. Les présentes CGV sont régies par le droit français.
          </p>
        </>
      }
    />
  );
}
