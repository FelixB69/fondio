// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hasSeenOnboarding, OnboardingTour } from "./OnboardingTour";

const STORAGE_KEY = "fondio_onboarding_seen";

beforeEach(() => window.localStorage.removeItem(STORAGE_KEY));
afterEach(() => window.localStorage.removeItem(STORAGE_KEY));

describe("hasSeenOnboarding", () => {
  it("faux quand rien n'est stocké", () => {
    expect(hasSeenOnboarding()).toBe(false);
  });

  it("vrai quand le flag est posé", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    expect(hasSeenOnboarding()).toBe(true);
  });
});

describe("OnboardingTour", () => {
  it("démarre à la première étape, sans bouton Retour", () => {
    render(<OnboardingTour onDone={() => {}} />);
    expect(screen.getByText("1. Choisissez un projet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retour" })).not.toBeInTheDocument();
  });

  it("avance et recule dans les étapes", async () => {
    render(<OnboardingTour onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Suivant/ }));
    expect(screen.getByText("2. Sélectionnez un agent")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retour" }));
    expect(screen.getByText("1. Choisissez un projet")).toBeInTheDocument();
  });

  it("à la dernière étape, « Commencer » termine et mémorise la visite", async () => {
    const onDone = vi.fn();
    render(<OnboardingTour onDone={onDone} />);
    // 4 étapes : 3 clics « Suivant » pour atteindre la dernière.
    for (let i = 0; i < 3; i++) {
      await userEvent.click(screen.getByRole("button", { name: /Suivant/ }));
    }
    await userEvent.click(screen.getByRole("button", { name: /Commencer/ }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(hasSeenOnboarding()).toBe(true);
  });

  it("le bouton fermer passe la visite et la mémorise", async () => {
    const onDone = vi.fn();
    render(<OnboardingTour onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Passer la visite guidée" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(hasSeenOnboarding()).toBe(true);
  });
});
