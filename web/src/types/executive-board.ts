export type ExecutiveBoardRole = "CHAIR" | "VICE_CHAIR" | "DIRECTOR" | "RAPPORTEUR" | "CUSTOM";

export interface ExecutiveBoardMember {
  id: string;
  munId: string;
  committeeId: string | null;
  name: string;
  role: ExecutiveBoardRole;
  customRole: string | null;
  photoUrl: string | null;
  bio: string | null;
  institution?: string | null;
  organization?: string | null;
  socialLinks?: Record<string, string> | null;
  isPublic?: boolean;
  displayOrder: number;
  createdAt: string;
}

export interface ExecutiveBoardCommittee {
  id: string;
  name: string;
}

export interface ExecutiveBoardMemberInput {
  committeeId: string | null;
  name: string;
  role: ExecutiveBoardRole;
  customRole: string | null;
  photoUrl: string | null;
  bio: string | null;
  displayOrder: number;
  institution?: string | null;
  organization?: string | null;
  socialLinks?: Record<string, string> | null;
  isPublic?: boolean;
}