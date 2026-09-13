"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Client-only search box for /admin/registrations. Pushes `?q=` so the
 * result set stays server-rendered (and shareable/bookmarkable) — same
 * "client only for the interactive bit" split as OrganizerRow/SuspendDialog.
 */
export function SearchForm({ initialQuery }: { initialQuery: string }) {
  const [value, setValue] = useState(initialQuery);
  const router = useRouter();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/admin/registrations?q=${encodeURIComponent(value.trim())}`);
      }}
      className="flex gap-sm"
    >
      <Input
        placeholder="Student, MUN, committee, portfolio, or order ID"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Search registrations"
      />
      <Button type="submit">
        <SearchIcon aria-hidden />
        Search
      </Button>
    </form>
  );
}
