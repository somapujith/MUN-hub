import { listEbMembersForOrganizer } from "@/lib/actions/executive-board";
import { getSession } from "@/app/lib/session";
import { listCommittees } from "@/lib/actions/mun-config";
import type { ExecutiveBoardMember } from "@/lib/actions/executive-board";
import type { Committee } from "@/lib/types";

export interface ExecutiveBoardRow extends ExecutiveBoardMember {
  committeeName: string | null;
}

export interface ExecutiveBoardPageData {
  members: ExecutiveBoardRow[];
  committees: Committee[];
}

export function buildExecutiveBoardPageData(
  members: Awaited<ReturnType<typeof listEbMembersForOrganizer>>,
  committees: Committee[],
): ExecutiveBoardPageData {
  const committeeNames = new Map(
    committees.map((committee) => [committee.id, committee.name]),
  );

  return {
    members: members.map((member) => ({
      ...member,
      committeeName: member.committeeId
        ? (committeeNames.get(member.committeeId) ?? "Unknown committee")
        : null,
    })),
    committees: [...committees].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getExecutiveBoardPageData(munId: string): Promise<ExecutiveBoardPageData> {
  const session = await getSession();
  const [members, committees] = await Promise.all([
    listEbMembersForOrganizer(munId, session),
    listCommittees(munId),
  ]);
  return buildExecutiveBoardPageData(members, committees);
}