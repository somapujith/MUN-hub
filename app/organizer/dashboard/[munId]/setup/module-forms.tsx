"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SetupField, SetupSection, SetupTextarea } from "./setup-field";
import {
  addScheduleItemAction,
  addFaqAction,
  saveContactAction,
  uploadBrandingAction,
  uploadRulesAction,
  type SetupFormState,
} from "./actions";
import type { MunContact } from "@/lib/actions/mun-contact";
import type { MunMediaItem } from "@/lib/actions/mun-branding";
import type { MunDocumentItem } from "@/lib/actions/mun-documents";
import type { ScheduleItem } from "@/lib/actions/mun-schedule";
import type { InferSelectModel } from "drizzle-orm";
import type { munFaqs } from "@/lib/db/schema";

const EMPTY: SetupFormState = { status: "idle" };

type Action = (id: string, previous: SetupFormState, formData: FormData) => Promise<SetupFormState>;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}{pending ? "Saving…" : label}</Button>;
}

function FormMessage({ state }: { state: SetupFormState }) {
  if (state.status === "idle") return null;
  return <p aria-live="polite" className={state.status === "error" ? "text-body-md text-destructive-text" : "flex items-center gap-xs text-body-md text-success-text"}>
    {state.status === "success" && <CheckIcon className="size-3.5" aria-hidden />}{state.message}
  </p>;
}

function ModuleForm({ munId, action, children, label = "Save changes", encType }: { munId: string; action: Action; children: React.ReactNode; label?: string; encType?: "multipart/form-data" }) {
  const [state, formAction] = useActionState(action.bind(null, munId), EMPTY);
  return <form action={formAction} encType={encType} className="flex flex-col gap-lg" noValidate>{children}<div className="flex flex-wrap items-center justify-end gap-md border-t border-border pt-lg"><FormMessage state={state} /><Submit label={label} /></div></form>;
}

export function BrandingForm({ munId, media }: { munId: string; media: MunMediaItem[] }) {
  const logo = media.find((item) => item.kind === "LOGO");
  const cover = media.find((item) => item.kind === "COVER");
  const upload = (kind: "LOGO" | "COVER", current?: MunMediaItem) => (
    <ModuleForm munId={munId} action={uploadBrandingAction} label={current ? "Replace image" : "Upload image"} encType="multipart/form-data">
      <><input type="hidden" name="kind" value={kind} /><SetupField name="file" label={kind === "LOGO" ? "Conference logo" : "Cover image"} hint="PNG, JPEG, or WebP, up to 5 MB.">{(props) => <Input {...props} type="file" accept="image/png,image/jpeg,image/webp" />}</SetupField>{current && <img src={current.url} alt="" className="max-h-32 max-w-full rounded-sm border border-border object-contain" />}</>
    </ModuleForm>
  );
  return <div className="flex flex-col gap-xxl"><SetupSection title="Identity image" description="The logo appears beside your conference name. Keep it simple and legible at small sizes.">{upload("LOGO", logo)}</SetupSection><SetupSection title="Cover image" description="A wide image for your public conference page.">{upload("COVER", cover)}</SetupSection></div>;
}

export function RulesForm({ munId, documents }: { munId: string; documents: MunDocumentItem[] }) {
  return <SetupSection title="Rules of procedure" description="Upload the current rules document delegates should read before registering."><ModuleForm munId={munId} action={uploadRulesAction} label="Upload PDF" encType="multipart/form-data"><><SetupField name="title" label="Document title" defaultValue="Rules of procedure" /><SetupField name="file" label="PDF file" hint="PDF only, up to 20 MB.">{(props) => <Input {...props} type="file" accept="application/pdf" />}</SetupField></></ModuleForm>{documents.length > 0 && <div className="flex flex-col gap-sm">{documents.map((document) => <a key={document.id} href={document.url} target="_blank" rel="noreferrer" className="text-body-md text-primary underline">{document.title}</a>)}</div>}</SetupSection>;
}

export function ContactForm({ munId, contact }: { munId: string; contact: MunContact | null }) {
  return <ModuleForm munId={munId} action={saveContactAction}><SetupSection title="Public contact" description="Where delegates and partners can reach the conference team."><div className="grid gap-lg sm:grid-cols-2"><SetupField name="officialEmail" label="Official email" required type="email" defaultValue={contact?.officialEmail ?? ""} /><SetupField name="phone" label="Phone" defaultValue={contact?.phone ?? ""} /></div><div className="grid gap-lg sm:grid-cols-2"><SetupField name="website" label="Website" type="url" defaultValue={contact?.website ?? ""} /><SetupField name="contactPersonName" label="Contact person" required defaultValue={contact?.contactPersonName ?? ""} /></div><div className="grid gap-lg sm:grid-cols-2"><SetupField name="contactPersonRole" label="Contact person's role" defaultValue={contact?.contactPersonRole ?? ""} /><SetupField name="contactPersonEmail" label="Contact person's email" required type="email" defaultValue={contact?.contactPersonEmail ?? ""} /></div><SetupField name="contactPersonPhone" label="Contact person's phone" defaultValue={contact?.contactPersonPhone ?? ""} /></SetupSection></ModuleForm>;
}

const KIND_LABELS: Record<string, string> = { COMMITTEE_SESSION: "Committee session", OPENING_CEREMONY: "Opening ceremony", BREAK: "Break", LUNCH: "Lunch", CRISIS: "Crisis", CLOSING_CEREMONY: "Closing ceremony", AWARDS: "Awards", OTHER: "Other" };
export function ScheduleForm({ munId, items }: { munId: string; items: ScheduleItem[] }) {
  return <div className="flex flex-col gap-xxl"><SetupSection title="Add schedule item" description="Build the running order delegates will follow during the conference."><ModuleForm munId={munId} action={addScheduleItemAction} label="Add to schedule"><><SetupField name="title" label="Title" required placeholder="Committee session" /><div className="grid gap-lg sm:grid-cols-2"><SetupField name="kind" label="Type" required>{(props) => <select {...props} className="h-10 rounded-sm border border-input bg-background px-md text-body-md"><option value="COMMITTEE_SESSION">Committee session</option><option value="OPENING_CEREMONY">Opening ceremony</option><option value="BREAK">Break</option><option value="LUNCH">Lunch</option><option value="CRISIS">Crisis</option><option value="CLOSING_CEREMONY">Closing ceremony</option><option value="AWARDS">Awards</option><option value="OTHER">Other</option></select>}</SetupField><SetupField name="location" label="Location" placeholder="Room 204" /></div><div className="grid gap-lg sm:grid-cols-2"><SetupField name="startsAt" label="Starts" required type="datetime-local" /><SetupField name="endsAt" label="Ends" required type="datetime-local" /></div></></ModuleForm></SetupSection><SetupSection title="Schedule" description="Your published running order, sorted by start time."><div className="flex flex-col divide-y divide-border rounded-md border border-border">{items.length === 0 ? <p className="p-lg text-body-md text-muted-foreground">No schedule items yet.</p> : items.map((item) => <div key={item.id} className="flex items-center justify-between gap-md p-md"><div><p className="text-body-md font-medium text-ink">{item.title}</p><p className="text-body-sm text-muted-foreground">{KIND_LABELS[item.kind] ?? item.kind} · {item.startsAt.toLocaleString()}–{item.endsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{item.location ? ` · ${item.location}` : ""}</p></div><Trash2Icon aria-hidden className="size-4 text-muted-foreground" /></div>)}</div></SetupSection></div>;
}

type Faq = InferSelectModel<typeof munFaqs>;
export function FaqForm({ munId, faqs }: { munId: string; faqs: Faq[] }) {
  return <div className="flex flex-col gap-xxl"><SetupSection title="Add a FAQ" description="Answer the questions delegates ask before they register."><ModuleForm munId={munId} action={addFaqAction} label="Add FAQ"><><SetupField name="question" label="Question" required placeholder="What is included in the registration fee?" /><SetupField name="answer" label="Answer" required>{(props) => <SetupTextarea {...props} rows={5} placeholder="Explain what delegates should expect." />}</SetupField></></ModuleForm></SetupSection><SetupSection title="Published FAQs" description="These answers appear on your public conference page."><div className="flex flex-col divide-y divide-border rounded-md border border-border">{faqs.length === 0 ? <p className="p-lg text-body-md text-muted-foreground">No FAQs yet.</p> : faqs.map((faq) => <div key={faq.id} className="p-md"><p className="text-body-md font-medium text-ink">{faq.question}</p><p className="mt-xs whitespace-pre-wrap text-body-md text-muted-foreground">{faq.answer}</p></div>)}</div></SetupSection></div>;
}
