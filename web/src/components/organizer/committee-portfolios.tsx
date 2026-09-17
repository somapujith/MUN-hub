import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Edit3, ListPlus, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  createPortfolio,
  createPortfolios,
  deletePortfolio,
  listPortfolios,
  updatePortfolio,
} from "@/api/committees";
import { queryKeys } from "@/api/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Portfolio } from "@/types/committee";

const PORTFOLIO_TYPES = [
  { value: "country", label: "Country" },
  { value: "person", label: "Person" },
  { value: "organization", label: "Organization" },
  { value: "other", label: "Other" },
] as const;

const SELECT_CLASS = "h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink";
const TEXTAREA_CLASS =
  "min-h-36 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25";
const MAX_AT_ONCE = 300;

function typeLabel(type: string | null): string | null {
  if (!type) return null;
  return PORTFOLIO_TYPES.find((option) => option.value === type)?.label ?? type;
}

function parseSeats(value: string): number | null {
  const seats = Number(value);
  return Number.isInteger(seats) && seats >= 0 && seats <= 1000 ? seats : null;
}

/** Splits a pasted list into names: one per line (or comma), trimmed, blanks dropped. */
function parseNames(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function duplicatesIn(names: string[], existing: Portfolio[]): string[] {
  const taken = new Set(existing.map((portfolio) => portfolio.name.toLowerCase()));
  const clashes: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (taken.has(key)) clashes.push(name);
    taken.add(key);
  }
  return clashes;
}

type Mode = "idle" | "single" | "list";

/**
 * The portfolios (seats) delegates can pick inside one committee. Each
 * committee needs at least one portfolio with a seat before the MUN can go
 * live, and names must be unique within the committee.
 */
export function CommitteePortfolios({
  munId,
  committeeId,
  committeeName,
}: {
  munId: string;
  committeeId: string;
  committeeName: string;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("idle");
  const [editingId, setEditingId] = useState<string | null>(null);

  const portfoliosQuery = useQuery({
    queryKey: queryKeys.portfolios(committeeId),
    queryFn: () => listPortfolios(committeeId),
  });
  const portfolios = portfoliosQuery.data ?? [];
  const seats = portfolios.reduce((total, portfolio) => total + portfolio.availability, 0);
  const hasAvailable = portfolios.some((portfolio) => portfolio.availability > 0);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolios(committeeId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.munProgress(munId) }),
    ]);

  const deleteMutation = useMutation({
    mutationFn: deletePortfolio,
    onSuccess: async () => {
      await refresh();
      toast.success("Portfolio removed");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to remove portfolio"),
  });

  return (
    <section
      aria-label={`${committeeName} portfolios`}
      className="flex flex-col gap-sm border-t border-border pt-sm"
      data-testid={`portfolios-${committeeId}`}
    >
      <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
        <h3 className="text-body-md font-medium text-ink">Portfolios</h3>
        {!portfoliosQuery.isLoading && (
          <span className="text-caption text-muted-foreground">
            {portfolios.length} {portfolios.length === 1 ? "portfolio" : "portfolios"} · {seats}{" "}
            {seats === 1 ? "seat" : "seats"}
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-xxs">
          <Button size="xs" variant="outline" onClick={() => setMode(mode === "single" ? "idle" : "single")}>
            <Plus aria-hidden /> Add portfolio
          </Button>
          <Button size="xs" variant="outline" onClick={() => setMode(mode === "list" ? "idle" : "list")}>
            <ListPlus aria-hidden /> Add a list
          </Button>
        </span>
      </div>

      {portfoliosQuery.isError && <p className="text-body-md text-destructive">{portfoliosQuery.error.message}</p>}
      {!portfoliosQuery.isLoading && !portfoliosQuery.isError && !hasAvailable && (
        <p className="flex items-center gap-xs text-caption text-warning-text">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          Add at least one portfolio with a seat so delegates can pick this committee.
        </p>
      )}

      {mode === "single" && (
        <SinglePortfolioForm
          committeeId={committeeId}
          existing={portfolios}
          onDone={async () => {
            await refresh();
          }}
          onCancel={() => setMode("idle")}
        />
      )}
      {mode === "list" && (
        <PortfolioListForm
          committeeId={committeeId}
          existing={portfolios}
          onDone={async () => {
            await refresh();
            setMode("idle");
          }}
          onCancel={() => setMode("idle")}
        />
      )}

      {portfolios.length > 0 && (
        <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-sm border border-border">
          {portfolios.map((portfolio) =>
            editingId === portfolio.id ? (
              <li key={portfolio.id} className="px-sm py-xs">
                <EditPortfolioRow
                  portfolio={portfolio}
                  existing={portfolios}
                  onDone={async () => {
                    await refresh();
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={portfolio.id} className="flex items-center gap-sm px-sm py-xs text-body-md">
                <span className="min-w-0 flex-1 truncate text-ink">{portfolio.name}</span>
                {typeLabel(portfolio.type) && <Badge variant="secondary">{typeLabel(portfolio.type)}</Badge>}
                <span
                  className={
                    "w-20 shrink-0 text-right text-caption " +
                    (portfolio.availability > 0 ? "text-muted-foreground" : "text-warning-text")
                  }
                >
                  {portfolio.availability === 0
                    ? "No seats"
                    : `${portfolio.availability} ${portfolio.availability === 1 ? "seat" : "seats"}`}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Edit ${portfolio.name}`}
                  onClick={() => setEditingId(portfolio.id)}
                >
                  <Edit3 aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${portfolio.name}`}
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`Remove ${portfolio.name} from ${committeeName}?`)) {
                      deleteMutation.mutate(portfolio.id);
                    }
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function SinglePortfolioForm({
  committeeId,
  existing,
  onDone,
  onCancel,
}: {
  committeeId: string;
  existing: Portfolio[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("country");
  const [seats, setSeats] = useState("1");

  const mutation = useMutation({
    mutationFn: () =>
      createPortfolio(committeeId, { name: name.trim(), type, availability: parseSeats(seats) ?? 1 }),
    onSuccess: async (portfolio) => {
      await onDone();
      toast.success(`${portfolio.name} added`);
      // Stay open so the next one can be typed straight away.
      setName("");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to add portfolio"),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Portfolio name is required");
      return;
    }
    if (parseSeats(seats) === null) {
      toast.error("Seats must be a whole number from 0 to 1000");
      return;
    }
    if (duplicatesIn([name.trim()], existing).length > 0) {
      toast.error(`A portfolio named "${name.trim()}" already exists in this committee`);
      return;
    }
    mutation.mutate();
  };

  return (
    <form
      onSubmit={submit}
      className="grid gap-sm rounded-sm bg-surface-soft p-sm sm:grid-cols-[minmax(0,1fr)_9rem_6rem_auto] sm:items-end"
    >
      <div className="flex flex-col gap-xxs">
        <Label htmlFor={`${id}-name`}>Portfolio name</Label>
        <Input
          id={`${id}-name`}
          placeholder="e.g. India"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-xxs">
        <Label htmlFor={`${id}-type`}>Type</Label>
        <select id={`${id}-type`} className={SELECT_CLASS} value={type} onChange={(event) => setType(event.target.value)}>
          {PORTFOLIO_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-xxs">
        <Label htmlFor={`${id}-seats`}>Seats</Label>
        <Input
          id={`${id}-seats`}
          type="number"
          min="0"
          max="1000"
          value={seats}
          onChange={(event) => setSeats(event.target.value)}
        />
      </div>
      <div className="flex gap-xxs">
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? "Adding..." : "Add"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Done
        </Button>
      </div>
    </form>
  );
}

function PortfolioListForm({
  committeeId,
  existing,
  onDone,
  onCancel,
}: {
  committeeId: string;
  existing: Portfolio[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [type, setType] = useState<string>("country");
  const [seats, setSeats] = useState("1");
  const names = parseNames(text);
  const clashes = duplicatesIn(names, existing);

  const mutation = useMutation({
    mutationFn: () =>
      createPortfolios(
        committeeId,
        names.map((name) => ({ name, type, availability: parseSeats(seats) ?? 1 })),
      ),
    onSuccess: async (created) => {
      await onDone();
      toast.success(`${created.length} ${created.length === 1 ? "portfolio" : "portfolios"} added`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to add portfolios"),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (names.length === 0) {
      toast.error("Add at least one portfolio");
      return;
    }
    if (names.length > MAX_AT_ONCE) {
      toast.error(`You can add at most ${MAX_AT_ONCE} portfolios at once`);
      return;
    }
    if (parseSeats(seats) === null) {
      toast.error("Seats must be a whole number from 0 to 1000");
      return;
    }
    if (clashes.length > 0) {
      toast.error(`Remove duplicates first: ${clashes.join(", ")}`);
      return;
    }
    mutation.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-sm rounded-sm bg-surface-soft p-sm">
      <div className="flex flex-col gap-xxs">
        <Label htmlFor={`${id}-names`}>Portfolio names, one per line</Label>
        <textarea
          id={`${id}-names`}
          className={TEXTAREA_CLASS}
          placeholder={"India\nJapan\nBrazil"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoFocus
        />
        <p className={"text-caption " + (clashes.length > 0 ? "text-warning-text" : "text-muted-foreground")}>
          {clashes.length > 0
            ? `Already in this committee or listed twice: ${clashes.join(", ")}`
            : `${names.length} ${names.length === 1 ? "portfolio" : "portfolios"} to add. Commas work too.`}
        </p>
      </div>
      <div className="grid gap-sm sm:grid-cols-[9rem_6rem_auto] sm:items-end">
        <div className="flex flex-col gap-xxs">
          <Label htmlFor={`${id}-type`}>Type for all</Label>
          <select id={`${id}-type`} className={SELECT_CLASS} value={type} onChange={(event) => setType(event.target.value)}>
            {PORTFOLIO_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-xxs">
          <Label htmlFor={`${id}-seats`}>Seats each</Label>
          <Input
            id={`${id}-seats`}
            type="number"
            min="0"
            max="1000"
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
          />
        </div>
        <div className="flex gap-xxs">
          <Button type="submit" size="sm" disabled={mutation.isPending || names.length === 0 || clashes.length > 0}>
            {mutation.isPending
              ? "Adding..."
              : names.length === 0
                ? "Add portfolios"
                : `Add ${names.length} ${names.length === 1 ? "portfolio" : "portfolios"}`}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

function EditPortfolioRow({
  portfolio,
  existing,
  onDone,
  onCancel,
}: {
  portfolio: Portfolio;
  existing: Portfolio[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(portfolio.name);
  const [type, setType] = useState(portfolio.type ?? "other");
  const [seats, setSeats] = useState(String(portfolio.availability));

  const mutation = useMutation({
    mutationFn: () =>
      updatePortfolio(portfolio.id, { name: name.trim(), type, availability: parseSeats(seats) ?? portfolio.availability }),
    onSuccess: async () => {
      await onDone();
      toast.success("Portfolio updated");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to update portfolio"),
  });

  const others = existing.filter((other) => other.id !== portfolio.id);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Portfolio name is required");
      return;
    }
    if (parseSeats(seats) === null) {
      toast.error("Seats must be a whole number from 0 to 1000");
      return;
    }
    if (duplicatesIn([name.trim()], others).length > 0) {
      toast.error(`A portfolio named "${name.trim()}" already exists in this committee`);
      return;
    }
    mutation.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-xs">
      <div className="flex min-w-40 flex-1 flex-col gap-xxs">
        <Label htmlFor={`${id}-name`} className="sr-only">
          Portfolio name
        </Label>
        <Input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </div>
      <Label htmlFor={`${id}-type`} className="sr-only">
        Type
      </Label>
      <select id={`${id}-type`} className={SELECT_CLASS} value={type} onChange={(event) => setType(event.target.value)}>
        {PORTFOLIO_TYPES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Label htmlFor={`${id}-seats`} className="sr-only">
        Seats
      </Label>
      <Input
        id={`${id}-seats`}
        type="number"
        min="0"
        max="1000"
        className="w-20"
        value={seats}
        onChange={(event) => setSeats(event.target.value)}
      />
      <Button type="submit" size="icon-xs" aria-label="Save portfolio" disabled={mutation.isPending}>
        <Check aria-hidden />
      </Button>
      <Button type="button" size="icon-xs" variant="ghost" aria-label="Cancel editing" onClick={onCancel}>
        <X aria-hidden />
      </Button>
    </form>
  );
}
