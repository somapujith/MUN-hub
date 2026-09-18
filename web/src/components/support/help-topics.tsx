import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  AwardIcon,
  Building2Icon,
  CreditCardIcon,
  HelpCircleIcon,
  LayoutDashboardIcon,
  ShieldCheckIcon,
  TicketIcon,
  UserIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import type { RequesterCategory } from "@/types/support";

/**
 * Self-serve help content for the Support page's help center — one topic per
 * question, grouped by the same categories a ticket is filed under
 * (`REQUESTER_CATEGORY_OPTIONS` in support-labels.ts) so browsing and filing
 * use one shared taxonomy.
 */
export interface HelpTopic {
  id: string;
  category: RequesterCategory;
  question: string;
  answer: ReactNode;
  /** Extra plain-text search terms not already covered by the question. */
  keywords?: string;
}

export interface HelpCategoryMeta {
  icon: LucideIcon;
  label: string;
  blurb: string;
}

export const HELP_CATEGORY_META: Record<RequesterCategory, HelpCategoryMeta> = {
  GENERAL: { icon: HelpCircleIcon, label: "General", blurb: "What MUN Hub is and how it works" },
  REGISTRATION: { icon: TicketIcon, label: "Registration", blurb: "Seat holds, group registration, your pass" },
  PAYMENT: { icon: CreditCardIcon, label: "Payment", blurb: "Fees, checkout, receipts, refunds" },
  MUN_INFO: { icon: Building2Icon, label: "Conference info", blurb: "Committees, dates, venues, organizers" },
  ACCOUNT: { icon: UserIcon, label: "Account", blurb: "Sign-in, profile, notifications, your data" },
  CERTIFICATE: { icon: AwardIcon, label: "Certificates", blurb: "Participation certificates and awards" },
  ORGANIZER: { icon: LayoutDashboardIcon, label: "Organizer tools", blurb: "Your listing, review, payouts, workspace" },
  TECHNICAL: { icon: WrenchIcon, label: "Technical issue", blurb: "Something on the site isn't working" },
  SAFETY_POLICY: { icon: ShieldCheckIcon, label: "Safety / policy", blurb: "Curation standards, reporting a concern" },
};

const link = "text-link underline-offset-4 hover:underline";

/** Delegate-facing categories, in the order shown on /dashboard/support. */
export const DELEGATE_HELP_CATEGORIES: RequesterCategory[] = [
  "REGISTRATION",
  "PAYMENT",
  "ACCOUNT",
  "MUN_INFO",
  "CERTIFICATE",
  "GENERAL",
  "TECHNICAL",
  "SAFETY_POLICY",
];

export const DELEGATE_HELP_TOPICS: HelpTopic[] = [
  {
    id: "general-what-is",
    category: "GENERAL",
    question: "What is MUN Hub?",
    answer:
      "A marketplace for Model United Nations conferences — discover conferences, compare committees and fees, and register and pay in one place. Every listing is reviewed by our team before it goes live.",
    keywords: "about platform marketplace",
  },
  {
    id: "general-verified",
    category: "GENERAL",
    question: "Is every conference on MUN Hub actually verified?",
    answer: (
      <>
        Yes — every listing goes through our review process before it's published, and again if the organizer
        changes anything major afterward, like dates or fees. See our{" "}
        <Link to="/about/curation" className={link}>
          curation standards
        </Link>
        .
      </>
    ),
  },
  {
    id: "general-run-conferences",
    category: "GENERAL",
    question: "Does MUN Hub run the conferences it lists?",
    answer:
      "No — each conference is organized and delivered by its own secretariat. We handle discovery, registration, and payments; questions about what happens at the conference itself are best sent to the organizer.",
  },
  {
    id: "registration-how",
    category: "REGISTRATION",
    question: "How does registering for a conference work?",
    answer:
      "Pick a registration pass on the conference page, and we hold your seat for 15 minutes while you complete payment. If payment doesn't finish in that window, the hold releases and someone else can take the seat.",
    keywords: "seat hold checkout",
  },
  {
    id: "registration-group",
    category: "REGISTRATION",
    question: "Can I register as a team or delegation?",
    answer:
      "If a pass allows delegation, you register the whole team in one payment as the head delegate, then invite each teammate by email from your dashboard — they don't pay separately.",
    keywords: "delegation team group roster invite",
  },
  {
    id: "registration-find",
    category: "REGISTRATION",
    question: "Where do I find my registration after I've paid?",
    answer: (
      <>
        In your{" "}
        <Link to="/dashboard" className={link}>
          dashboard
        </Link>
        , along with your receipt and your conference pass and check-in code.
      </>
    ),
  },
  {
    id: "registration-qr",
    category: "REGISTRATION",
    question: "My pass doesn't have a QR code — is that right?",
    answer:
      "Yes — passes currently show a check-in code instead of a QR code. The organizer's desk can type that code in at check-in.",
    keywords: "qr code check-in pass",
  },
  {
    id: "registration-change-committee",
    category: "REGISTRATION",
    question: "Can I change my committee or portfolio after registering?",
    answer:
      "That's up to the organizer. Message our support team with your registration details and we'll get it in front of the right people.",
    keywords: "committee portfolio swap change",
  },
  {
    id: "payment-fee",
    category: "PAYMENT",
    question: "What does the registration fee include?",
    answer: "The listed price already includes our platform fee — there's no separate charge added at checkout.",
    keywords: "platform fee price cost",
  },
  {
    id: "payment-pending",
    category: "PAYMENT",
    question: "I paid, but my registration still says payment pending.",
    answer:
      "We confirm a registration once we've verified the payment, which usually takes a few minutes. If it's still pending after that, message us with the conference name and we'll check it for you.",
  },
  {
    id: "payment-seat-hold-expired",
    category: "PAYMENT",
    question: "My seat hold expired while I was paying — was I charged?",
    answer:
      "If money left your account after a 15-minute hold expired, no registration was created, and the charge is returned as a payment error rather than left pending.",
    keywords: "seat hold expired charged",
  },
  {
    id: "payment-refund",
    category: "PAYMENT",
    question: "Can I get a refund if I can't attend?",
    answer: (
      <>
        No — once a registration is paid and confirmed, it's final, even if your plans change or the conference
        changes. The only exception is a genuine payment error. See our{" "}
        <Link to="/legal/refunds" className={link}>
          refund policy
        </Link>
        .
      </>
    ),
    keywords: "cancel refund cancellation",
  },
  {
    id: "payment-receipt",
    category: "PAYMENT",
    question: "Where's my receipt?",
    answer: "Every paid registration has a receipt in your dashboard that you can view or print any time.",
  },
  {
    id: "mun-info-find",
    category: "MUN_INFO",
    question: "Where do I find a conference's committees, dates and venue?",
    answer: (
      <>
        On the conference's own page —{" "}
        <Link to="/muns" className={link}>
          browse all listed conferences
        </Link>{" "}
        to find it.
      </>
    ),
  },
  {
    id: "mun-info-wrong",
    category: "MUN_INFO",
    question: "A conference's details look wrong or out of date.",
    answer:
      "Message us under “Conference info” with the conference name and what looks off, and we'll follow up with the organizer.",
  },
  {
    id: "mun-info-contact-organizer",
    category: "MUN_INFO",
    question: "How do I contact the organizing committee directly?",
    answer:
      "Check the conference page for their contact details, or send us a message with the conference name and we'll pass it along.",
  },
  {
    id: "account-forgot-password",
    category: "ACCOUNT",
    question: "How do I reset my password?",
    answer: (
      <>
        Use{" "}
        <Link to="/forgot-password" className={link}>
          forgot password
        </Link>{" "}
        — we'll email you a reset link that works for one hour.
      </>
    ),
  },
  {
    id: "account-change-password",
    category: "ACCOUNT",
    question: "How do I change my password while signed in?",
    answer: (
      <>
        From{" "}
        <Link to="/profile" className={link}>
          your profile
        </Link>
        , under “Account & security”.
      </>
    ),
  },
  {
    id: "account-details",
    category: "ACCOUNT",
    question: "How do I update my emergency contact or other profile details?",
    answer: (
      <>
        Also on{" "}
        <Link to="/profile" className={link}>
          your profile
        </Link>
        — these details pre-fill future registrations so you don't retype them each time.
      </>
    ),
  },
  {
    id: "account-email-notifications",
    category: "ACCOUNT",
    question: "How do I turn off email notifications?",
    answer: (
      <>
        There's an email notifications toggle on{" "}
        <Link to="/profile" className={link}>
          your profile
        </Link>
        .
      </>
    ),
  },
  {
    id: "account-data",
    category: "ACCOUNT",
    question: "How do I get a copy of my data, or have it deleted?",
    answer: "Your profile has a section for exporting or deleting your account data.",
    keywords: "privacy export delete gdpr data request",
  },
  {
    id: "certificate-where",
    category: "CERTIFICATE",
    question: "Where do I get my certificate of participation?",
    answer:
      "Certificates are issued by each conference's own organizing committee, not by MUN Hub — check with your conference for how and when they release theirs.",
  },
  {
    id: "technical-broken-page",
    category: "TECHNICAL",
    question: "A page on the site looks broken or won't load.",
    answer:
      "Try refreshing first. If that doesn't help, message us under “Technical issue” with the page and what you were doing — a screenshot helps a lot.",
  },
  {
    id: "technical-devices",
    category: "TECHNICAL",
    question: "I'm signed in on one device but not another.",
    answer: "Sign in again on the new device — sessions aren't shared automatically between devices or browsers.",
  },
  {
    id: "safety-curation",
    category: "SAFETY_POLICY",
    question: "How do you decide which conferences to list?",
    answer: (
      <>
        Every conference goes through our review process before it's published. See our{" "}
        <Link to="/about/curation" className={link}>
          curation standards
        </Link>
        .
      </>
    ),
  },
  {
    id: "safety-report",
    category: "SAFETY_POLICY",
    question: "How do I report a listing or a safety concern?",
    answer: "Message us under “Safety / policy” with the details — these go straight to our team.",
  },
];

/** Organizer-facing categories, in the order shown on /organizer/support. */
export const ORGANIZER_HELP_CATEGORIES: RequesterCategory[] = [
  "ORGANIZER",
  "PAYMENT",
  "ACCOUNT",
  "GENERAL",
  "TECHNICAL",
  "SAFETY_POLICY",
];

export const ORGANIZER_HELP_TOPICS: HelpTopic[] = [
  {
    id: "org-general-what-is",
    category: "GENERAL",
    question: "What is MUN Hub for organizers?",
    answer:
      "A place to list your conference, take registrations and payments, and manage delegates — without building your own registration system.",
  },
  {
    id: "org-apply",
    category: "ORGANIZER",
    question: "How do I apply to list a conference?",
    answer:
      "Sign up as an organizer and complete the onboarding wizard. Creating your profile, your conference's basic details, and your payout details submits your application for review.",
    keywords: "apply onboarding wizard host",
  },
  {
    id: "org-review-time",
    category: "ORGANIZER",
    question: "How long does review take?",
    answer: "We aim to review applications within 2 business days.",
    keywords: "gate 1 gate 2 verification approval",
  },
  {
    id: "org-locked-module",
    category: "ORGANIZER",
    question: "Why can't I edit part of my listing right now?",
    answer:
      "While a conference is under active review, high-impact details like dates, venue, or pricing lock until the review finishes. Day-to-day details usually stay editable — message us if something you need to fix is locked.",
    keywords: "locked editing frozen review",
  },
  {
    id: "org-payouts",
    category: "ORGANIZER",
    question: "How do payouts work?",
    answer: "Payouts go to the UPI ID you added during onboarding. There's no separate bank-account step.",
    keywords: "upi payout settlement bank",
  },
  {
    id: "org-multiple-muns",
    category: "ORGANIZER",
    question: "Can I run more than one conference?",
    answer: "Yes — one organizer account can host more than one conference over time.",
  },
  {
    id: "org-change-payout",
    category: "ORGANIZER",
    question: "How do I change my payout details?",
    answer: "Message our support team — payout changes go through us rather than a self-service form, since we re-verify the account.",
  },
  {
    id: "org-payment-fee",
    category: "PAYMENT",
    question: "Does MUN Hub take a fee?",
    answer:
      "Our platform fee is included in the price delegates pay and is deducted before your payout — there's no separate invoice to you.",
  },
  {
    id: "org-payment-refund",
    category: "PAYMENT",
    question: "Can a delegate get a refund?",
    answer: (
      <>
        No — registrations are final once paid and confirmed. The only exception is a genuine payment error, which we
        handle directly. See our{" "}
        <Link to="/legal/refunds" className={link}>
          refund policy
        </Link>
        .
      </>
    ),
  },
  {
    id: "org-account-signin",
    category: "ACCOUNT",
    question: "How do I sign in?",
    answer: "Organizer accounts sign in with a one-time code emailed to you — there's no password to reset.",
    keywords: "otp code login password",
  },
  {
    id: "org-technical-broken",
    category: "TECHNICAL",
    question: "A page in my workspace looks broken or won't load.",
    answer:
      "Try refreshing first. If that doesn't help, message us under “Technical issue” with the page and what you were doing — a screenshot helps a lot.",
  },
  {
    id: "org-safety-report",
    category: "SAFETY_POLICY",
    question: "What counts as a safety or policy concern?",
    answer: "Anything that puts delegates at risk or misrepresents your conference. Message us under “Safety / policy”.",
  },
];
