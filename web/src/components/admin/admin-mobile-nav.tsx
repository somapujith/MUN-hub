import * as React from "react";
import { useLocation } from "react-router";
import { PanelLeftIcon } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

export function AdminMobileNav() {
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
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open admin navigation">
            <PanelLeftIcon aria-hidden strokeWidth={1.75} />
          </Button>
        }
      />
      <SheetContent side="left" className="w-[17.5rem] p-0">
        <SheetTitle className="sr-only">Admin navigation</SheetTitle>
        <AdminSidebar onNavigate={close} className="h-full" />
      </SheetContent>
    </Sheet>
  );
}
