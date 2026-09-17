import { useId, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { ArrowDown, ArrowUp, Camera, Edit3, Plus, Trash2, UsersRound } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import {
  createExecutiveBoardMember,
  deleteExecutiveBoardMember,
  listCommitteesForExecutiveBoard,
  listExecutiveBoardMembers,
  removeExecutiveBoardPhoto,
  updateExecutiveBoardMember,
  uploadExecutiveBoardPhoto,
} from "@/api/executive-board";
import { readFileAsBase64 } from "@/lib/read-file-as-base64";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type {
  ExecutiveBoardMember,
  ExecutiveBoardMemberInput,
  ExecutiveBoardRole,
} from "@/types/executive-board";

const ROLE_OPTIONS: Array<{ value: ExecutiveBoardRole; label: string }> = [
  { value: "CHAIR", label: "Chair" },
  { value: "VICE_CHAIR", label: "Vice chair" },
  { value: "DIRECTOR", label: "Director" },
  { value: "RAPPORTEUR", label: "Rapporteur" },
  { value: "CUSTOM", label: "Custom role" },
];

const EMPTY_FORM: ExecutiveBoardMemberInput = {
  committeeId: null,
  name: "",
  role: "CHAIR",
  customRole: null,
  photoUrl: null,
  bio: null,
  institution: null,
  organization: null,
  socialLinks: null,
  isPublic: true,
  displayOrder: 0,
};

type PhotoType = "image/png" | "image/jpeg" | "image/webp";
const PHOTO_TYPES: readonly PhotoType[] = ["image/png", "image/jpeg", "image/webp"];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Client-side check; the API also verifies the file's contents. */
function photoProblem(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type as PhotoType)) return "Use a PNG, JPEG or WebP image";
  if (file.size > PHOTO_MAX_BYTES) return "Photos must be 5MB or smaller";
  return null;
}

async function photoPayload(file: File) {
  return { contentType: file.type as PhotoType, fileBase64: await readFileAsBase64(file) };
}

/**
 * Photo upload for a board member. Editing: uploads or removes right away.
 * Adding: holds the file until the member is created.
 */
function MemberPhotoField({
  member,
  pendingFile,
  onPendingFile,
  onChanged,
}: {
  member: ExecutiveBoardMember | null;
  pendingFile: File | null;
  onPendingFile: (file: File | null) => void;
  onChanged: (member: ExecutiveBoardMember) => Promise<void>;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => uploadExecutiveBoardPhoto(member!.id, await photoPayload(file)),
    onSuccess: async (updated) => {
      await onChanged(updated);
      toast.success("Photo updated");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to upload photo"),
    onSettled: () => {
      if (inputRef.current) inputRef.current.value = "";
    },
  });
  const remove = useMutation({
    mutationFn: () => removeExecutiveBoardPhoto(member!.id),
    onSuccess: async (updated) => {
      await onChanged(updated);
      toast.success("Photo removed");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to remove photo"),
  });

  const shown = member ? member.photoUrl : previewUrl;
  const busy = upload.isPending || remove.isPending;

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      toast.error(problem);
      event.target.value = "";
      return;
    }
    if (member) {
      upload.mutate(file);
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    onPendingFile(file);
  };

  const clearPending = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    onPendingFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-xs">
      <Label htmlFor={inputId}>Photo (optional)</Label>
      <div className="flex items-center gap-sm">
        {shown ? (
          <img src={shown} alt="" className="size-14 shrink-0 rounded-full border border-border object-cover" />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-surface-soft text-muted-foreground">
            <Camera className="size-5" aria-hidden />
          </div>
        )}
        <input id={inputId} ref={inputRef} type="file" accept={PHOTO_TYPES.join(",")} className="sr-only" onChange={pick} disabled={busy} />
        <div className="flex flex-wrap gap-xxs">
          <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
            {upload.isPending ? "Uploading..." : shown || pendingFile ? "Change photo" : "Upload photo"}
          </Button>
          {member?.photoUrl && (
            <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => remove.mutate()}>
              Remove
            </Button>
          )}
          {!member && pendingFile && (
            <Button type="button" size="xs" variant="ghost" onClick={clearPending}>
              Remove
            </Button>
          )}
        </div>
      </div>
      <p className="text-caption text-muted-foreground">A square headshot works best. PNG, JPEG or WebP, max 5MB.</p>
    </div>
  );
}

function toForm(member: ExecutiveBoardMember): ExecutiveBoardMemberInput {
  return {
    committeeId: member.committeeId,
    name: member.name,
    role: member.role,
    customRole: member.customRole,
    photoUrl: member.photoUrl,
    bio: member.bio,
    institution: member.institution,
    organization: member.organization,
    socialLinks: member.socialLinks,
    isPublic: member.isPublic ?? true,
    displayOrder: member.displayOrder,
  };
}

export function OrganizerExecutiveBoardPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ExecutiveBoardMember | null>(null);
  const [form, setForm] = useState<ExecutiveBoardMemberInput>(EMPTY_FORM);
  const [isFormOpen, setIsFormOpen] = useState(false);
  // A photo picked while adding a member; uploaded once the member exists.
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const membersQuery = useQuery({
    queryKey: queryKeys.executiveBoard(munId),
    queryFn: () => listExecutiveBoardMembers(munId),
    enabled: Boolean(munId),
  });
  const committeesQuery = useQuery({
    queryKey: queryKeys.committees(munId),
    queryFn: () => listCommitteesForExecutiveBoard(munId),
    enabled: Boolean(munId),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.executiveBoard(munId) });
  const saveMutation = useMutation({
    mutationFn: async () => {
      // The photo is saved on its own (MemberPhotoField), so a stale form
      // value never overwrites a photo uploaded while the form was open.
      const { photoUrl: _photoUrl, ...fields } = form;
      if (editing) return updateExecutiveBoardMember(editing.id, fields);
      const created = await createExecutiveBoardMember(munId, fields);
      if (pendingPhoto) {
        try {
          await uploadExecutiveBoardPhoto(created.id, await photoPayload(pendingPhoto));
        } catch (error) {
          toast.error(`Member added, but the photo didn't upload: ${error instanceof Error ? error.message : "try again"}`);
        }
      }
      return created;
    },
    onSuccess: async () => {
      await refresh();
      setIsFormOpen(false);
      setPendingPhoto(null);
      setEditing(null);
      toast.success(editing ? "Board member updated" : "Board member added");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save member"),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteExecutiveBoardMember,
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to delete member"),
  });
  const members = [...(membersQuery.data ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);
  const openCreate = () => {
    setEditing(null);
    setPendingPhoto(null);
    setForm({ ...EMPTY_FORM, displayOrder: members.length });
    setIsFormOpen(true);
  };
  const openEdit = (member: ExecutiveBoardMember) => {
    setEditing(member);
    setPendingPhoto(null);
    setForm(toForm(member));
    setIsFormOpen(true);
  };
  const move = (member: ExecutiveBoardMember, direction: -1 | 1) => {
    const other = members[members.indexOf(member) + direction];
    if (!other) return;
    updateExecutiveBoardMember(member.id, { ...toForm(member), displayOrder: other.displayOrder })
      .then(() => updateExecutiveBoardMember(other.id, { ...toForm(other), displayOrder: member.displayOrder }))
      .then(refresh)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to reorder members"));
  };

  return (
    <>
      <Helmet title="Executive Board" />
      <WorkspacePage title="Executive Board" description="Build the public-facing secretariat and chair roster for this conference." actions={<Button size="sm" onClick={openCreate}><Plus aria-hidden /> Add member</Button>}>
        <div className="grid gap-lg xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Executive board members" className="flex flex-col gap-md">
            {membersQuery.isLoading && <p className="text-body-md text-muted-foreground">Loading board members...</p>}
            {membersQuery.isError && <p className="text-body-md text-destructive">{membersQuery.error.message}</p>}
            {!membersQuery.isLoading && members.length === 0 && <div className="rounded-md border border-dashed border-border px-lg py-xl text-center"><UsersRound className="mx-auto size-8 text-muted-foreground" aria-hidden /><h2 className="mt-md font-display text-title-sm text-ink">No board members yet</h2><p className="mt-xs text-body-md text-muted-foreground">Add the people delegates should see on the conference team.</p><Button className="mt-lg" size="sm" onClick={openCreate}><Plus aria-hidden /> Add first member</Button></div>}
            {members.map((member, index) => {
              const committee = committeesQuery.data?.find((item) => item.id === member.committeeId);
              const role = member.role === "CUSTOM" ? member.customRole : ROLE_OPTIONS.find((item) => item.value === member.role)?.label;
              return <Card key={member.id} size="sm"><CardContent className="flex flex-wrap items-start gap-md">
                {member.photoUrl ? <img src={member.photoUrl} alt="" className="size-16 rounded-full object-cover" /> : <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-surface-soft text-title-sm text-muted-foreground">{member.name.charAt(0).toUpperCase()}</div>}
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-sm gap-y-xxs"><h2 className="font-display text-title-sm text-ink">{member.name}</h2>{member.isPublic === false && <span className="text-caption text-muted-foreground">Hidden</span>}</div><p className="mt-xxs text-body-md text-body">{role}{committee ? ` · ${committee.name}` : " · Conference-wide"}</p>{member.institution && <p className="mt-xs text-body-md text-muted-foreground">{member.institution}</p>}{member.bio && <p className="mt-sm max-w-2xl whitespace-pre-wrap text-body-md leading-relaxed text-body">{member.bio}</p>}{member.socialLinks && Object.keys(member.socialLinks).length > 0 && <p className="mt-sm text-caption text-link">{Object.entries(member.socialLinks).map(([network, link]) => `${network}: ${link}`).join(" · ")}</p>}</div>
                <div className="flex items-center gap-xxs"><Button variant="ghost" size="icon-xs" aria-label="Move member up" disabled={index === 0} onClick={() => move(member, -1)}><ArrowUp aria-hidden /></Button><Button variant="ghost" size="icon-xs" aria-label="Move member down" disabled={index === members.length - 1} onClick={() => move(member, 1)}><ArrowDown aria-hidden /></Button><Button variant="ghost" size="icon-xs" aria-label={`Edit ${member.name}`} onClick={() => openEdit(member)}><Edit3 aria-hidden /></Button><Button variant="ghost" size="icon-xs" aria-label={`Delete ${member.name}`} onClick={() => { if (window.confirm(`Delete ${member.name}?`)) deleteMutation.mutate(member.id); }}><Trash2 aria-hidden /></Button></div>
              </CardContent></Card>;
            })}
          </section>
          {isFormOpen && <Card className="h-fit"><CardHeader><CardTitle>{editing ? "Edit board member" : "Add board member"}</CardTitle></CardHeader><CardContent><form className="flex flex-col gap-md" onSubmit={(event) => { event.preventDefault(); if (!form.name.trim() || (form.role === "CUSTOM" && !form.customRole?.trim())) { toast.error("Name and custom role are required"); return; } saveMutation.mutate(); }}>
            <div className="flex flex-col gap-xs"><Label htmlFor="eb-name">Name</Label><Input id="eb-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></div>
            <div className="flex flex-col gap-xs"><Label htmlFor="eb-role">Role</Label><select id="eb-role" className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as ExecutiveBoardRole })}>{ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></div>
            {form.role === "CUSTOM" && <div className="flex flex-col gap-xs"><Label htmlFor="eb-custom-role">Custom role</Label><Input id="eb-custom-role" value={form.customRole ?? ""} onChange={(event) => setForm({ ...form, customRole: event.target.value })} /></div>}
            <div className="flex flex-col gap-xs"><Label htmlFor="eb-committee">Committee assignment</Label><select id="eb-committee" className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink" value={form.committeeId ?? ""} onChange={(event) => setForm({ ...form, committeeId: event.target.value || null })}><option value="">Conference-wide</option>{(committeesQuery.data ?? []).map((committee) => <option key={committee.id} value={committee.id}>{committee.name}</option>)}</select></div>
            <MemberPhotoField member={editing} pendingFile={pendingPhoto} onPendingFile={setPendingPhoto} onChanged={async (updated) => { setEditing(updated); await refresh(); }} />
            <div className="flex flex-col gap-xs"><Label htmlFor="eb-institution">Institution</Label><Input id="eb-institution" value={form.institution ?? ""} onChange={(event) => setForm({ ...form, institution: event.target.value || null })} /></div>
            <div className="flex flex-col gap-xs"><Label htmlFor="eb-organization">Organization</Label><Input id="eb-organization" value={form.organization ?? ""} onChange={(event) => setForm({ ...form, organization: event.target.value || null })} /></div>
            <div className="flex flex-col gap-xs"><Label htmlFor="eb-social-links">Website or social link</Label><Input id="eb-social-links" type="url" value={form.socialLinks?.website ?? ""} onChange={(event) => setForm({ ...form, socialLinks: event.target.value ? { website: event.target.value } : null })} /></div>
            <div className="flex flex-col gap-xs"><Label htmlFor="eb-bio">Bio</Label><textarea id="eb-bio" className="min-h-28 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25" value={form.bio ?? ""} onChange={(event) => setForm({ ...form, bio: event.target.value || null })} /></div>
            <label className="flex items-center gap-sm text-body-md text-body"><input type="checkbox" checked={form.isPublic !== false} onChange={(event) => setForm({ ...form, isPublic: event.target.checked })} /> Show this member on the public conference page</label>
            <div className="flex justify-end gap-xs"><Button type="button" variant="outline" size="sm" onClick={() => setIsFormOpen(false)}>Cancel</Button><Button type="submit" size="sm" disabled={saveMutation.isPending}>{saveMutation.isPending ? "Saving..." : editing ? "Save changes" : "Add member"}</Button></div>
          </form></CardContent></Card>}
        </div>
      </WorkspacePage>
    </>
  );
}
