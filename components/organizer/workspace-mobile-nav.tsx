"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { PanelLeftIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { WorkspaceSidebar } from "@/components/organizer/workspace-sidebar";
import type { WorkspaceMun } from "@/app/organizer/dashboard/workspace-queries";

/**
 * Below `lg`, the persistent rail collapses into this drawer. Same
 * `<WorkspaceSidebar>` body as the desktop rail — the mobile nav is the same
 * navigation, relocated, not a reduced copy of it.
 *
 * Two closing paths, both needed. The pathname check covers navigation to a
 * *different* route — including browser back/forward, which no click handler
 * would catch. The explicit `onNavigate` covers clicking the link you are
 * already on: the pathname doesn't change, so the first path never fires and
 * the drawer would just sit there looking broken.
 */

interface WorkspaceMobileNavProps {
  muns: readonly WorkspaceMun[];
  currentMun: WorkspaceMun | null;
}

export function WorkspaceMobileNav({
  muns,
  currentMun,
}: WorkspaceMobileNavProps) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const [openedAt, setOpenedAt] = React.useState(pathname);

  // Adjust-state-during-render, not an effect: React re-runs this component
  // immediately with the new state before committing anything to the DOM, so
  // the drawer is already closed on the first paint of the new route. The
  // effect version paints the drawer over the new page for one frame first,
  // and trips `react-hooks/set-state-in-effect`.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  if (pathname !== openedAt) {
    setOpenedAt(pathname);
    setOpen(false);
  }

  const close = React.useCallback(() => setOpen(false), []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="Open workspace navigation"
          >
            <PanelLeftIcon strokeWidth={1.75} />
          </Button>
        }
      />
      <SheetContent
        side="left"
        showCloseButton={false}
        // The sidebar body owns its own header and padding, so the sheet's
        // default gap/padding would double up on it.
        className="w-[19rem] gap-0 p-0 data-[side=left]:sm:max-w-[19rem]"
      >
        {/* Base UI requires an accessible name on the dialog; the visible
            wordmark lives inside WorkspaceSidebar, so this is the sr-only
            counterpart rather than a second visible title. */}
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
        <WorkspaceSidebar
          muns={muns}
          currentMun={currentMun}
          onNavigate={close}
        />
      </SheetContent>
    </Sheet>
  );
}
