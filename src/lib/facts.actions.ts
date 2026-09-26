"use server";

/**
 * The fact sheet's writes (build 2b, idea 3). Owner only: a fact sheet is what
 * scripts are told to say as-is, so it is the owner's word, not a shared note.
 *
 * Errors come back as dictionary keys so the form can show them in the
 * viewer's language; `detail` carries the bridge's validation message, which
 * is English only.
 */

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import { getBrand } from "@/lib/bridge/brands";
import {
  createFact,
  deleteFact,
  InvalidFactError,
  markFactChecked,
  updateFact,
  type FactInput,
} from "@/lib/bridge/facts";
import type { TranslationKey } from "@/lib/i18n";

export type FactActionResult = { ok: true } | { ok: false; error: TranslationKey; detail?: string };

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function fromForm(formData: FormData): FactInput {
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    topic: field("topic"),
    claim: field("claim"),
    sourceUrl: field("sourceUrl"),
    notes: field("notes"),
  };
}

/** Runs `write` for the owner; turns the two expected refusals into results. */
async function asOwner(write: () => Promise<FactActionResult>): Promise<FactActionResult> {
  try {
    await requireOwner("edit the fact sheet");
    const result = await write();
    if (result.ok) revalidatePath("/facts");
    return result;
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "facts.error.owner" };
    if (err instanceof InvalidFactError)
      return { ok: false, error: "facts.error.invalid", detail: err.message };
    throw err;
  }
}

/** Add a fact to a brand's sheet. `useActionState` shape: (bound brand, previous state, form). */
export async function createFactAction(
  brandId: string,
  _prev: FactActionResult | null,
  formData: FormData,
): Promise<FactActionResult> {
  return asOwner(async () => {
    if (typeof brandId !== "string" || !(await getBrand(brandId)))
      return { ok: false, error: "facts.error.brand" };
    await createFact(brandId, fromForm(formData));
    return { ok: true };
  });
}

/** Edit a fact. A new claim or source bumps `updatedAt`, which can flag posted scripts. */
export async function updateFactAction(
  id: number,
  _prev: FactActionResult | null,
  formData: FormData,
): Promise<FactActionResult> {
  return asOwner(async () => {
    if (!isPositiveId(id)) return { ok: false, error: "facts.error.missing" };
    return (await updateFact(id, fromForm(formData)))
      ? { ok: true }
      : { ok: false, error: "facts.error.missing" };
  });
}

/** "Checked today". */
export async function markFactCheckedAction(id: number): Promise<FactActionResult> {
  return asOwner(async () => {
    if (!isPositiveId(id)) return { ok: false, error: "facts.error.missing" };
    return (await markFactChecked(id)) ? { ok: true } : { ok: false, error: "facts.error.missing" };
  });
}

export async function deleteFactAction(id: number): Promise<FactActionResult> {
  return asOwner(async () => {
    if (!isPositiveId(id)) return { ok: false, error: "facts.error.missing" };
    return (await deleteFact(id)) ? { ok: true } : { ok: false, error: "facts.error.missing" };
  });
}
