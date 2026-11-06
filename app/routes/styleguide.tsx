import { useState } from "react";
import { Badge, Breadcrumb, Card, EmptyState, Pagination, Price, RatingStars, Skeleton } from "~/components/ui/display";
import { Button, Checkbox, Input, LinkButton, Select } from "~/components/ui/form";
import { Modal, useToast } from "~/components/ui/overlay";

export function meta() {
  return [{ title: "Styleguide | Solvelt" }, { name: "robots", content: "noindex" }];
}

export default function Styleguide() {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <div className="stack">
      <Breadcrumb items={[{ label: "Home", to: "/" }, { label: "Styleguide" }]} />
      <h1>Styleguide</h1>
      <Card className="stack">
        <h2>Buttons</h2>
        <div className="row">
          <Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button>
          <LinkButton to="/">Link button</LinkButton>
        </div>
        <p>Body text with a <a href="/">regular link</a> and <span className="muted">muted text</span>.</p>
      </Card>
      <Card className="stack">
        <h2>Form</h2>
        <Input label="Email" type="email" name="email" hint="We never share it." />
        <Input label="Password" type="password" name="pw" error="Use at least 12 characters." />
        <Select label="Country" name="c" defaultValue="us"><option value="us">United States</option><option value="il">Israel</option></Select>
        <Checkbox label="Remember me" />
      </Card>
      <Card className="stack">
        <h2>Display</h2>
        <div className="row"><Badge>Neutral</Badge><Badge tone="gold">Kosher</Badge><Badge tone="ok">In stock</Badge><Badge tone="err">Sold out</Badge></div>
        <Price cents={4999} wasCents={5999} />
        <RatingStars value={4.4} count={128} />
        <Skeleton size="title" />
        <EmptyState title="Nothing here yet">Try another category.</EmptyState>
        <Pagination page={2} pageCount={6} hrefFor={(p) => `/styleguide?page=${p}`} />
      </Card>
      <Card className="row">
        <Button onClick={() => setOpen(true)}>Open modal</Button>
        <Button variant="secondary" onClick={() => toast("Saved")}>Show toast</Button>
        <Modal open={open} onClose={() => setOpen(false)} title="Example modal"><p>Native dialog with focus trap.</p></Modal>
      </Card>
    </div>
  );
}
