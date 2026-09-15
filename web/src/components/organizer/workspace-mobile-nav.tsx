import * as React from "react";
import { useLocation } from "react-router";
import { PanelLeftIcon } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { WorkspaceSidebar } from "@/components/organizer/workspace-sidebar";
import type { WorkspaceMun } from "@/types/organizer";

interface WorkspaceMobileNavProps {
  muns: readonly WorkspaceMun[];
  currentMun: WorkspaceMun | null;
}

export function WorkspaceMobileNav({ muns, currentMun }: WorkspaceMobileNavProps) {
  const [open, setOpen] = React.useState(false);
  const { pathname } = useLocation();
  const [openedAt, setOpenedAt] = React.useState(pathname);

  if (pathname !== openedAt) {
    setOpenedAt(pathname);
    setOpen(false);
  }

  const close = React.useCallback(() => setOpen(false), []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open workspace navigation">
            <PanelLeftIcon aria-hidden strokeWidth={1.75} />
          </Button>
        }
      />
      <SheetContent side="left" className="w-[17.5rem] p-0">
        <SheetTitle className="sr-only">Organizer workspace navigation</SheetTitle>
        <WorkspaceSidebar muns={muns} currentMun={currentMun} onNavigate={close} className="h-full" />
      </SheetContent>
    </Sheet>
  );
}
