import { z } from "zod"

/** Client-side mirror of the backend name rules. The backend re-validates. */
export const entryNameSchema = z
  .string()
  .max(255, "The name is too long.")
  .refine((value) => value.trim().length > 0, "A name is required.")
  .refine((value) => value !== "." && value !== "..", "That name is reserved.")
  .refine(
    (value) => !value.includes("/") && !value.includes("\\") && !value.includes("\0"),
    "Names cannot contain path separators.",
  )

export function entryNameError(name: string): string | null {
  const result = entryNameSchema.safeParse(name)
  return result.success ? null : (result.error.issues[0]?.message ?? "That name is not valid.")
}
