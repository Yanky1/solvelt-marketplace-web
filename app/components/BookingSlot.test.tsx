import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, data } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingSlot, HOLD_MESSAGES } from "./BookingSlot";

const props = { listingId: "11111111-1111-1111-1111-111111111111", variantId: "v1", title: "Deep Cleaning", variantName: "2 bedrooms", priceCents: 18000, currency: "USD", locations: ["online"] as ("online" | "at-home" | "at-seller")[], available: true };
const slots = [
  { startAt: "2026-11-09T17:00:00Z", endAt: "2026-11-09T21:00:00Z", providerIds: ["p1"] },
  { startAt: "2026-11-09T19:00:00Z", endAt: "2026-11-09T23:00:00Z", providerIds: ["p1"] },
  { startAt: "2026-11-10T17:00:00Z", endAt: "2026-11-10T21:00:00Z", providerIds: ["p1"] },
];
const availability = (over: object = {}) => ({ durationMinutes: 240, priceCents: 24000, providers: [{ providerId: "p1", timeZone: "America/Los_Angeles" }], slots, from: "2026-11-09", to: "2026-11-23", fetchedAt: "2026-11-05T10:00:00Z", ...over });

let fetchMock: ReturnType<typeof vi.fn>;
const reply = (json: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(json) } as unknown as Response);

function setup(over: Partial<typeof props> = {}, action?: () => unknown) {
  const router = createMemoryRouter(
    [{ path: "/bookings/holds", action: action ?? (() => data({ error: "slot_taken" }, { status: 409 })) }, { path: "*", element: <BookingSlot {...props} {...over} /> }],
    { initialEntries: ["/p/deep-house-cleaning?v=2"] },
  );
  render(<RouterProvider router={router} />);
  return { user: userEvent.setup(), router };
}

beforeEach(() => { fetchMock = vi.fn(() => reply(availability())); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("BookingSlot", () => {
  it("says so, and offers nothing, when the option cannot be booked or the seller named no place", () => {
    const { unmount } = render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <BookingSlot {...props} available={false} /> }])} />);
    expect(screen.getByTestId("booking-slot")).toHaveTextContent("cannot be booked right now");
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <BookingSlot {...props} locations={[]} /> }])} />);
    expect(screen.getByTestId("booking-slot")).toHaveTextContent("not said where");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for online times at once, shows them by day in the provider's zone, and posts the chosen one", async () => {
    const { user } = setup();
    await screen.findByRole("group", { name: "Choose a day" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/services/${props.listingId}/availability?location=online`);
    expect(screen.getByText(/Times are shown in America\/Los Angeles/)).toBeInTheDocument();
    const days = within(screen.getByRole("group", { name: "Choose a day" })).getAllByRole("button");
    expect(days.map((d) => d.textContent)).toEqual(["Mon, Nov 9", "Tue, Nov 10"]);
    expect(screen.queryByRole("form", { name: /Book/ })).toBeNull();          // nothing to submit before a time is chosen
    await user.click(days[0]!);
    const times = within(screen.getByRole("group", { name: "Times on Mon, Nov 9" })).getAllByRole("button");
    expect(times.map((t) => t.textContent)).toEqual(["9:00 AM", "11:00 AM"]);
    await user.click(times[1]!);
    expect(times[1]).toHaveAttribute("aria-pressed", "true");
    const form = screen.getByRole("form", { name: "Book Deep Cleaning" });
    const field = (n: string) => (form.querySelector(`[name="${n}"]`) as HTMLInputElement).value;
    expect(field("listingId")).toBe(props.listingId);
    expect(field("start")).toBe("2026-11-09T19:00:00Z");
    expect(field("location")).toBe("online");
    expect(field("durationMinutes")).toBe("240");
    expect(field("returnTo")).toBe("/p/deep-house-cleaning?v=2");
    expect(field("key")).toMatch(/^hold-/);
    expect(within(form).getByRole("button", { name: /Hold Deep Cleaning/ })).toHaveTextContent("$240.00");   // the price the API gave, not the page's
  });

  it("asks an at-home buyer for the postal code first and then for the address of the chosen time", async () => {
    const { user } = setup({ locations: ["at-home", "online"] });
    expect(fetchMock).not.toHaveBeenCalled();                                   // nothing is asked without a postal code
    await user.type(screen.getByLabelText("Your postal code"), "78701");
    await user.click(screen.getByRole("button", { name: "Show times" }));
    await screen.findByRole("group", { name: "Choose a day" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/services/${props.listingId}/availability?location=customer&postalCode=78701`);
    await user.click(screen.getAllByRole("button", { name: "Mon, Nov 9" })[0]!);
    await user.click(screen.getByRole("button", { name: "9:00 AM" }));
    const form = screen.getByRole("form", { name: "Book Deep Cleaning" });
    expect((form.querySelector('[name="location"]') as HTMLInputElement).value).toBe("customer");
    expect((form.querySelector('[name="address.postalCode"]') as HTMLInputElement).value).toBe("78701");
    for (const n of ["address.name", "address.line1", "address.city", "address.country"]) expect(form.querySelector(`[name="${n}"]`)).not.toBeNull();
  });

  it("explains an area the provider does not serve, and a failure to load, in fixed words", async () => {
    fetchMock.mockImplementationOnce(() => reply({ code: "outside_service_area" }, 422));
    const { unmount } = render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <BookingSlot {...props} /> }])} />);
    expect(await screen.findByTestId("availability-error")).toHaveTextContent("does not come to that postal code");
    unmount();
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <BookingSlot {...props} /> }])} />);
    expect(await screen.findByTestId("availability-error")).toHaveTextContent("could not load the times");
  });

  it("says when no time is open", async () => {
    fetchMock.mockImplementation(() => reply(availability({ slots: [] })));
    setup();
    expect(await screen.findByTestId("no-times")).toBeInTheDocument();
  });

  it("shows the reason when the time was taken meanwhile, and lets the buyer choose again", async () => {
    const { user } = setup();
    await user.click((await screen.findAllByRole("button", { name: "Tue, Nov 10" }))[0]!);
    await user.click(screen.getByRole("button", { name: "9:00 AM" }));
    await act(async () => { await user.click(screen.getByRole("button", { name: /Hold Deep Cleaning/ })); });
    await waitFor(() => expect(screen.getByTestId("hold-error")).toHaveTextContent(HOLD_MESSAGES["slot_taken"]!));
  });
});
