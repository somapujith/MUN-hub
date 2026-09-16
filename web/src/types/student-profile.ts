/** Mirrors lib/types/student-profile.ts's `StudentProfile` (InferSelectModel<typeof studentProfiles>) as it comes back over JSON. */
export interface StudentProfile {
  id: string;
  userId: string;
  dateOfBirth: string;
  gradeOrYear: string;
  residentialAddress: string;
  requiresTransportation: boolean;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  munExperience: string | null;
  referralCode: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors lib/types/student-profile.ts's `StudentProfileInput`. */
export interface StudentProfileInput {
  phone: string;
  institution: string;
  dateOfBirth: string;
  gradeOrYear: string;
  residentialAddress: string;
  requiresTransportation: boolean;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  munExperience?: string;
  referralCode?: string;
}
