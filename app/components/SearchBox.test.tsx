import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBox, SUGGEST_DELAY_MS } from "./SearchBox";

const body = (s: { kind: string; text: string; slug: string }[]) => ({ query: "x", suggestions: s });
const CHALLAH = { kind: "listing", text: "Classic Braided Challah", slug: "classic-braided-challah" };
const BRAND = { kind: "brand", text: "Challah Corner", slug: "challah-corner" };
const CAT = { kind: "category", text: "Bakery", slug: "bakery" };

let fetchMock: ReturnType<typeof vi.fn>;
const reply = (json: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(json) } as unknown as Response);

function setup(path = "/") {
  const router = createMemoryRouter([{ path: "*", element: <SearchBox /> }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  const user = userEvent.setup({ delay: null });          // no waiting between keys: the clock is fake and the test moves it itself
  return { router, user, box: screen.getByRole("combobox", { name: "Search Solvelt" }) as HTMLInputElement };
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(SUGGEST_DELAY_MS + 5); });

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); fetchMock = vi.fn(() => reply(body([CHALLAH, BRAND, CAT]))); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("SearchBox", () => {
  it("is a plain search form with a labelled combobox, closed, pointing at its (hidden) list", () => {
    const { box } = setup();
    expect(box.closest("form")).toHaveAttribute("action", "/search");
    expect(box.closest("form")).toHaveAttribute("method", "get");
    expect(box).toHaveAttribute("name", "q");
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(box).toHaveAttribute("aria-autocomplete", "list");
    const list = document.getElementById(box.getAttribute("aria-controls")!)!;
    expect(list).toHaveAttribute("role", "listbox");
    expect(list).toHaveAttribute("hidden");
  });

  it("asks only after a pause and only for two or more characters", async () => {
    const { user, box } = setup();
    await user.type(box, "c");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.type(box, "ha");
    await act(async () => { await vi.advanceTimersByTimeAsync(SUGGEST_DELAY_MS / 3); });
    expect(fetchMock).not.toHaveBeenCalled();                                      // still inside the pause
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);                                    // one request for what was typed, not one per key
    expect(fetchMock.mock.calls[0]![0]).toBe("/search/suggest?q=cha");
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Classic Braided ChallahProduct or service", "Challah CornerBrand", "BakeryCategory"]);
  });

  it("encodes what was typed and cleans it", async () => {
    const { user, box } = setup();
    await user.type(box, "  a&b=c  d ");
    await settle();
    expect(fetchMock.mock.calls[0]![0]).toBe("/search/suggest?q=a%26b%3Dc%20d");
  });

  it("moves with Down and Up (wrapping), names the active option, and announces how many there are", async () => {
    const { user, box } = setup();
    await user.type(box, "cha");
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("3 suggestions available");
    await user.keyboard("{ArrowDown}");
    const options = screen.getAllByRole("option");
    expect(box).toHaveAttribute("aria-activedescendant", options[0]!.id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", options[0]!.id);          // wrapped round
    await user.keyboard("{ArrowUp}");
    expect(box).toHaveAttribute("aria-activedescendant", options[2]!.id);
    await user.keyboard("{Home}");
    expect(box).toHaveAttribute("aria-activedescendant", options[0]!.id);
    await user.keyboard("{End}");
    expect(box).toHaveAttribute("aria-activedescendant", options[2]!.id);
  });

  it("Enter opens the active suggestion's page: product, brand or category", async () => {
    const { user, box, router } = setup();
    await user.type(box, "cha");
    await settle();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(router.state.location.pathname).toBe("/p/classic-braided-challah");
    await user.clear(box);
    await user.type(box, "cha");
    await settle();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(router.state.location.pathname).toBe("/b/challah-corner");
    await user.clear(box);
    await user.type(box, "cha");
    await settle();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(router.state.location.pathname).toBe("/c/bakery");
    expect(box).toHaveAttribute("aria-expanded", "false");
  });

  it("Enter with nothing active is left to the form, which searches", async () => {
    const { user, box } = setup();
    await user.type(box, "cha");
    await settle();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => { box.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
  });

  it("Escape closes the list and keeps the text; the list can be reopened with Down", async () => {
    const { user, box } = setup();
    await user.type(box, "cha");
    await settle();
    await user.keyboard("{Escape}");
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(box).toHaveValue("cha");
    await user.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(box).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0]!.id);
  });

  it("a click on a suggestion goes there, and a mouse press does not take focus from the box", async () => {
    const { user, box, router } = setup();
    await user.type(box, "cha");
    await settle();
    const opt = screen.getAllByRole("option")[1]!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => { opt.dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(true);
    await user.click(opt);
    expect(router.state.location.pathname).toBe("/b/challah-corner");
  });

  it("ignores an answer for text that is no longer in the box", async () => {
    let first!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { first = r; }));
    fetchMock.mockImplementationOnce(() => reply(body([BRAND])));
    const { user, box } = setup();
    await user.type(box, "cha");
    await settle();                                                                 // request 1 is in flight
    await user.type(box, "l");
    await settle();                                                                 // request 2 answered
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await act(async () => { first({ ok: true, json: () => Promise.resolve(body([CHALLAH, BRAND, CAT])) } as unknown as Response); await Promise.resolve(); });
    expect(screen.getAllByRole("option")).toHaveLength(1);                         // the late answer did not overwrite the newer one
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal!.aborted).toBe(true);   // and the older request was cancelled
  });

  it("offers nothing, quietly, when the request fails or the answer is not what was promised", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    const { user, box } = setup();
    await user.type(box, "cha");
    await settle();
    expect(box).toHaveAttribute("aria-expanded", "false");
    fetchMock.mockImplementationOnce(() => reply(body([]), false));
    await user.type(box, "l");
    await settle();
    expect(box).toHaveAttribute("aria-expanded", "false");
    fetchMock.mockImplementationOnce(() => reply({ nope: true }));
    await user.type(box, "l");
    await settle();
    expect(box).toHaveAttribute("aria-expanded", "false");
  });

  it("drops entries it cannot use (bad kind, missing slug) and keeps the rest", async () => {
    fetchMock.mockImplementationOnce(() => reply(body([{ kind: "robot", text: "x", slug: "x" }, { kind: "brand", text: "No slug", slug: undefined as unknown as string }, CAT])));
    const { user, box } = setup();
    await user.type(box, "ba");
    await settle();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("closes when the text becomes too short, and shows no old list for it", async () => {
    const { user, box } = setup();
    await user.type(box, "cha");
    await settle();
    expect(box).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Backspace}{Backspace}");
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("listbox", { hidden: true })).toHaveAttribute("hidden");
  });

  it("on a search page the box shows what was searched and does not ask the API for it", async () => {
    const { box } = setup("/search?q=challah");
    expect(box).toHaveValue("challah");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is empty on other pages", () => {
    const { box } = setup("/p/classic-braided-challah?q=ignored");
    expect(box).toHaveValue("");
  });
});
