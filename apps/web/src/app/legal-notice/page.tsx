import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/legal-doc";
import { ENTITY, CONTACT, HOST, DOMAINS } from "@/lib/legal/entity";

export const metadata: Metadata = {
  title: "Legal Notice",
  description: "Publisher and hosting information for Outrival (LCEN).",
  alternates: { canonical: "/legal-notice" },
};

export default function LegalNoticePage() {
  return (
    <LegalDoc
      title={{ en: "Legal Notice", fr: "Mentions légales" }}
      intro={{
        en: "Publisher, hosting and contact information for the Outrival website, published under Article 6 of the French Law for Confidence in the Digital Economy (LCEN).",
        fr: "Informations relatives à l'éditeur, à l'hébergeur et au contact du site Outrival, publiées en application de l'article 6 de la loi pour la confiance dans l'économie numérique (LCEN).",
      }}
      en={
        <>
          <h2>1. Publisher</h2>
          <p>The {DOMAINS.canonical} website (the “Site”) is published by:</p>
          <ul>
            <li>Company name: {ENTITY.legalName}</li>
            <li>Legal form: {ENTITY.legalForm}</li>
            <li>Share capital: {ENTITY.capital}</li>
            <li>Registered office: {ENTITY.address}</li>
            <li>Trade & Companies Register: {ENTITY.rcs}</li>
            <li>SIREN / SIRET: {ENTITY.siret}</li>
            <li>Intra-EU VAT number: {ENTITY.vat}</li>
            <li>
              Contact: <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>
            </li>
          </ul>
          <p className="fine">
            Outrival is a trading name; the incorporated entity’s details above
            are being finalised and will be updated here on registration.
          </p>

          <h2>2. Publication Director</h2>
          <p>
            The director of publication is {ENTITY.publicationDirector}, in their
            capacity as legal representative of the publisher.
          </p>

          <h2>3. Hosting</h2>
          <p>The Site is hosted by:</p>
          <ul>
            <li>{HOST.name}</li>
            <li>{HOST.address}</li>
            <li>Telephone: {HOST.phone}</li>
            <li>{HOST.rcs}</li>
            <li>
              Website: <a href={HOST.website}>{HOST.website}</a>
            </li>
          </ul>
          <p className="fine">
            Application data is stored on EU infrastructure. Background
            processing (job queue and scraping workers) runs on infrastructure
            provided by netcup GmbH in Austria (EU). The full list of
            infrastructure and processing providers is available on our{" "}
            <a href="/subprocessors">subprocessors page</a>.
          </p>

          <h2>4. Contact</h2>
          <p>
            For any question about the Site, you can reach us at{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>. For data
            protection requests, see our{" "}
            <a href="/privacy">Privacy Policy</a>.
          </p>

          <h2>5. Intellectual Property</h2>
          <p>
            The Site, its structure, text, graphics, logos, and software are the
            property of the publisher or its licensors and are protected by
            intellectual property law. Any reproduction, representation, or
            reuse, in whole or in part, without prior written authorisation is
            prohibited, save for the exceptions provided by law.
          </p>

          <h2>6. Personal Data</h2>
          <p>
            The processing of personal data carried out through the Site is
            described in our <a href="/privacy">Privacy Policy</a> and{" "}
            <a href="/cookies">Cookie Policy</a>, in accordance with the GDPR and
            the French Data Protection Act.
          </p>

          <h2>7. Reporting Illicit Content</h2>
          <p>
            In accordance with the LCEN and the French SREN Act, any manifestly
            illicit content brought to our attention can be reported to{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>. Please
            describe the content and its location precisely.
          </p>

          <h2>8. Governing Law</h2>
          <p>
            This legal notice is governed by French law. Any dispute relating to
            the Site is subject to the jurisdiction of the competent French
            courts, subject to any mandatory rules of consumer protection.
          </p>
        </>
      }
      fr={
        <>
          <h2>1. Éditeur</h2>
          <p>Le site {DOMAINS.canonical} (le « Site ») est édité par :</p>
          <ul>
            <li>Dénomination sociale : {ENTITY.legalName}</li>
            <li>Forme juridique : {ENTITY.legalForm}</li>
            <li>Capital social : {ENTITY.capital}</li>
            <li>Siège social : {ENTITY.address}</li>
            <li>Registre du commerce et des sociétés : {ENTITY.rcs}</li>
            <li>SIREN / SIRET : {ENTITY.siret}</li>
            <li>Numéro de TVA intracommunautaire : {ENTITY.vat}</li>
            <li>
              Contact : <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>
            </li>
          </ul>
          <p className="fine">
            « Outrival » est un nom commercial ; les mentions de la personne
            morale ci-dessus sont en cours de finalisation et seront mises à jour
            ici lors de l'immatriculation.
          </p>

          <h2>2. Directeur de la publication</h2>
          <p>
            Le directeur de la publication est {ENTITY.publicationDirector}, en sa
            qualité de représentant légal de l'éditeur.
          </p>

          <h2>3. Hébergeur</h2>
          <p>Le Site est hébergé par :</p>
          <ul>
            <li>{HOST.name}</li>
            <li>{HOST.address}</li>
            <li>Téléphone : {HOST.phone}</li>
            <li>{HOST.rcs}</li>
            <li>
              Site web : <a href={HOST.website}>{HOST.website}</a>
            </li>
          </ul>
          <p className="fine">
            Les données applicatives sont stockées sur une infrastructure située
            dans l'Union européenne. Les traitements en arrière-plan (file de
            jobs et workers de scraping) s'exécutent sur une infrastructure
            fournie par netcup GmbH en Autriche (UE). La liste complète des
            prestataires d'infrastructure et de traitement est disponible sur
            notre <a href="/subprocessors">page sous-traitants</a>.
          </p>

          <h2>4. Contact</h2>
          <p>
            Pour toute question relative au Site, vous pouvez nous écrire à{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>. Pour les
            demandes relatives aux données personnelles, consultez notre{" "}
            <a href="/privacy">Politique de confidentialité</a>.
          </p>

          <h2>5. Propriété intellectuelle</h2>
          <p>
            Le Site, sa structure, ses textes, graphismes, logos et logiciels
            sont la propriété de l'éditeur ou de ses concédants et sont protégés
            par le droit de la propriété intellectuelle. Toute reproduction,
            représentation ou réutilisation, totale ou partielle, sans
            autorisation écrite préalable est interdite, sous réserve des
            exceptions prévues par la loi.
          </p>

          <h2>6. Données personnelles</h2>
          <p>
            Les traitements de données personnelles réalisés via le Site sont
            décrits dans notre{" "}
            <a href="/privacy">Politique de confidentialité</a> et notre{" "}
            <a href="/cookies">Politique cookies</a>, conformément au RGPD et à la
            loi Informatique et Libertés.
          </p>

          <h2>7. Signalement de contenus illicites</h2>
          <p>
            Conformément à la LCEN et à la loi SREN, tout contenu manifestement
            illicite porté à notre connaissance peut être signalé à{" "}
            <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>. Merci de
            décrire précisément le contenu et son emplacement.
          </p>

          <h2>8. Droit applicable</h2>
          <p>
            Les présentes mentions légales sont régies par le droit français.
            Tout litige relatif au Site relève de la compétence des tribunaux
            français compétents, sous réserve des règles impératives de
            protection des consommateurs.
          </p>
        </>
      }
    />
  );
}
