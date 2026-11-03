"use client";

import UniqueID from "@tiptap/extension-unique-id";
import { Markdown } from "@tiptap/markdown";
import {
  type Editor,
  EditorContent,
  type JSONContent,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Heading3, Italic, List, ListOrdered, type LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type SaveStatus, useAutosave } from "./use-autosave";

/**
 * Block nodes that get a stable id (`attrs.id`), kept across edits and saves. Chunks record the
 * ids they cover, so a citation can scroll back to the block a question came from.
 */
const BLOCK_TYPES = ["heading", "paragraph", "blockquote", "codeBlock", "listItem"];

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  failed: "Couldn't save. Retrying…",
  conflict: "This note was changed in another tab.",
  signed_out: "You were signed out. Sign in again to keep editing.",
};

interface NoteEditorProps {
  documentId: string;
  /** TipTap JSON from `documents.content_json`; null for a note that was never saved. */
  initialContent: JSONContent | null;
  initialVersion: number;
}

/** The note's TipTap editor. Every change is autosaved as TipTap JSON and Markdown. */
export function NoteEditor({ documentId, initialContent, initialVersion }: NoteEditorProps) {
  const autosave = useAutosave(documentId, initialVersion);
  const { schedule } = autosave;

  const editor = useEditor({
    extensions: [StarterKit, Markdown, UniqueID.configure({ types: BLOCK_TYPES })],
    content: initialContent ?? "",
    // The server renders no editor; creating it in the browser only avoids a hydration mismatch.
    immediatelyRender: false,
    // The toolbar subscribes to what it needs with useEditorState instead.
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class:
          "tiptap min-h-80 rounded-lg border px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        "aria-label": "Note",
      },
    },
    onUpdate: ({ editor }) => {
      // Read when the save is sent, not now, so the save carries the latest text.
      schedule(() => ({ content_json: editor.getJSON(), content_md: editor.getMarkdown() }));
    },
  });

  // Stop typing that could never be saved: another tab's newer version, or no session.
  const locked = autosave.status === "conflict" || autosave.status === "signed_out";
  useEffect(() => {
    if (editor && locked) editor.setEditable(false);
  }, [editor, locked]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        {editor ? <Toolbar editor={editor} disabled={locked} /> : <div className="h-8" />}
        <p
          aria-live="polite"
          className={cn(
            "shrink-0 text-xs",
            autosave.status === "saved" ||
              autosave.status === "saving" ||
              autosave.status === "unsaved"
              ? "text-muted-foreground"
              : "text-destructive",
          )}
        >
          {STATUS_TEXT[autosave.status]}
        </p>
      </div>
      {locked && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm"
        >
          <span>Your latest edits here were not saved. Reload to get the saved note.</span>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      )}
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="text-muted-foreground min-h-80 rounded-lg border px-4 py-3 text-sm">
          Loading the editor…
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      h2: editor.isActive("heading", { level: 2 }),
      h3: editor.isActive("heading", { level: 3 }),
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
    }),
  });

  const tools: { key: keyof typeof active; label: string; icon: LucideIcon; run: () => void }[] = [
    {
      key: "h2",
      label: "Heading",
      icon: Heading2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: "h3",
      label: "Subheading",
      icon: Heading3,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      key: "bold",
      label: "Bold",
      icon: Bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: "italic",
      label: "Italic",
      icon: Italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: "bulletList",
      label: "Bulleted list",
      icon: List,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: "orderedList",
      label: "Numbered list",
      icon: ListOrdered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
  ];

  return (
    <div role="toolbar" aria-label="Formatting" className="flex gap-1">
      {tools.map(({ key, label, icon: Icon, run }) => (
        <Button
          key={key}
          type="button"
          variant={active[key] ? "secondary" : "ghost"}
          size="icon"
          aria-label={label}
          aria-pressed={active[key]}
          disabled={disabled}
          onClick={run}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );
}
