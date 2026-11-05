import { Form, Link } from "react-router";
import { AccountNav } from "~/components/AccountNav";
import type { Route } from "./+types/account";
import { CsrfField, useRootData } from "~/components/Shell";
import { Button } from "~/components/ui/form";
import { Card } from "~/components/ui/display";
import { clearUserScopedStorageInBrowser } from "~/lib/client-storage";
import { currentUser, privateHeaders, signInRedirect } from "~/lib/auth.server";

export function meta() {
  return [{ title: "Your account | Solvelt" }, { name: "robots", content: "noindex" }];
}

export function headers() {
  return privateHeaders; // personalised: never cache
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user } = await currentUser(request, context);
  if (!user) signInRedirect(request);
  return { displayName: user.displayName };
}

export default function Account({ loaderData }: Route.ComponentProps) {
  const demoButtons = useRootData()?.demo?.buttons === true;
  return (
    <div className="stack">
      <h1>Hello, {loaderData.displayName}</h1>
      <AccountNav />
      <Card className="stack">
        <h2>Account</h2>
        <p>Manage your <Link to="/account/profile">profile</Link>, <Link to="/account/addresses">addresses</Link> and <Link to="/account/passkeys">passkeys</Link>.</p>
        {demoButtons && <p>Test mode: add or remove <Link to="/account/demo">demo data</Link>.</p>}
        <div className="row">
          <Form method="post" action="/sign-out" onSubmit={clearUserScopedStorageInBrowser}>
            <CsrfField />
            <input type="hidden" name="scope" value="this" />
            <Button type="submit" variant="secondary">Sign out</Button>
          </Form>
          <Form method="post" action="/sign-out" onSubmit={clearUserScopedStorageInBrowser}>
            <CsrfField />
            <input type="hidden" name="scope" value="all" />
            <Button type="submit" variant="secondary">Sign out everywhere</Button>
          </Form>
        </div>
      </Card>
    </div>
  );
}
