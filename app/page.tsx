import Dashboard from "./dashboard";
import { site } from "./site";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: site.name,
  url: site.url,
  description: site.description,
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any (web browser)",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Dashboard />
    </>
  );
}
