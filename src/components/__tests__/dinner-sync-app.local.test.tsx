import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_AI_DRAFTS,
  DEMO_SOURCE_RECIPES,
} from "@/modules/demo";

import { DinnerSyncApp } from "../dinner-sync-app";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const STATUS_OK = {
  ok: true,
  value: { installed: true, loggedIn: true, sandboxAvailable: true },
};

const IMPORT_OK = {
  ok: true,
  value: {
    drafts: [structuredClone(DEMO_AI_DRAFTS[0])],
    provider: "openai-codex-cli",
    model: "gpt-5.6-terra",
    schemaValidated: true,
    evidenceValidated: true,
  },
};

async function fillLocalRecipe(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: /local ai/i }));
  fireEvent.change(screen.getByRole("textbox", { name: /recipe 1/i }), {
    target: { value: DEMO_SOURCE_RECIPES[0].sourceText },
  });
  await user.click(screen.getByRole("checkbox", {
    name: /send these recipes to openai/i,
  }));
}

describe("DinnerSyncApp Local AI integration", () => {
  it("deduplicates synchronous form submissions before React can rerender busy state", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = render(<DinnerSyncApp />);
    await fillLocalRecipe(user);
    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("preflights a disabled server without sending recipe text", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn<typeof fetch>(async () => jsonResponse({
      ok: false,
      error: { code: "LOCAL_AI_DISABLED", message: "private server detail" },
    }, 404));
    vi.stubGlobal("fetch", fetchSpy);
    render(<DinnerSyncApp />);
    await fillLocalRecipe(user);

    await user.click(screen.getByRole("button", { name: /build my service plan/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /not enabled on this server.*recipe was not sent/i,
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/local-ai/status");
    expect(init).toMatchObject({ method: "POST" });
    expect(init?.body).toBeUndefined();
    expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain(
      DEMO_SOURCE_RECIPES[0].sourceText,
    );
    expect(screen.getByRole("textbox", { name: /recipe 1/i }))
      .toHaveValue(DEMO_SOURCE_RECIPES[0].sourceText);
    expect(screen.getByRole("heading", { name: /set the table/i })).toBeInTheDocument();
  });

  it("enters Local review only after status and import both verify", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse(STATUS_OK))
      .mockResolvedValueOnce(jsonResponse(IMPORT_OK));
    vi.stubGlobal("fetch", fetchSpy);
    render(<DinnerSyncApp />);
    await fillLocalRecipe(user);

    await user.click(screen.getByRole("button", { name: /build my service plan/i }));

    expect(await screen.findByRole("heading", {
      name: /review every field before the clock starts/i,
    })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/local-ai/status");
    expect(fetchSpy.mock.calls[1][0]).toBe("/api/local-ai/import");
    expect(JSON.parse(String(fetchSpy.mock.calls[1][1]?.body))).toEqual({
      consent: true,
      model: "gpt-5.6-terra",
      recipes: [DEMO_SOURCE_RECIPES[0].sourceText],
    });
    expect(screen.getByText(/openai-codex-cli/i)).toBeInTheDocument();
    expect(screen.getByText(/gpt-5\.6-terra/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build the service timeline/i }))
      .toBeDisabled();
  });

  it("ignores a late import after switching back to Hosted", async () => {
    const user = userEvent.setup();
    let resolveImport!: (response: Response) => void;
    const importResponse = new Promise<Response>((resolve) => {
      resolveImport = resolve;
    });
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse(STATUS_OK))
      .mockImplementationOnce(() => importResponse);
    vi.stubGlobal("fetch", fetchSpy);
    render(<DinnerSyncApp />);
    await fillLocalRecipe(user);
    await user.click(screen.getByRole("button", { name: /build my service plan/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("radio", { name: /hosted demo/i }));
    resolveImport(jsonResponse(IMPORT_OK));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /hosted demo/i })).toBeChecked();
      expect(screen.getByRole("heading", { name: /set the table/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", {
      name: /review every field before the clock starts/i,
    })).not.toBeInTheDocument();
  });

  it("aborts an in-flight status request when the app unmounts", async () => {
    const user = userEvent.setup();
    let capturedSignal: AbortSignal | undefined;
    const fetchSpy = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const view = render(<DinnerSyncApp />);
    await fillLocalRecipe(user);
    await user.click(screen.getByRole("button", { name: /build my service plan/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());

    view.unmount();

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
