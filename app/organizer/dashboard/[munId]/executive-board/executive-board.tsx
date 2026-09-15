"use client";

import * as React from "react";
import { PencilIcon, PlusIcon, Trash2Icon, UsersRoundIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteExecutiveBoardAction } from "./actions";
import { ExecutiveBoardDialog } from "./executive-board-dialog";
import { DeleteExecutiveBoardDialog } from "./delete-dialog";
import type { ExecutiveBoardPageData, ExecutiveBoardRow } from "./queries";

export function ExecutiveBoard({
  munId,
  data,
}: {
  munId: string;
  data: ExecutiveBoardPageData;
}) {
  const [target, setTarget] = React.useState<ExecutiveBoardRow | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ExecutiveBoardRow | null>(null);

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="text-body-md text-body dark:text-muted-foreground">
          {data.members.length} {data.members.length === 1 ? "member" : "members"}
        </p>
        <Button size="sm" onClick={() => setTarget("new")}>
          <PlusIcon aria-hidden /> Add board member
        </Button>
      </div>

      {data.members.length === 0 ? (
        <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border-strong px-md py-2xl text-center">
          <UsersRoundIcon className="size-8 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="text-title-sm text-ink">No board members yet</h2>
            <p className="mt-xxs text-body-md text-muted-foreground">
              Add the people delegates will see leading each committee.
            </p>
          </div>
          <Button size="sm" onClick={() => setTarget("new")}>
            <PlusIcon aria-hidden /> Add board member
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse text-body-md">
            <caption className="sr-only">Executive board members</caption>
            <thead className="bg-surface-soft dark:bg-muted/40">
              <tr>
                {['Member', 'Role', 'Committee', 'Order', 'Actions'].map((heading) => (
                  <th key={heading} scope="col" className="px-md py-sm text-left text-[12px] font-medium text-muted-foreground">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.members.map((member) => (
                <tr key={member.id}>
                  <td className="px-md py-sm">
                    <div className="flex items-center gap-sm">
                      {member.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={member.photoUrl} alt="" className="size-9 rounded-full object-cover" />
                      ) : (
                        <span className="flex size-9 items-center justify-center rounded-full bg-surface-soft text-muted-foreground" aria-hidden>
                          <UsersRoundIcon className="size-4" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{member.name}</p>
                        {member.bio && <p className="max-w-sm truncate text-[12px] text-muted-foreground">{member.bio}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-md py-sm text-body">{member.role === "CUSTOM" ? member.customRole : roleLabel(member.role)}</td>
                  <td className="px-md py-sm text-body">{member.committeeName ?? "All conference"}</td>
                  <td className="px-md py-sm tabular-nums text-body">{member.displayOrder}</td>
                  <td className="px-md py-sm">
                    <div className="flex gap-xs">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${member.name}`} onClick={() => setTarget(member)}>
                        <PencilIcon aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${member.name}`} onClick={() => setDeleteTarget(member)}>
                        <Trash2Icon aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {target && (
        <ExecutiveBoardDialog
          key={target === "new" ? "new" : target.id}
          munId={munId}
          member={target === "new" ? undefined : target}
          committees={data.committees}
          open
          onOpenChange={(open) => !open && setTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteExecutiveBoardDialog
          member={deleteTarget}
          open
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          onConfirm={async () => {
            const result = await deleteExecutiveBoardAction(munId, deleteTarget.id);
            if (result.ok) toast.success(`${deleteTarget.name} removed`);
            return result;
          }}
        />
      )}
    </div>
  );
}

function roleLabel(role: ExecutiveBoardRow["role"]): string {
  return { CHAIR: "Chair", VICE_CHAIR: "Vice-chair", DIRECTOR: "Director", RAPPORTEUR: "Rapporteur", CUSTOM: "Custom" }[role];
}