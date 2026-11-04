import { Form, useNavigation } from "react-router";
import { CsrfField } from "./Shell";
import { Button, Checkbox, Input, Select } from "./ui/form";
import { COUNTRIES, type FieldErrors } from "~/lib/validation";

export interface AddressValues {
  fullName: string; line1: string; line2: string; city: string; region: string; postalCode: string; country: string; phone: string; isDefault: boolean;
}

export const EMPTY_ADDRESS: AddressValues = { fullName: "", line1: "", line2: "", city: "", region: "", postalCode: "", country: "US", phone: "", isDefault: false };

export function AddressForm({ values, errors, submitLabel }: { values: AddressValues; errors?: FieldErrors | undefined; submitLabel: string }) {
  const busy = useNavigation().state !== "idle";
  return (
    <Form method="post" className="stack" noValidate>
      <CsrfField />
      <input type="hidden" name="intent" value="save" />
      <Input label="Full name" name="fullName" autoComplete="name" defaultValue={values.fullName} error={errors?.fullName} required />
      <Input label="Street address" name="line1" autoComplete="address-line1" defaultValue={values.line1} error={errors?.line1} required />
      <Input label="Apartment, suite, etc. (optional)" name="line2" autoComplete="address-line2" defaultValue={values.line2} error={errors?.line2} />
      <Input label="City" name="city" autoComplete="address-level2" defaultValue={values.city} error={errors?.city} required />
      <Input label="State / region (optional)" name="region" autoComplete="address-level1" defaultValue={values.region} error={errors?.region} />
      <Input label="Postal code" name="postalCode" autoComplete="postal-code" defaultValue={values.postalCode} error={errors?.postalCode} required />
      <Select label="Country" name="country" autoComplete="country" defaultValue={values.country} error={errors?.country}>
        {Object.entries(COUNTRIES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </Select>
      <Input label="Phone (optional)" name="phone" type="tel" autoComplete="tel" defaultValue={values.phone} error={errors?.phone} hint="Only used by the carrier for delivery questions." />
      <Checkbox label="Use as my default address" name="isDefault" defaultChecked={values.isDefault} />
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
    </Form>
  );
}
