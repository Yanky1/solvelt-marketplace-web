import { Form, Link } from "react-router";
import type { Route } from "./+types/account.addresses";
import { AccountNav } from "~/components/AccountNav";
import { CsrfField } from "~/components/Shell";
import { Badge, Card, EmptyState } from "~/components/ui/display";
import { Button, LinkButton } from "~/components/ui/form";
import { api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";
import { COUNTRIES, str } from "~/lib/validation";
import { redirect } from "react-router";

export function meta() {
  return [{ title: "Addresses | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  try {
    return { addresses: await api.addresses(ctx) };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const id = str(form, "id");
  const intent = str(form, "intent");
  if (!isSafeId(id)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  try {
    if (intent === "delete" && id) await api.deleteAddress(ctx, id);
    else if (intent === "default" && id) await api.setDefaultAddress(ctx, id);
    else throw new Response("Bad request", { status: 400 });
  } catch (e) {
    return failAccount(e, request);
  }
  return redirect("/account/addresses", { headers: privateHeaders });
}

export default function Addresses({ loaderData }: Route.ComponentProps) {
  const { addresses } = loaderData;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--s2)" }}>
        <h2 style={{ margin: 0 }}>Addresses</h2>
        <LinkButton to="/account/addresses/new">Add an address</LinkButton>
      </div>
      {addresses.length === 0 ? (
        <EmptyState title="No saved addresses" action={<LinkButton to="/account/addresses/new">Add your first address</LinkButton>}>Save an address to check out faster.</EmptyState>
      ) : (
        <ul className="grid" style={{ listStyle: "none", padding: 0 }}>
          {addresses.map((a) => (
            <li key={a.id}>
              <Card className="stack">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{a.fullName}</strong>
                  {a.isDefault && <Badge tone="gold">Default</Badge>}
                </div>
                <address style={{ fontStyle: "normal" }}>
                  {a.line1}<br />
                  {a.line2 && <>{a.line2}<br /></>}
                  {a.city}{a.region ? `, ${a.region}` : ""} {a.postalCode}<br />
                  {COUNTRIES[a.country] ?? a.country}
                  {a.phone && <><br />{a.phone}</>}
                </address>
                <div className="row">
                  <Link className="btn btn-secondary" to={`/account/addresses/${encodeURIComponent(a.id)}`} aria-label={`Edit address for ${a.fullName}`}>Edit</Link>
                  {!a.isDefault && (
                    <Form method="post">
                      <CsrfField /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="intent" value="default" />
                      <Button type="submit" variant="secondary" aria-label={`Make address for ${a.fullName} the default`}>Make default</Button>
                    </Form>
                  )}
                  <Form method="post">
                    <CsrfField /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="intent" value="delete" />
                    <Button type="submit" variant="ghost" aria-label={`Remove address for ${a.fullName}`}>Remove</Button>
                  </Form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
