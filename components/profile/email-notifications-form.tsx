import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateEmailNotificationsAction } from "@/app/profile/actions";

interface EmailNotificationsFormProps {
  defaultChecked: boolean;
}

/**
 * Email-notifications toggle for the `/profile` "Account & security"
 * section. A plain server-rendered `<form>` posting to
 * `updateEmailNotificationsAction` (a simple redirect-based action, no
 * client state needed) — the `Checkbox` primitive (`components/ui/checkbox.tsx`,
 * built on `@base-ui/react/checkbox`) renders its own hidden native input for
 * form submission, so an uncontrolled `defaultChecked` + `name` works without
 * a client component (unlike `accommodation-step.tsx`'s controlled usage,
 * which needs client state for its multi-choice groups).
 */
export function EmailNotificationsForm({ defaultChecked }: EmailNotificationsFormProps) {
  return (
    <form action={updateEmailNotificationsAction} className="flex flex-col gap-md">
      <div className="flex items-start gap-xs">
        <Checkbox id="emailNotificationsEnabled" name="emailNotificationsEnabled" defaultChecked={defaultChecked} />
        <Label htmlFor="emailNotificationsEnabled" className="cursor-pointer font-normal">
          Email me about my registrations and MUN updates
        </Label>
      </div>

      <div>
        <Button type="submit" variant="outline" size="sm">
          Save preference
        </Button>
      </div>
    </form>
  );
}
