import * as React from "react";
import { Loader2Icon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORT_LIMITS } from "@/types/support";

interface MessageComposerProps {
  id: string;
  /** Accessible name of the text box. */
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  sending: boolean;
  /** "icon": a round send button labelled "Send message"; "text": a "Send" button. */
  submitStyle?: "icon" | "text";
  rows?: number;
  /** Extra controls rendered between the text box and the send button (e.g. a status picker). */
  extra?: React.ReactNode;
  autoFocus?: boolean;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}

export const composerFieldClassName =
  "block w-full min-w-0 resize-none rounded-sm border border-input bg-background px-md py-sm text-body-md leading-[1.45] text-ink outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 read-only:bg-surface-soft dark:bg-card";

function isTouchFirst(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

/**
 * Chat composer: Enter sends, Shift+Enter adds a line (and Enter while an IME
 * is composing does nothing). On touch-first devices Enter keeps its usual
 * new-line meaning and the send button sends. The box stays focusable but
 * read-only while a send is in flight, so focus isn't lost and a second Enter
 * can't double-send.
 */
export function MessageComposer({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  sending,
  submitStyle = "icon",
  rows = 2,
  extra,
  autoFocus,
  textareaRef,
}: MessageComposerProps) {
  const trimmedLength = value.trim().length;
  const canSend = trimmedLength > 0 && trimmedLength <= SUPPORT_LIMITS.body && !sending;
  const counterId = `${id}-count`;
  const nearLimit = value.length > SUPPORT_LIMITS.body * 0.8;
  const [enterSends] = React.useState(() => !isTouchFirst());

  function submit() {
    if (canSend) onSubmit();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!enterSends || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <form
      className="flex flex-col gap-xs"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex items-end gap-xs">
        <textarea
          id={id}
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          maxLength={SUPPORT_LIMITS.body}
          readOnly={sending}
          aria-describedby={[enterSends ? `${id}-hint` : null, nearLimit ? counterId : null].filter(Boolean).join(" ") || undefined}
          autoFocus={autoFocus}
          className={composerFieldClassName}
        />
        {submitStyle === "icon" && (
          <Button type="submit" size="icon-sm" disabled={!canSend} aria-label="Send message">
            {sending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-xs">
        {enterSends ? (
          <span id={`${id}-hint`} className="text-[12px] text-muted-foreground">
            Enter to send · Shift+Enter for a new line
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-xs">
          {nearLimit && (
            <span id={counterId} className="text-[12px] text-muted-foreground tabular-nums">
              {value.length}/{SUPPORT_LIMITS.body}
            </span>
          )}
          {extra}
          {submitStyle === "text" && (
            <Button type="submit" size="sm" disabled={!canSend}>
              {sending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
              Send
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
