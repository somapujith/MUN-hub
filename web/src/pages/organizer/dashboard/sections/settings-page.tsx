import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Save } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { getMunContact, upsertMunContact } from "@/api/mun-contact";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type { UpsertMunContactInput } from "@/types/mun-contact";

const EMPTY_FORM: UpsertMunContactInput = {
  officialEmail: "",
  phone: "",
  website: "",
  socialLinks: null,
  contactPersonName: "",
  contactPersonRole: "",
  contactPersonEmail: "",
  contactPersonPhone: "",
};

export function OrganizerSettingsPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<UpsertMunContactInput>(EMPTY_FORM);

  const contactQuery = useQuery({
    queryKey: queryKeys.munContact(munId),
    queryFn: () => getMunContact(munId),
    enabled: Boolean(munId),
  });

  useEffect(() => {
    const contact = contactQuery.data;
    if (!contact) return;
    setForm({
      officialEmail: contact.officialEmail,
      phone: contact.phone ?? "",
      website: contact.website ?? "",
      socialLinks: contact.socialLinks,
      contactPersonName: contact.contactPersonName,
      contactPersonRole: contact.contactPersonRole ?? "",
      contactPersonEmail: contact.contactPersonEmail,
      contactPersonPhone: contact.contactPersonPhone ?? "",
    });
  }, [contactQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertMunContact(munId, {
        ...form,
        phone: form.phone || null,
        website: form.website || null,
        contactPersonRole: form.contactPersonRole || null,
        contactPersonPhone: form.contactPersonPhone || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.munContact(munId) });
      toast.success("Contact info saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save contact info"),
  });

  const socialLink = (form.socialLinks && Object.values(form.socialLinks)[0]) ?? "";

  return (
    <>
      <Helmet title="Settings" />
      <WorkspacePage
        title="Settings"
        description="Official contact details shown to delegates and MUNHub reviewers."
      >
        {contactQuery.isLoading ? (
          <Skeleton className="h-[420px] w-full max-w-2xl rounded-md" />
        ) : contactQuery.isError ? (
          <p className="text-body-md text-destructive">{contactQuery.error.message}</p>
        ) : (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Conference contact</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-md"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    !form.officialEmail.trim() ||
                    !form.contactPersonName.trim() ||
                    !form.contactPersonEmail.trim()
                  ) {
                    toast.error("Official email, contact name, and contact email are required");
                    return;
                  }
                  saveMutation.mutate();
                }}
              >
                <div className="grid gap-md sm:grid-cols-2">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-official-email">Official email</Label>
                    <Input
                      id="contact-official-email"
                      type="email"
                      value={form.officialEmail}
                      onChange={(event) => setForm({ ...form, officialEmail: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-phone">Phone</Label>
                    <Input
                      id="contact-phone"
                      type="tel"
                      value={form.phone ?? ""}
                      onChange={(event) => setForm({ ...form, phone: event.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-md sm:grid-cols-2">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-website">Website</Label>
                    <Input
                      id="contact-website"
                      type="url"
                      value={form.website ?? ""}
                      onChange={(event) => setForm({ ...form, website: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-social">Social link</Label>
                    <Input
                      id="contact-social"
                      type="url"
                      value={socialLink}
                      onChange={(event) =>
                        setForm({ ...form, socialLinks: event.target.value ? { primary: event.target.value } : null })
                      }
                    />
                  </div>
                </div>
                <hr className="border-border" />
                <div className="grid gap-md sm:grid-cols-2">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-person-name">Contact person</Label>
                    <Input
                      id="contact-person-name"
                      value={form.contactPersonName}
                      onChange={(event) => setForm({ ...form, contactPersonName: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-person-role">Role</Label>
                    <Input
                      id="contact-person-role"
                      value={form.contactPersonRole ?? ""}
                      onChange={(event) => setForm({ ...form, contactPersonRole: event.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-md sm:grid-cols-2">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-person-email">Contact email</Label>
                    <Input
                      id="contact-person-email"
                      type="email"
                      value={form.contactPersonEmail}
                      onChange={(event) => setForm({ ...form, contactPersonEmail: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-person-phone">Contact phone</Label>
                    <Input
                      id="contact-person-phone"
                      type="tel"
                      value={form.contactPersonPhone ?? ""}
                      onChange={(event) => setForm({ ...form, contactPersonPhone: event.target.value })}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                    <Save aria-hidden />
                    {saveMutation.isPending ? "Saving..." : "Save contact info"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </WorkspacePage>
    </>
  );
}
