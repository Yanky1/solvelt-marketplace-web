import { useNonce } from "~/lib/nonce";
import { jsonLdString } from "~/lib/seo";

/** Structured data for crawlers. A data block is not executed, but it carries the page's CSP nonce anyway (the one rule is "every inline script has the nonce", and the headers test checks it); the escaping in jsonLdString keeps catalog text from leaving the tag. */
export function JsonLd({ data }: { data: unknown }) {
  const nonce = useNonce();
  return <script type="application/ld+json" nonce={nonce || undefined} dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
