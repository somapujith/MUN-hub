import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CameraOff, CircleAlert, CircleCheck, Info, ScanLine } from "lucide-react";
import { checkInDelegate } from "@/api/check-in";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CheckInResult } from "@/types/check-in";
import type { MunStatus } from "@/types/enums";

/** Mirrors lib/actions/check-in.ts#CHECK_IN_OPEN_STATUSES — the server has the final say. */
const CHECK_IN_OPEN_STATUSES: MunStatus[] = ["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CONFERENCE_ACTIVE"];
const SCAN_INTERVAL_MS = 400;
const RECENT_LIMIT = 8;

// The Shape Detection API isn't in TypeScript's DOM lib yet.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
}

function getBarcodeDetector(): BarcodeDetectorConstructor | undefined {
  return (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
}

/** Pulls a pass code out of whatever a scanner read (a bare code, or a longer payload containing one). */
function extractCode(raw: string): string {
  const match = raw.toUpperCase().match(/[0-9A-Z]{5}-?[0-9A-Z]{5}/);
  return match ? match[0] : raw.trim();
}

const timeFormatter = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

type Outcome = { kind: "result"; result: CheckInResult } | { kind: "error"; message: string };

interface CheckInPanelProps {
  munId: string;
  munStatus: MunStatus | undefined;
}

/**
 * Door check-in: type or paste the code from a delegate's pass, or scan it
 * with the device camera where the browser supports BarcodeDetector.
 * Checking in the same pass twice is harmless — the API reports when it was
 * first checked in.
 */
export function CheckInPanel({ munId, munStatus }: CheckInPanelProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [recent, setRecent] = useState<CheckInResult[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanner = useCameraScanner(videoRef);
  const open = munStatus === undefined || CHECK_IN_OPEN_STATUSES.includes(munStatus);

  const checkIn = useMutation({
    mutationFn: (value: string) => checkInDelegate(munId, value),
    onSuccess: async (result) => {
      setOutcome({ kind: "result", result });
      setCode("");
      if (result.outcome === "CHECKED_IN") {
        setRecent((previous) => [result, ...previous].slice(0, RECENT_LIMIT));
        await queryClient.invalidateQueries({ queryKey: ["organizer", "delegates", munId] });
      }
    },
    onError: (error) => setOutcome({ kind: "error", message: error instanceof Error ? error.message : "Check-in failed" }),
    onSettled: () => inputRef.current?.focus(),
  });

  const submit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || checkIn.isPending) return;
      checkIn.mutate(trimmed);
    },
    [checkIn],
  );

  const startScan = () => {
    setOutcome(null);
    void scanner.start((raw) => {
      const scanned = extractCode(raw);
      setCode(scanned);
      submit(scanned);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check-in</CardTitle>
        <CardDescription>
          Enter the 10-character code from a delegate's pass
          {scanner.supported ? ", or scan it with your camera" : ""}. Checking a pass in twice is safe.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-md">
        {!open && (
          <p className="flex items-start gap-xs rounded-sm border border-border bg-surface-soft px-md py-sm text-body-md text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            Check-in opens once registration is open, from 24 hours before the conference starts.
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-sm"
          onSubmit={(event) => {
            event.preventDefault();
            submit(code);
          }}
        >
          <div className="flex w-full flex-col gap-xs sm:w-[20rem]">
            <Label htmlFor="check-in-code">Check-in code</Label>
            <Input
              ref={inputRef}
              id="check-in-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXXX-XXXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={64}
              disabled={!open}
              className="font-mono tracking-[0.12em] uppercase"
            />
          </div>
          <Button type="submit" size="sm" className="h-11" disabled={!open || !code.trim() || checkIn.isPending}>
            {checkIn.isPending ? "Checking..." : "Check in"}
          </Button>
          {scanner.supported &&
            (scanner.active ? (
              <Button type="button" size="sm" variant="outline" className="h-11" onClick={scanner.stop}>
                <CameraOff aria-hidden /> Stop camera
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" className="h-11" disabled={!open} onClick={startScan}>
                <ScanLine aria-hidden /> Scan pass
              </Button>
            ))}
        </form>

        {scanner.active && (
          <video
            ref={videoRef}
            className="aspect-video w-full max-w-[28rem] rounded-sm border border-border bg-[#181d26] object-cover"
            muted
            playsInline
            aria-label="Camera preview for scanning a pass"
          />
        )}
        {scanner.error && (
          <p role="alert" className="text-body-md text-destructive">
            {scanner.error}
          </p>
        )}

        <div aria-live="polite">{outcome && <OutcomeNotice outcome={outcome} />}</div>

        {recent.length > 0 && (
          <div className="flex flex-col gap-xs">
            <h3 className="text-label-md text-ink">Checked in on this device</h3>
            <ul className="flex flex-col divide-y divide-border rounded-sm border border-border">
              {recent.map((entry) => (
                <li
                  key={`${entry.delegate.registrationId}-${entry.checkedInAt}`}
                  className="flex flex-wrap items-baseline justify-between gap-xs px-md py-xs"
                >
                  <span className="text-ink">{entry.delegate.name}</span>
                  <span className="text-caption text-muted-foreground">
                    {[entry.delegate.committee, timeFormatter.format(new Date(entry.checkedInAt))]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OutcomeNotice({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "error") {
    return (
      <div className="flex items-start gap-sm rounded-sm border border-destructive/30 bg-destructive/8 px-md py-sm">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive-text" aria-hidden />
        <p className="text-body-md text-destructive-text">{outcome.message}</p>
      </div>
    );
  }
  const { result } = outcome;
  const { delegate } = result;
  const already = result.outcome === "ALREADY_CHECKED_IN";
  const seat = [delegate.passName, delegate.committee, delegate.portfolio].filter(Boolean).join(" · ");
  return (
    <div
      className={
        already
          ? "flex items-start gap-sm rounded-sm border border-warning/30 bg-warning/15 px-md py-sm"
          : "flex items-start gap-sm rounded-sm border border-success/30 bg-success/15 px-md py-sm"
      }
    >
      {already ? (
        <Info className="mt-0.5 size-5 shrink-0 text-warning-text" aria-hidden />
      ) : (
        <CircleCheck className="mt-0.5 size-5 shrink-0 text-success-text" aria-hidden />
      )}
      <div className="flex min-w-0 flex-col gap-xxs">
        <p className={already ? "text-label-md text-warning-text" : "text-label-md text-success-text"}>
          {already
            ? `Already checked in at ${timeFormatter.format(new Date(result.checkedInAt))}`
            : "Checked in"}
        </p>
        <p className="font-display text-title-md break-words text-ink">{delegate.name}</p>
        {delegate.institution && <p className="text-body-md text-body">{delegate.institution}</p>}
        <p className="text-body-md text-muted-foreground">{seat}</p>
      </div>
    </div>
  );
}

/**
 * Camera + BarcodeDetector loop. `supported` is false on browsers without the
 * Shape Detection API (e.g. desktop Firefox/Safari), where the panel falls
 * back to typing the code.
 */
function useCameraScanner(videoRef: RefObject<HTMLVideoElement | null>) {
  const Detector = getBarcodeDetector();
  const supported = Boolean(Detector && typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ stream: MediaStream; onCode: (raw: string) => void } | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setPending(null);
    setActive(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = async (onCode: (raw: string) => void) => {
    if (!Detector) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setPending({ stream, onCode });
      setActive(true);
    } catch {
      setError("Couldn't open the camera. Allow camera access, or type the code instead.");
      stop();
    }
  };

  // The <video> only mounts once `active` is true, so wiring happens here.
  useEffect(() => {
    const video = videoRef.current;
    if (!active || !pending || !video || !Detector) return;
    let cancelled = false;
    video.srcObject = pending.stream;
    void video.play().catch(() => undefined);

    void (async () => {
      const wanted = ["qr_code", "code_128", "code_39"];
      const available = (await Detector.getSupportedFormats?.().catch(() => wanted)) ?? wanted;
      if (cancelled) return;
      const formats = wanted.filter((format) => available.includes(format));
      const detector = new Detector(formats.length > 0 ? { formats } : undefined);
      let busy = false;
      timerRef.current = window.setInterval(async () => {
        if (busy || video.readyState < 2) return;
        busy = true;
        try {
          const [first] = await detector.detect(video);
          if (first?.rawValue && !cancelled) {
            pending.onCode(first.rawValue);
            stop();
          }
        } catch {
          // A frame that fails to decode is normal while the camera focuses.
        } finally {
          busy = false;
        }
      }, SCAN_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, pending, Detector, stop, videoRef]);

  return { supported, active, error, start, stop };
}
