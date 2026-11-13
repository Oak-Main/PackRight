import { Link } from 'react-router-dom'
import { PageHeader, Prose } from '../components/Page'
import { API_BASE_URL } from '../lib/api'
import { CONTACT_EMAIL, PRIVACY_EMAIL } from '../lib/seo'
import { LAST_UPDATED, LEGAL_ENTITY, MAILING_ADDRESS_LINE, OPERATING_STATE } from '../lib/site'

const apiHost = (() => {
  try {
    return new URL(API_BASE_URL || 'https://packright-api.kevynsgrin.workers.dev').host
  } catch {
    return 'packright-api.kevynsgrin.workers.dev'
  }
})()

export default function Privacy() {
  return (
    <>
      <PageHeader
        eyebrow="Privacy"
        title="Privacy Policy"
        lede="PackRight is built to answer one question without knowing who you are. This page says what that means in practice."
      />

      <Prose>
        {/* The summary paragraph is the disclosure text specified in the audit. */}
        <p className="text-white">
          PackRight does not require an account or precise location to calculate an estimate. We send
          the airline, fare, passenger count, selected eligible benefit, and bag details you enter to
          our calculation service to return the estimate. We use Google Analytics 4 and Cloudflare
          Web Analytics to understand aggregate site traffic and performance. We do not sell personal
          information. Contact{' '}
          <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> to ask privacy questions.
        </p>

        <h2 id="who-we-are">Who operates this site</h2>
        <p>
          PackRight and Luggageliason.com are operated by <strong>{LEGAL_ENTITY}</strong>, based in{' '}
          {OPERATING_STATE}. Postal address: {MAILING_ADDRESS_LINE}. Privacy questions go to{' '}
          <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
        </p>

        <h2 id="what-we-collect">What we collect</h2>
        <p>
          We do not ask for your name, email address, payment details or precise location to produce
          an estimate. There is no account and no login.
        </p>
        <p>
          The application itself does not write to <code>localStorage</code>,{' '}
          <code>sessionStorage</code> or IndexedDB, and does not request geolocation. Google
          Analytics, described <a href="#analytics">below</a>, sets its own cookies.
        </p>
        <p>
          It does use one form of browser storage: a service worker stores a copy of the
          site&rsquo;s own pages, styles and scripts in the browser&rsquo;s Cache API so the site
          loads quickly and can show an offline notice. That cache holds only files served from
          this site. It never stores your bag details or any estimate, and clearing your
          browser&rsquo;s site data removes it.
        </p>

        <h2 id="calculation-service">The calculation service</h2>
        <p>
          The calculator runs on a separate service at <code>{apiHost}</code>, operated by us on
          Cloudflare Workers. When you change a selection, the site sends that service:
        </p>
        <ul>
          <li>the airline and fare family you selected,</li>
          <li>the number of passengers,</li>
          <li>the eligible card benefit you selected, if any,</li>
          <li>the bag types, weights and any measurements you entered.</li>
        </ul>
        <p>
          These are travel-planning inputs rather than identity data, but they are still sent to a
          different origin, so we name it here. Requests are not stored as user records and the
          responses are marked <code>no-store</code>. As with any internet service, the platform
          processes connection metadata such as your IP address to route and protect the request.
        </p>

        <h2 id="analytics">Analytics</h2>
        <p>
          We use Cloudflare Web Analytics to understand aggregate traffic and performance. It is a
          privacy-first product: it does not use cookies and does not fingerprint visitors. It is
          loaded from <code>static.cloudflareinsights.com</code>.
        </p>
        <p>
          We also use Google Analytics 4 to measure aggregate traffic: which pages are viewed,
          approximate location and device type. Google sets cookies (<code>_ga</code> and{' '}
          <code>_ga_*</code>) to do this, and the script is loaded from{' '}
          <code>www.googletagmanager.com</code>. Google processes this data under its{' '}
          <a href="https://policies.google.com/privacy">privacy policy</a>. You can opt out with
          Google&rsquo;s{' '}
          <a href="https://tools.google.com/dlpage/gaoptout">browser add-on</a>.
        </p>
        <p>
          <strong>Analytics.</strong> We use Google Analytics 4, loaded through Google's gtag.js
          script, to count visits and see which pages are read. It sets first-party cookies (_ga
          and _ga_&lt;ID&gt;) that hold a random identifier, and it records your approximate
          location, device and browser type, the page that referred you and the pages you view. We
          do not use it to identify you and we do not sell this data. You can block these cookies
          in your browser settings or use Google's opt-out at
          https://tools.google.com/dlpage/gaoptout.
        </p>
        <p>
          We do not run advertising pixels, retargeting scripts, session recording, or cross-site
          trackers.
        </p>

        <h2 id="retention">Retention</h2>
        <p>
          We keep no user records, so there is nothing for us to retain or delete on a schedule.
          Our infrastructure provider keeps operational logs for its own delivery and security
          purposes under its retention policy, not ours.
        </p>

        <h2 id="hosting">Hosting and security</h2>
        <p>
          The site and the calculation service are delivered by Cloudflare over HTTPS. Cloudflare
          processes requests as our infrastructure provider, including logs it keeps to deliver and
          protect the service.
        </p>

        <h2 id="do-not-track">Do Not Track</h2>
        <p>
          PackRight does not track visitors across third-party websites, and does not allow third
          parties to do so here. Because there is no cross-site tracking to switch off, the site
          does not change its behaviour in response to a browser Do Not Track signal.
        </p>

        <h2 id="rights">Your rights</h2>
        <p>
          Because we do not build a profile of you or hold an account, there is usually nothing for
          us to look up, export or erase. If you believe we hold information about you, or you want
          to ask how this works, email{' '}
          <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> and we will respond.
        </p>
        <p>We do not sell personal information or share it for cross-context behavioural advertising.</p>

        <h2 id="california">California residents</h2>
        <p>
          {LEGAL_ENTITY} operates from {OPERATING_STATE}. We do not sell or share personal
          information, we do not use it for cross-context behavioural advertising, and we do not
          build profiles of visitors. Because the site requires no account, in most cases there is simply nothing held about you to disclose, delete or
          correct. If you believe otherwise, write to{' '}
          <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> or to the postal address above and
          we will respond. We will not discriminate against you for making a request.
        </p>

        <h2 id="children">Children</h2>
        <p>PackRight is a general-audience travel tool and is not directed to children.</p>

        <h2 id="changes">Changes to this policy</h2>
        <p>
          If this policy changes we will update the date below. Material changes will be described on
          this page rather than applied silently.
        </p>

        <h2 id="contact">Contact</h2>
        <p>
          Privacy questions: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. Anything else:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, or see our{' '}
          <Link to="/contact">contact page</Link>.
        </p>
        <address className="not-italic">
          {LEGAL_ENTITY}
          <br />
          {MAILING_ADDRESS_LINE}
        </address>

        <p className="text-sm">Last updated {LAST_UPDATED}.</p>
      </Prose>
    </>
  )
}
