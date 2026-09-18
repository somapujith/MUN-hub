import type { ReactNode } from "react";
import { AccommodationList } from "@/components/mun/accommodation-list";
import { CommitteeList } from "@/components/mun/committee-list";
import { DocumentList } from "@/components/mun/document-list";
import { ExecutiveBoardList } from "@/components/mun/executive-board-list";
import { RemoteImage } from "@/components/mun/remote-image";
import { ScheduleByDay } from "@/components/mun/schedule-by-day";
import { formatPrice } from "@/components/shared/currency";
import { formatAdminDate, formatAdminDateRange } from "@/lib/admin/go-live-labels";
import { MODULE_LABELS } from "@/lib/admin/module-labels";
import type { AdminMunValidationContext } from "@/types/admin-muns";
import type { Committee, Portfolio } from "@/types/committee";
import type { RegistrationProduct } from "@/types/registration-product";
import type { MunModule } from "@/types/enums";
import type { CommitteeWithPortfolios } from "@/types";

/**
 * Read-only view of what an organizer actually submitted for one module —
 * the content behind `ModulesSection`'s status-only row
 * (conference-detail-page.tsx). Derived from
 * `lib/lifecycle/validation.ts#MunValidationContext` (the same batched
 * context every one of the 15 module validators reads) via
 * `getAdminMunModuleContent`. The module -> field mapping below was read
 * directly off each validator in lib/lifecycle/validators/{content,
 * committees,commerce,operations}.ts — see the call site's report for the
 * per-module rationale, in particular COMMITTEES vs PORTFOLIOS (two lenses
 * over the same committees+portfolios data: COMMITTEES only ever reads
 * `ctx.committees`' own columns, PORTFOLIOS reads `ctx.portfolios` grouped by
 * committee) and REGISTRATION_TYPES vs PRICING_CAPACITY (both validators read
 * the exact same `ctx.registrationProducts` array with no distinct field
 * ownership, so both render the same table).
 */
export function ModuleContentView({
  moduleName,
  context,
}: {
  moduleName: MunModule;
  context: AdminMunValidationContext;
}) {
  switch (moduleName) {
    case "BASIC_INFO":
      return (
        <FactGrid>
          <FieldRow label="Name">{context.mun.name || "—"}</FieldRow>
          <FieldRow label="Edition">{context.mun.edition ?? "—"}</FieldRow>
          <FieldRow label="Theme">{context.mun.theme ?? "—"}</FieldRow>
          <FieldRow label="Organizer application (Gate 1)">
            {context.organizerApplication
              ? context.organizerApplication.status.toLowerCase().replace(/_/g, " ")
              : "No application"}
          </FieldRow>
          <FieldRow label="Description" className="sm:col-span-2">
            <span className="whitespace-pre-wrap">{context.mun.description ?? "—"}</span>
          </FieldRow>
        </FactGrid>
      );

    case "DATES_VENUE":
      return (
        <FactGrid>
          <FieldRow label="Conference dates">{formatAdminDateRange(context.mun.startDate, context.mun.endDate)}</FieldRow>
          <FieldRow label="Registration window">
            {formatAdminDateRange(context.mun.registrationOpensAt, context.mun.registrationDeadline)}
          </FieldRow>
          <FieldRow label="Venue">{context.mun.venue ?? "—"}</FieldRow>
          <FieldRow label="Address">{context.mun.addressLine1 ?? "—"}</FieldRow>
          <FieldRow label="City">{context.mun.city ?? "—"}</FieldRow>
          <FieldRow label="State">{context.mun.addressState ?? "—"}</FieldRow>
          <FieldRow label="Postal code">{context.mun.postalCode ?? "—"}</FieldRow>
          <FieldRow label="Country">{context.mun.country ?? "—"}</FieldRow>
          {context.mun.mapUrl && (
            <FieldRow label="Map">
              <a className="text-link underline underline-offset-4" href={context.mun.mapUrl} target="_blank" rel="noreferrer">
                Open map link
              </a>
            </FieldRow>
          )}
        </FactGrid>
      );

    case "BRANDING": {
      const logo = context.media.find((item) => item.kind === "LOGO");
      const cover = context.media.find((item) => item.kind === "COVER");
      return (
        <div className="flex flex-wrap gap-lg">
          <BrandingImage label="Logo" url={logo?.url ?? null} />
          <BrandingImage label="Cover image" url={cover?.url ?? null} />
        </div>
      );
    }

    case "COMMITTEES":
      // COMMITTEES' own validator (validateCommittees) only ever inspects
      // committees' own columns (agenda, capacity) — never `ctx.portfolios` —
      // so portfolios are deliberately left out here; see PORTFOLIOS below.
      return context.committees.length === 0 ? (
        <EmptyNote>No committees submitted yet.</EmptyNote>
      ) : (
        <CommitteeList committees={toCommitteesWithPortfolios(context.committees, [])} />
      );

    case "PORTFOLIOS":
      return context.committees.length === 0 ? (
        <EmptyNote>No committees submitted yet — portfolios are configured per committee.</EmptyNote>
      ) : (
        <CommitteeList committees={toCommitteesWithPortfolios(context.committees, context.portfolios)} />
      );

    case "EXECUTIVE_BOARD":
      return context.ebMembers.length === 0 ? (
        <EmptyNote>No executive board members submitted yet.</EmptyNote>
      ) : (
        <ExecutiveBoardList
          members={context.ebMembers}
          committees={context.committees.map((committee) => ({ id: committee.id, name: committee.name }))}
        />
      );

    case "CONTACT": {
      const contact = context.contact;
      if (!contact) return <EmptyNote>No contact details submitted yet.</EmptyNote>;
      return (
        <FactGrid>
          <FieldRow label="Official email">{contact.officialEmail}</FieldRow>
          <FieldRow label="Phone">{contact.phone ?? "—"}</FieldRow>
          <FieldRow label="Website">{contact.website ?? "—"}</FieldRow>
          <FieldRow label="Contact person">{contact.contactPersonName}</FieldRow>
          <FieldRow label="Contact person role">{contact.contactPersonRole ?? "—"}</FieldRow>
          <FieldRow label="Contact person email">{contact.contactPersonEmail}</FieldRow>
          <FieldRow label="Contact person phone">{contact.contactPersonPhone ?? "—"}</FieldRow>
        </FactGrid>
      );
    }

    case "REGISTRATION_TYPES":
    case "PRICING_CAPACITY":
      // Both validators (validateRegistrationTypes, validatePricingCapacity)
      // read the exact same `ctx.registrationProducts` array — neither owns a
      // distinct slice of it — so both tabs show the same table.
      return <RegistrationProductsTable products={context.registrationProducts} />;

    case "REGISTRATION_FORM":
      return context.formFields.length === 0 ? (
        <EmptyNote>No custom registration-form fields submitted yet.</EmptyNote>
      ) : (
        <ul className="flex list-none flex-col gap-xs p-0">
          {context.formFields.map((field) => (
            <li key={field.id} className="rounded-md border border-border p-md text-body-md">
              <p className="text-ink">
                <span className="font-medium">{field.label}</span>{" "}
                <span className="text-muted-foreground">({field.fieldType.toLowerCase().replace(/_/g, " ")})</span>
              </p>
              <p className="text-muted-foreground">
                Key: {field.fieldKey} · {field.required ? "Required" : "Optional"}
                {field.conditionalOn &&
                  ` · Shown when ${field.conditionalOn} ${(field.conditionalOperator ?? "").toLowerCase()} ${field.conditionalValue}`}
              </p>
              {field.choices && field.choices.length > 0 && (
                <p className="text-muted-foreground">Choices: {field.choices.join(", ")}</p>
              )}
            </li>
          ))}
        </ul>
      );

    case "PAYMENT_SETTLEMENT": {
      const settings = context.paymentSettings;
      return (
        <div className="flex flex-col gap-md">
          <FactGrid>
            <FieldRow label="Organizer UPI payout linked">{context.organizerPaymentLinked ? "Yes" : "No"}</FieldRow>
          </FactGrid>
          {settings ? (
            <div className="flex flex-col gap-sm">
              <p className="text-body-md font-medium text-ink">Legacy per-mun payment settings</p>
              <FactGrid>
                <FieldRow label="Legal name">{settings.legalName}</FieldRow>
                <FieldRow label="Bank">
                  {settings.bankName} · ending {settings.accountNumberLast4}
                </FieldRow>
                <FieldRow label="PAN">ending {settings.panLast4}</FieldRow>
                <FieldRow label="GSTIN">{settings.gstin ?? "—"}</FieldRow>
                <FieldRow label="Verification">{settings.verificationState}</FieldRow>
              </FactGrid>
            </div>
          ) : (
            <EmptyNote>No legacy per-mun payment settings submitted (not required to publish).</EmptyNote>
          )}
        </div>
      );
    }

    case "RULES_DOCUMENTS":
      return context.documents.length === 0 ? (
        <EmptyNote>No documents uploaded yet.</EmptyNote>
      ) : (
        <DocumentList documents={context.documents} />
      );

    case "SCHEDULE":
      return context.scheduleItems.length === 0 ? (
        <EmptyNote>No schedule items submitted yet.</EmptyNote>
      ) : (
        <ScheduleByDay
          items={context.scheduleItems.map((item) => ({
            ...item,
            startsAt: new Date(item.startsAt),
            endsAt: new Date(item.endsAt),
          }))}
          committees={context.committees.map((committee) => ({ id: committee.id, name: committee.name }))}
          startDate={context.mun.startDate ? new Date(context.mun.startDate) : null}
        />
      );

    case "ACCOMMODATION": {
      if (context.mun.accommodationProvided === "NOT_PROVIDED") {
        return <EmptyNote>Accommodation is explicitly marked as not provided.</EmptyNote>;
      }
      const activeCount = context.accommodationOptions.filter((option) => option.status === "active").length;
      return (
        <div className="flex flex-col gap-md">
          {context.accommodationOptions.length === 0 ? (
            <EmptyNote>No accommodation options submitted yet.</EmptyNote>
          ) : (
            <div className="flex flex-col gap-xs">
              <AccommodationList options={context.accommodationOptions} />
              <p className="text-body-md text-muted-foreground">
                {activeCount} of {context.accommodationOptions.length} option{context.accommodationOptions.length === 1 ? "" : "s"} active.
              </p>
            </div>
          )}
          {context.accommodationOptionFields.length > 0 && (
            <div className="flex flex-col gap-xs">
              <p className="text-body-md font-medium text-ink">Custom fields</p>
              <ul className="flex list-none flex-col gap-xxs p-0 text-body-md text-muted-foreground">
                {context.accommodationOptionFields.map((field) => (
                  <li key={field.id}>
                    {field.label} ({field.fieldType.toLowerCase()}){field.required ? " · required" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    case "FINAL_REVIEW": {
      // FINAL_REVIEW's own validator (validateFinalReview) has no content of
      // its own — it only aggregates `ctx.unresolvedIssues` for zero
      // unresolved BLOCKER-severity issues across every module.
      const blockers = context.unresolvedIssues.filter((issue) => issue.severity === "BLOCKER");
      return blockers.length === 0 ? (
        <EmptyNote>No unresolved blocker issues remain.</EmptyNote>
      ) : (
        <ul className="flex list-none flex-col gap-xs p-0">
          {blockers.map((issue) => (
            <li key={issue.id} className="rounded-md border border-destructive/40 bg-destructive/5 p-md text-body-md">
              <p className="font-medium text-ink">{MODULE_LABELS[issue.moduleName] ?? issue.moduleName}</p>
              <p className="text-body">{issue.reason}</p>
              {(issue.previousValue || issue.newValue) && (
                <p className="text-muted-foreground">
                  {issue.previousValue && `Previous: ${issue.previousValue}`}
                  {issue.previousValue && issue.newValue && " · "}
                  {issue.newValue && `Expected: ${issue.newValue}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      );
    }

    default:
      // The 4 legacy pre-PRD module keys (mun_details, committees,
      // portfolios, registration_products) — not in MODULE_REGISTRY, so
      // AdminMunDetail.modules should never actually contain one of these on
      // current data, but MunModule's type still includes them.
      return <EmptyNote>No content view available for this legacy module.</EmptyNote>;
  }
}

function toCommitteesWithPortfolios(committees: Committee[], portfolios: Portfolio[]): CommitteeWithPortfolios[] {
  return committees.map((committee) => ({
    id: committee.id,
    munId: committee.munId,
    name: committee.name,
    // Not a real column on `committees` — CommitteeList never reads it.
    abbreviation: null,
    description: committee.description,
    capacity: committee.capacity,
    agenda: committee.agenda,
    committeeType: committee.committeeType,
    portfolios: portfolios
      .filter((portfolio) => portfolio.committeeId === committee.id)
      .map((portfolio) => ({
        id: portfolio.id,
        committeeId: portfolio.committeeId,
        name: portfolio.name,
        // Not real columns on `portfolios` — CommitteeList only ever reads
        // `name`/`availability` off a portfolio.
        country: null,
        capacity: 0,
        availability: portfolio.availability,
        type: portfolio.type,
        description: portfolio.description,
        restrictions: portfolio.restrictions,
      })),
  }));
}

function RegistrationProductsTable({ products }: { products: RegistrationProduct[] }) {
  if (products.length === 0) return <EmptyNote>No registration types submitted yet.</EmptyNote>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-body-md">
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            <th className="py-xs pr-md font-medium">Name</th>
            <th className="py-xs pr-md font-medium">Status</th>
            <th className="py-xs pr-md font-medium">Price</th>
            <th className="py-xs pr-md font-medium">Early bird</th>
            <th className="py-xs pr-md font-medium">Capacity</th>
            <th className="py-xs font-medium">Deadline</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-b border-border last:border-0">
              <td className="py-xs pr-md text-ink">{product.name}</td>
              <td className="py-xs pr-md text-muted-foreground">{product.status}</td>
              <td className="py-xs pr-md tabular-nums text-ink">{formatPrice(product.price)}</td>
              <td className="py-xs pr-md tabular-nums text-muted-foreground">
                {product.earlyBirdPrice != null
                  ? `${formatPrice(product.earlyBirdPrice)} until ${formatAdminDate(product.earlyBirdDeadline)}`
                  : "—"}
              </td>
              <td className="py-xs pr-md tabular-nums text-muted-foreground">{product.capacity}</td>
              <td className="py-xs tabular-nums text-muted-foreground">{formatAdminDate(product.deadline)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BrandingImage({ label, url }: { label: string; url: string | null }) {
  return (
    <div className="flex flex-col gap-xs">
      <p className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">{label}</p>
      {url ? (
        <RemoteImage
          src={url}
          alt={label}
          className="h-24 w-40 rounded-md border border-border bg-surface-soft object-contain p-xs"
          fallback={<p className="text-body-md text-muted-foreground">Upload not stored — try re-uploading.</p>}
        />
      ) : (
        <p className="text-body-md text-muted-foreground">Not uploaded.</p>
      )}
    </div>
  );
}

function FactGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-md sm:grid-cols-2">{children}</dl>;
}

function FieldRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className ?? ""}`}>
      <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">{label}</dt>
      <dd className="text-body-md text-ink">{children}</dd>
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-body-md text-muted-foreground">{children}</p>;
}
