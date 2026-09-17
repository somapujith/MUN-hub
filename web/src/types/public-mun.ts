import type { ExecutiveBoardRole } from "@/types/executive-board";
import type { MunDocumentKind } from "@/types/mun-documents";
import type { ScheduleItemKind } from "@/types/mun-schedule";

/**
 * Shapes the public MUN page reads from the by-id public endpoints
 * (`/muns/:munId/{schedule,documents,executive-board,accommodation,media,faqs}`).
 * Only the fields the page renders are declared; dates are parsed to `Date`
 * by web/src/api/marketplace.ts.
 */

export interface PublicScheduleItem {
  id: string;
  committeeId: string | null;
  title: string;
  kind: ScheduleItemKind;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  displayOrder: number;
}

export interface PublicMunDocument {
  id: string;
  kind: MunDocumentKind;
  title: string;
  url: string;
  contentType: string;
  sizeBytes: number;
}

export interface PublicExecutiveBoardMember {
  id: string;
  committeeId: string | null;
  name: string;
  role: ExecutiveBoardRole;
  customRole: string | null;
  photoUrl: string | null;
  bio: string | null;
  institution?: string | null;
  organization?: string | null;
  displayOrder: number;
}

export interface PublicAccommodationOption {
  id: string;
  name: string;
  price: number;
  capacity: number;
  description: string | null;
}

export type MunMediaKind = "LOGO" | "COVER" | "GALLERY" | "SPONSOR" | "ORGANIZER_LOGO";

export interface PublicMunMedia {
  id: string;
  kind: MunMediaKind;
  url: string;
  displayOrder: number;
}

export interface PublicMunFaq {
  id: string;
  question: string;
  answer: string;
  displayOrder: number;
}
