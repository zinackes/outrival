import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { LegalDoc } from "@/components/legal/legal-doc";
import { CONTACT, SUBPROCESSORS } from "@/lib/legal/entity";

export const metadata: Metadata = pageMetadata({
  path: "/subprocessors",
  title: "Subprocessors",
  description:
    "The third-party subprocessors Outrival uses to deliver the service, with purpose, location and transfer safeguards.",
});

function Table({ lang }: { lang: "en" | "fr" }) {
  const h =
    lang === "fr"
      ? { name: "Prestataire", purpose: "Finalité", data: "Données", loc: "Localisation", tr: "Transfert" }
      : { name: "Provider", purpose: "Purpose", data: "Data", loc: "Location", tr: "Transfer" };
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>{h.name}</th>
            <th>{h.purpose}</th>
            <th>{h.data}</th>
            <th>{h.loc}</th>
            <th>{h.tr}</th>
          </tr>
        </thead>
        <tbody>
          {SUBPROCESSORS.map((s) => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td>{s.purpose[lang]}</td>
              <td>{s.data[lang]}</td>
              <td>{s.location}</td>
              <td>{s.outsideEea ? s.transfer ?? "SCC" : lang === "fr" ? "UE/EEE" : "EU/EEA"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SubprocessorsPage() {
  return (
    <LegalDoc
      title={{ en: "Subprocessors", fr: "Sous-traitants" }}
      intro={{
        en: "This is the current list of third-party subprocessors that may process personal data on Outrival's behalf. It is the authoritative list referenced by our DPA; we give advance notice of changes.",
        fr: "Voici la liste actuelle des sous-traitants tiers susceptibles de traiter des données personnelles pour le compte d'Outrival. C'est la liste de référence de notre DPA ; nous donnons un préavis en cas de changement.",
      }}
      en={
        <>
          <h2>Current subprocessors</h2>
          <Table lang="en" />
          <p className="fine">
            “SCC” = EU Standard Contractual Clauses. Core infrastructure is
            EU-hosted; providers outside the EEA rely on the safeguards shown.
          </p>

          <h2>Changes &amp; objections</h2>
          <p>
            Under our <a href="/dpa">Data Processing Agreement</a> you grant
            general authorisation to these subprocessors. We give advance notice of
            any addition or replacement. To be notified of changes, or to object on
            reasonable data-protection grounds, contact{" "}
            <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a>.
          </p>
          <p className="fine">
            v1.1 (July 22, 2026). Trigger.dev removed and netcup GmbH added:
            background job orchestration moved from the United States to the EU
            (Austria). No other change.
          </p>
        </>
      }
      fr={
        <>
          <h2>Sous-traitants actuels</h2>
          <Table lang="fr" />
          <p className="fine">
            « SCC » = Clauses Contractuelles Types de l'UE. L'infrastructure
            principale est hébergée dans l'UE ; les prestataires hors EEE s'appuient
            sur les garanties indiquées.
          </p>

          <h2>Changements &amp; opposition</h2>
          <p>
            Au titre de notre{" "}
            <a href="/dpa">Accord de traitement des données</a>, vous accordez une
            autorisation générale à ces sous-traitants. Nous donnons un préavis pour
            tout ajout ou remplacement. Pour être informé des changements, ou vous y
            opposer pour des motifs raisonnables, écrivez à{" "}
            <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a>.
          </p>
          <p className="fine">
            v1.1 (22 juillet 2026). Trigger.dev retiré et netcup GmbH ajouté :
            l'orchestration des jobs est passée des États-Unis à l'UE (Autriche).
            Aucun autre changement.
          </p>
        </>
      }
    />
  );
}
