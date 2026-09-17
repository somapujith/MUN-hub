import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2Icon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { getOrganizerOnboarding, MAX_ORGANIZATION_LENGTH, updateOrganization } from "@/api/organizer-onboarding";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Hosted by" on the dashboard: the organization delegates see on every public
 * MUN page, editable in place. Without one, delegates see the organizer's name.
 */
export function HostNameCard() {
  const queryClient = useQueryClient();
  const inputId = useId();
  const onboardingQuery = useQuery({ queryKey: queryKeys.organizerOnboarding(), queryFn: getOrganizerOnboarding });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const save = useMutation({
    mutationFn: () => updateOrganization(value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.organizerOnboarding() });
      setEditing(false);
      toast.success("Host name saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save the host name"),
  });

  const profile = onboardingQuery.data?.profile;
  if (!profile) return null;
  const personName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const shown = profile.organization ?? personName;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <section
      aria-labelledby="host-name-heading"
      className="flex flex-wrap items-center gap-sm rounded-md border border-border bg-card p-md"
      data-testid="host-name-card"
    >
      <Building2Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      {editing ? (
        <form onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-end gap-xs">
          <div className="flex min-w-56 flex-1 flex-col gap-xxs">
            <Label htmlFor={inputId} id="host-name-heading">
              Organizing body
            </Label>
            <Input
              id={inputId}
              value={value}
              maxLength={MAX_ORGANIZATION_LENGTH}
              placeholder="School, college or society"
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
          </div>
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <h2 id="host-name-heading" className="text-caption text-muted-foreground">
              Delegates see your MUNs as hosted by
            </h2>
            <p className="truncate text-body-md font-medium text-ink">{shown || "Your name"}</p>
            {!profile.organization && (
              <p className="text-caption text-muted-foreground">
                Add your school, college or society so delegates know who is hosting.
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setValue(profile.organization ?? "");
              setEditing(true);
            }}
          >
            <PencilIcon aria-hidden />
            {profile.organization ? "Edit" : "Add organization"}
          </Button>
        </>
      )}
    </section>
  );
}
