import { initialsOf, safeLinkUrl } from "@/components/mun/mun-format";
import { RemoteImage } from "@/components/mun/remote-image";
import { ebRoleLabel } from "@/lib/mun-public-labels";
import type { PublicExecutiveBoardMember } from "@/types/public-mun";

/**
 * Executive board, grouped by committee (conference-level members first).
 * Only members the organizer marked public ever reach this component — the
 * endpoint filters the rest.
 */

interface ExecutiveBoardListProps {
  members: PublicExecutiveBoardMember[];
  committees: { id: string; name: string }[];
}

function Avatar({ member }: { member: PublicExecutiveBoardMember }) {
  const fallback = (
    <span
      aria-hidden
      className="flex size-14 shrink-0 items-center justify-center rounded-full border border-border bg-surface-soft font-display text-label-md text-ink"
    >
      {initialsOf(member.name)}
    </span>
  );
  const photo = safeLinkUrl(member.photoUrl);
  if (!photo) return fallback;
  return (
    <RemoteImage
      src={photo}
      alt=""
      className="size-14 shrink-0 rounded-full border border-border object-cover"
      fallback={fallback}
    />
  );
}

function MemberCard({ member, committeeName }: { member: PublicExecutiveBoardMember; committeeName?: string }) {
  const affiliation = [member.institution, member.organization].filter(Boolean).join(" · ");
  return (
    <li className="flex gap-md rounded-md border border-border bg-card p-lg">
      <Avatar member={member} />
      <div className="min-w-0">
        <p className="font-display text-label-md text-ink">{member.name}</p>
        <p className="mt-xxs text-body-md text-body dark:text-muted-foreground">
          {ebRoleLabel(member.role, member.customRole)}
          {committeeName && <span className="text-muted-foreground"> · {committeeName}</span>}
        </p>
        {affiliation && <p className="mt-xxs text-body-md text-muted-foreground">{affiliation}</p>}
        {member.bio && (
          <p className="mt-xs line-clamp-4 text-body-md leading-relaxed text-body dark:text-muted-foreground">
            {member.bio}
          </p>
        )}
      </div>
    </li>
  );
}

export function ExecutiveBoardList({ members, committees }: ExecutiveBoardListProps) {
  const committeeNames = new Map(committees.map((committee) => [committee.id, committee.name]));

  const groups: { key: string; title: string; members: PublicExecutiveBoardMember[] }[] = [];
  const conferenceLevel = members.filter((member) => !member.committeeId || !committeeNames.has(member.committeeId));
  if (conferenceLevel.length > 0) {
    groups.push({ key: "conference", title: "Secretariat", members: conferenceLevel });
  }
  for (const committee of committees) {
    const inCommittee = members.filter((member) => member.committeeId === committee.id);
    if (inCommittee.length > 0) {
      groups.push({ key: committee.id, title: committee.name, members: inCommittee });
    }
  }

  // A single group needs no subheading — the section title already says it.
  const showGroupTitles = groups.length > 1;

  return (
    <div className="flex flex-col gap-xl">
      {groups.map((group) => (
        <div key={group.key}>
          {showGroupTitles && (
            <h3 className="mb-sm text-caption uppercase tracking-[0.16px] text-muted-foreground">{group.title}</h3>
          )}
          <ul className="grid list-none grid-cols-1 gap-md p-0 md:grid-cols-2">
            {group.members.map((member) => (
              <MemberCard
                key={member.id}
                member={member}
                committeeName={showGroupTitles ? undefined : member.committeeId ? committeeNames.get(member.committeeId) : undefined}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
