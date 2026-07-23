import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { LegalDoc } from "@/components/legal/legal-doc";
import { CookiePreferencesButton } from "@/components/legal/cookie-preferences-button";
import { CONTACT } from "@/lib/legal/entity";

export const metadata: Metadata = pageMetadata({
  path: "/cookies",
  title: "Cookie Policy",
  description:
    "The cookies and similar technologies Outrival uses, and how to control them.",
});

const manageClass = "text-primary underline underline-offset-2 hover:opacity-80";

export default function CookiesPage() {
  return (
    <LegalDoc
      title={{ en: "Cookie Policy", fr: "Politique cookies" }}
      intro={{
        en: "This policy lists the cookies and local storage Outrival uses, why, for how long, and how you control them. It complements our Privacy Policy.",
        fr: "Cette politique liste les cookies et le stockage local utilisés par Outrival, leur finalité, leur durée et la manière de les contrôler. Elle complète notre Politique de confidentialité.",
      }}
      en={
        <>
          <h2>1. What are cookies?</h2>
          <p>
            Cookies and similar technologies (local storage) are small files
            stored on your device. We use two categories:{" "}
            <strong>strictly necessary</strong> (required to run the service, no
            consent needed) and <strong>analytics</strong> (optional, only with
            your consent).
          </p>

          <h2>2. Your choices</h2>
          <p>
            When you first visit, a banner lets you accept, reject, or customise
            non-essential cookies. You can change your mind at any time:{" "}
            <CookiePreferencesButton className={manageClass}>
              open cookie preferences
            </CookiePreferencesButton>
            . You can also block cookies in your browser settings, though strictly
            necessary cookies cannot be disabled without breaking the service.
          </p>

          <h2>3. Cookies we use</h2>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Purpose</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Better Auth session</td>
                  <td>Necessary</td>
                  <td>Keeps you signed in securely</td>
                  <td>Up to 30 days</td>
                </tr>
                <tr>
                  <td>ph_consent</td>
                  <td>Necessary</td>
                  <td>Remembers your cookie choice</td>
                  <td>6 months</td>
                </tr>
                <tr>
                  <td>outrival.product</td>
                  <td>Necessary</td>
                  <td>Remembers the selected product/workspace scope</td>
                  <td>Persistent</td>
                </tr>
                <tr>
                  <td>outrival.legal.lang</td>
                  <td>Necessary</td>
                  <td>Remembers your legal-document language (local storage)</td>
                  <td>Persistent</td>
                </tr>
                <tr>
                  <td>Cloudflare Turnstile</td>
                  <td>Necessary</td>
                  <td>Bot / abuse protection on forms</td>
                  <td>Session</td>
                </tr>
                <tr>
                  <td>Stripe</td>
                  <td>Necessary</td>
                  <td>Fraud prevention during checkout (set only on payment)</td>
                  <td>Session / up to 1 year</td>
                </tr>
                <tr>
                  <td>PostHog (ph_*, distinct_id)</td>
                  <td>Analytics — consent</td>
                  <td>Pseudonymised product usage to improve Outrival (EU)</td>
                  <td>Up to 12 months</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="fine">
            Analytics cookies are set only after you consent, and product
            analytics is off by default until then.
          </p>

          <h2>4. Questions</h2>
          <p>
            For any question about cookies, contact{" "}
            <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a>. See also
            our <a href="/privacy">Privacy Policy</a>.
          </p>
        </>
      }
      fr={
        <>
          <h2>1. Que sont les cookies ?</h2>
          <p>
            Les cookies et technologies similaires (stockage local) sont de petits
            fichiers stockés sur votre appareil. Nous utilisons deux catégories :{" "}
            <strong>strictement nécessaires</strong> (indispensables au service,
            sans consentement) et <strong>analytics</strong> (optionnels,
            uniquement avec votre consentement).
          </p>

          <h2>2. Vos choix</h2>
          <p>
            Lors de votre première visite, un bandeau vous permet d'accepter, de
            refuser ou de personnaliser les cookies non essentiels. Vous pouvez
            changer d'avis à tout moment :{" "}
            <CookiePreferencesButton className={manageClass}>
              ouvrir les préférences cookies
            </CookiePreferencesButton>
            . Vous pouvez aussi bloquer les cookies via votre navigateur, mais les
            cookies strictement nécessaires ne peuvent être désactivés sans casser
            le service.
          </p>

          <h2>3. Cookies utilisés</h2>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Catégorie</th>
                  <th>Finalité</th>
                  <th>Durée</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Session Better Auth</td>
                  <td>Nécessaire</td>
                  <td>Maintient votre connexion de façon sécurisée</td>
                  <td>Jusqu'à 30 jours</td>
                </tr>
                <tr>
                  <td>ph_consent</td>
                  <td>Nécessaire</td>
                  <td>Mémorise votre choix cookies</td>
                  <td>6 mois</td>
                </tr>
                <tr>
                  <td>outrival.product</td>
                  <td>Nécessaire</td>
                  <td>Mémorise le produit/workspace sélectionné</td>
                  <td>Persistant</td>
                </tr>
                <tr>
                  <td>outrival.legal.lang</td>
                  <td>Nécessaire</td>
                  <td>Mémorise la langue des documents légaux (stockage local)</td>
                  <td>Persistant</td>
                </tr>
                <tr>
                  <td>Cloudflare Turnstile</td>
                  <td>Nécessaire</td>
                  <td>Protection anti-bot / anti-abus des formulaires</td>
                  <td>Session</td>
                </tr>
                <tr>
                  <td>Stripe</td>
                  <td>Nécessaire</td>
                  <td>Prévention de la fraude au paiement (posé au checkout)</td>
                  <td>Session / jusqu'à 1 an</td>
                </tr>
                <tr>
                  <td>PostHog (ph_*, distinct_id)</td>
                  <td>Analytics — consentement</td>
                  <td>Usage produit pseudonymisé pour améliorer Outrival (UE)</td>
                  <td>Jusqu'à 12 mois</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="fine">
            Les cookies analytics ne sont posés qu'après votre consentement ;
            l'analytics produit est désactivé par défaut jusque-là.
          </p>

          <h2>4. Questions</h2>
          <p>
            Pour toute question sur les cookies, écrivez à{" "}
            <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a>. Voir aussi
            notre <a href="/privacy">Politique de confidentialité</a>.
          </p>
        </>
      }
    />
  );
}
