import { toast } from "sonner"
import { errorMessage } from "@/lib/errors"

/** Copy text and report the outcome, without exposing the value in errors. */
export function copyText(value: string, success: string): Promise<void> {
  return navigator.clipboard.writeText(value).then(
    () => {
      toast.success(success)
    },
    (error) => {
      toast.error("Could not copy to the clipboard", { description: errorMessage(error) })
    },
  )
}
