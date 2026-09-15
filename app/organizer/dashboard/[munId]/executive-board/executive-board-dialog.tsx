"use client";

import * as React from "react";
import { CheckIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";
import { createExecutiveBoardAction, updateExecutiveBoardAction, type ExecutiveBoardFormValues } from "./actions";
import type { ExecutiveBoardRow } from "./queries";
import type { Committee } from "@/lib/types";
import { fieldClassName, FieldHint } from "../committees/form-field";

const selectClassName = "h-11 w-full cursor-pointer appearance-none rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 dark:bg-card";

export function ExecutiveBoardDialog({
  munId, member, committees, open, onOpenChange,
}: { munId: string; member?: ExecutiveBoardRow; committees: Committee[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const isEdit = member !== undefined;

  function handleSubmit(formData: FormData) {
    const values: ExecutiveBoardFormValues = {
      name: String(formData.get("name") ?? ""),
      role: String(formData.get("role") ?? "CHAIR") as ExecutiveBoardFormValues["role"],
      customRole: String(formData.get("customRole") ?? ""),
      committeeId: String(formData.get("committeeId") ?? ""),
      photoUrl: String(formData.get("photoUrl") ?? ""),
      bio: String(formData.get("bio") ?? ""),
      institution: String(formData.get("institution") ?? ""),
      organization: String(formData.get("organization") ?? ""),
      socialLinks: String(formData.get("socialLinks") ?? ""),
      isPublic: formData.get("isPublic") === "on",
      displayOrder: Number(formData.get("displayOrder") ?? 0),
    };
    setError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateExecutiveBoardAction(munId, member.id, values)
        : await createExecutiveBoardAction(munId, values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      toast.success(isEdit ? `${result.data.name} updated` : `${result.data.name} added`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${member.name}` : "New board member"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update the details shown on the public conference page." : "Add a chair, director or other executive board member."}</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-md">
          <div className="grid gap-md sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-xs"><Label htmlFor="eb-name">Name</Label><Input id="eb-name" name="name" required maxLength={200} defaultValue={member?.name ?? ""} disabled={pending} placeholder="Aarav Mehta" /></div>
            <div className="flex flex-col gap-xs sm:w-32"><Label htmlFor="eb-order">Order</Label><Input id="eb-order" name="displayOrder" type="number" min={0} step={1} defaultValue={member?.displayOrder ?? 0} disabled={pending} /></div>
          </div>
          <div className="grid gap-md sm:grid-cols-2">
            <div className="flex flex-col gap-xs"><Label htmlFor="eb-role">Role</Label><select id="eb-role" name="role" className={selectClassName} defaultValue={member?.role ?? "CHAIR"} disabled={pending}><option value="CHAIR">Chair</option><option value="VICE_CHAIR">Vice-chair</option><option value="DIRECTOR">Director</option><option value="RAPPORTEUR">Rapporteur</option><option value="CUSTOM">Custom</option></select></div>
            <div className="flex flex-col gap-xs"><Label htmlFor="eb-custom-role">Custom role</Label><Input id="eb-custom-role" name="customRole" maxLength={120} defaultValue={member?.customRole ?? ""} disabled={pending} placeholder="Secretary-General" /><FieldHint>Required when role is Custom.</FieldHint></div>
          </div>
          <div className="flex flex-col gap-xs"><Label htmlFor="eb-committee">Committee</Label><select id="eb-committee" name="committeeId" className={selectClassName} defaultValue={member?.committeeId ?? ""} disabled={pending}><option value="">All conference</option>{committees.map((committee) => <option key={committee.id} value={committee.id}>{committee.name}</option>)}</select></div>
          <div className="flex flex-col gap-xs"><Label htmlFor="eb-photo">Photo URL</Label><Input id="eb-photo" name="photoUrl" type="url" maxLength={2000} defaultValue={member?.photoUrl ?? ""} disabled={pending} placeholder="https://..." /></div>
          <div className="grid gap-md sm:grid-cols-2"><div className="flex flex-col gap-xs"><Label htmlFor="eb-institution">Institution</Label><Input id="eb-institution" name="institution" defaultValue={member?.institution ?? ""} disabled={pending} placeholder="School or university" /></div><div className="flex flex-col gap-xs"><Label htmlFor="eb-organization">Organization</Label><Input id="eb-organization" name="organization" defaultValue={member?.organization ?? ""} disabled={pending} placeholder="MUN society or organization" /></div></div>
          <div className="flex flex-col gap-xs"><Label htmlFor="eb-social-links">Website or social link</Label><Input id="eb-social-links" name="socialLinks" type="url" defaultValue={member?.socialLinks?.website ?? ""} disabled={pending} placeholder="https://..." /></div>
          <div className="flex flex-col gap-xs"><Label htmlFor="eb-bio">Bio</Label><textarea id="eb-bio" name="bio" rows={4} maxLength={2000} className={cn(fieldClassName, "resize-y")} defaultValue={member?.bio ?? ""} disabled={pending} placeholder="A short introduction for delegates." /></div>
          <label className="flex items-center gap-sm text-body-md text-body"><input name="isPublic" type="checkbox" defaultChecked={member?.isPublic !== false} disabled={pending} /> Show this member on the public conference page</label>
          {error && <p role="alert" className="rounded-sm border border-destructive/30 bg-destructive/8 px-sm py-xs text-body-md text-destructive-text">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" size="sm" disabled={pending}>{pending ? <Loader2Icon className="animate-spin" aria-hidden /> : isEdit ? <CheckIcon aria-hidden /> : <PlusIcon aria-hidden />}{pending ? "Saving…" : isEdit ? "Save changes" : "Add board member"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}