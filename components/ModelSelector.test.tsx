// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelSelector } from "./ModelSelector";
import { prettyModelName, type ModelStatus } from "@/lib/models";

function makeStatus(over: Partial<ModelStatus> = {}): ModelStatus {
  return {
    available: true,
    local: { chat: "llama3.1", artifact: "qwen2.5-coder:7b", tool: "llama3.1" },
    cloud: { chat: "mistral-large-latest", artifact: "mistral-large-latest", configured: true },
    byok: null,
    ...over,
  };
}

const noop = () => {};

describe("ModelSelector — bouton actif", () => {
  it("affiche « Vérification… » tant que le statut est inconnu", () => {
    render(
      <ModelSelector status={null} provider="local" onChange={noop} onRefresh={noop} />,
    );
    expect(screen.getByTitle("Voir / changer le modèle IA")).toHaveTextContent("Vérification…");
  });

  it("affiche le modèle local quand Ollama est joignable", () => {
    const status = makeStatus({ available: true });
    render(
      <ModelSelector status={status} provider="local" onChange={noop} onRefresh={noop} />,
    );
    expect(screen.getByTitle("Voir / changer le modèle IA")).toHaveTextContent(
      prettyModelName(status.local.chat),
    );
  });

  it("prévient quand Local est choisi mais Ollama est indisponible", () => {
    render(
      <ModelSelector
        status={makeStatus({ available: false })}
        provider="local"
        onChange={noop}
        onRefresh={noop}
      />,
    );
    expect(screen.getByTitle("Voir / changer le modèle IA")).toHaveTextContent("Local indispo");
  });
});

describe("ModelSelector — popover", () => {
  it("ouvre le popover et propose local + cloud", async () => {
    render(
      <ModelSelector status={makeStatus()} provider="local" onChange={noop} onRefresh={noop} />,
    );
    await userEvent.click(screen.getByTitle("Voir / changer le modèle IA"));
    expect(screen.getByText("Quelle IA vous répond")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Modèle local/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mistral Cloud/ })).toBeInTheDocument();
  });

  it("choisir Local alors qu'Ollama est down déclenche un re-check, pas un changement", async () => {
    const onChange = vi.fn();
    const onRefresh = vi.fn();
    render(
      <ModelSelector
        status={makeStatus({ available: false })}
        provider="cloud"
        onChange={onChange}
        onRefresh={onRefresh}
      />,
    );
    await userEvent.click(screen.getByTitle("Voir / changer le modèle IA"));
    await userEvent.click(screen.getByRole("button", { name: /Modèle local/ }));
    expect(onRefresh).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("choisir Cloud (configuré) bascule le provider", async () => {
    const onChange = vi.fn();
    render(
      <ModelSelector
        status={makeStatus({ cloud: { chat: "m", artifact: "m", configured: true } })}
        provider="local"
        onChange={onChange}
        onRefresh={noop}
      />,
    );
    await userEvent.click(screen.getByTitle("Voir / changer le modèle IA"));
    await userEvent.click(screen.getByRole("button", { name: /Mistral Cloud/ }));
    expect(onChange).toHaveBeenCalledWith("cloud");
  });

  it("Cloud non configuré et sans clé BYOK est inerte", async () => {
    const onChange = vi.fn();
    render(
      <ModelSelector
        status={makeStatus({ cloud: { chat: "m", artifact: "m", configured: false }, byok: null })}
        provider="local"
        onChange={onChange}
        onRefresh={noop}
      />,
    );
    await userEvent.click(screen.getByTitle("Voir / changer le modèle IA"));
    await userEvent.click(screen.getByRole("button", { name: /Mistral Cloud/ }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
