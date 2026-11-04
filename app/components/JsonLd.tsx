import { jsonLdString } from "~/lib/seo";

/** Structured data for crawlers. A data block is not executed, so the CSP nonce is not involved; the escaping in jsonLdString keeps catalog text from leaving the tag. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
