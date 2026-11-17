import type { Metadata } from "next";
import Link from "next/link";
import { site } from "../site";

export const metadata: Metadata = {
  title: `Privacy · ${site.name}`,
  description: `What ${site.name} does with your location, calendar and music data.`,
  alternates: { canonical: "/privacy" },
};

const h2 = "mt-12 text-xs font-medium uppercase tracking-[0.18em] text-white/35";
const p = "mt-4 text-[1.0625rem] leading-relaxed font-light text-white/70";
const li = "mt-3 text-[1.0625rem] leading-relaxed font-light text-white/70";

export default function Privacy() {
  return (
    <main className="h-dvh overflow-y-auto bg-[#0a0a0a]">
      <article className="mx-auto max-w-2xl px-5 py-16 sm:py-24">
        <Link href="/" className="text-sm text-white/40 hover:text-white/80">
          ← {site.name}
        </Link>
        <h1 className="mt-8 text-4xl font-extralight tracking-tight text-[#ededea] sm:text-5xl">Privacy</h1>
        <p className="mt-3 text-sm text-white/35">Last updated 17 November 2026</p>

        <p className={p}>
          {site.name} is a clock that runs in your browser. It has no accounts, no analytics, no ads and no database. This page
          lists every piece of your data it touches, where that data goes, and why.
        </p>

        <h2 className={h2}>Location and weather</h2>
        <ul className="mt-1 list-disc pl-5 marker:text-white/20">
          <li className={li}>
            If you allow location, your browser&rsquo;s coordinates are sent to{" "}
            <a className="underline decoration-white/20 underline-offset-2" href="https://open-meteo.com">Open-Meteo</a> for the
            weather and to <a className="underline decoration-white/20 underline-offset-2" href="https://www.bigdatacloud.com">BigDataCloud</a> to
            name your city. These requests go straight from your browser to those services.
          </li>
          <li className={li}>
            If you decline, your IP address is used by <a className="underline decoration-white/20 underline-offset-2" href="https://www.geojs.io">GeoJS</a> to estimate your city.
          </li>
          <li className={li}>The last weather result is cached in your browser&rsquo;s local storage so the clock works offline.</li>
        </ul>

        <h2 className={h2}>Calendars</h2>
        <ul className="mt-1 list-disc pl-5 marker:text-white/20">
          <li className={li}>
            <strong className="font-normal text-white/85">Google Calendar and Outlook.</strong> When you connect an account, you grant
            read-only access to your calendars. That&rsquo;s Google&rsquo;s <code className="text-white/60">calendar.readonly</code> scope or
            Microsoft&rsquo;s <code className="text-white/60">Calendars.Read</code>. The sign-in token is encrypted and stored in a
            cookie on your device only. When the clock asks for your upcoming events, the server uses that token to fetch the next
            day and a half of events and passes them straight back. Event titles and times are shown on screen and nothing else is
            used. Nothing is stored or logged on the server, and nothing is shared with anyone.
          </li>
          <li className={li}>
            <strong className="font-normal text-white/85">iCal links.</strong> A calendar address you paste is kept in your
            browser. It&rsquo;s sent to this site&rsquo;s server only to download the feed, because browsers can&rsquo;t fetch
            calendar feeds directly. It isn&rsquo;t stored or logged.
          </li>
          <li className={li}>
            Disconnecting an account deletes its cookie, and for Google it also revokes the token. You can remove access at any
            time from your{" "}
            <a className="underline decoration-white/20 underline-offset-2" href="https://myaccount.google.com/permissions">Google account</a> or{" "}
            <a className="underline decoration-white/20 underline-offset-2" href="https://account.live.com/consent/Manage">Microsoft account</a> too.
          </li>
          <li className={li}>
            {site.name}&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
            <a
              className="underline decoration-white/20 underline-offset-2"
              href="https://developers.google.com/terms/api-services-user-data-policy"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </li>
        </ul>

        <h2 className={h2}>Spotify</h2>
        <p className={p}>
          Connecting Spotify signs you in directly between your browser and Spotify. The resulting token stays in your
          browser&rsquo;s local storage and never reaches this site&rsquo;s server. The clock reads what&rsquo;s playing and sends
          play, pause and skip when you press them. Disconnect from Settings, or remove access in your{" "}
          <a className="underline decoration-white/20 underline-offset-2" href="https://www.spotify.com/account/apps/">Spotify account</a>.
        </p>

        <h2 className={h2}>Cookies and storage</h2>
        <p className={p}>
          The only cookies are the encrypted calendar connections above, plus a short-lived one during sign-in. Your settings live in
          your browser&rsquo;s local storage. Clearing site data removes all of it.
        </p>

        <h2 className={h2}>Hosting</h2>
        <p className={p}>
          The site is hosted on Vercel, which keeps standard request logs (such as IP address and the page requested) for operating
          the service. The source code is public on{" "}
          <a className="underline decoration-white/20 underline-offset-2" href={site.repo}>GitHub</a>, so you can check every claim
          here.
        </p>

        <h2 className={h2}>Contact</h2>
        <p className={p}>
          Questions or requests:{" "}
          <a className="underline decoration-white/20 underline-offset-2" href={`${site.repo}/issues`}>open an issue on GitHub</a>.
        </p>
      </article>
    </main>
  );
}
