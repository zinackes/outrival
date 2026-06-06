"use client";

import { useEffect, useState } from "react";
import { Bookmark, Pencil, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { api, type SavedView, type SavedViewFilters } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export function SavedViewsMenu({
  current,
  onApply,
}: {
  current: SavedViewFilters;
  onApply: (filters: SavedViewFilters) => void;
}) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<SavedView | null>(null);
  const [editName, setEditName] = useState("");
  const [editUseCurrent, setEditUseCurrent] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SavedView | null>(null);
  const [deleting, setDeleting] = useState(false);

  function refresh() {
    api
      .listSavedViews()
      .then((r) => setViews(r.views))
      .catch(() => {});
  }
  useEffect(() => {
    refresh();
  }, []);

  const hasCurrent = Boolean(
    current.competitorIds?.length ||
      current.categories?.length ||
      current.severities?.length ||
      (current.view && current.view !== "all"),
  );

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await api.createSavedView(trimmed, current);
      toast.success(`Saved “${trimmed}”`);
      setSaveOpen(false);
      setName("");
      refresh();
    } catch {
      toast.error("Couldn’t save this view");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(v: SavedView) {
    setEditing(v);
    setEditName(v.name);
    setEditUseCurrent(false);
  }

  async function saveEdit() {
    const trimmed = editName.trim();
    if (!editing || !trimmed || savingEdit) return;
    const target = editing;
    setSavingEdit(true);
    try {
      const { view } = await api.updateSavedView(target.id, {
        name: trimmed,
        ...(editUseCurrent ? { filters: current } : {}),
      });
      setViews((p) => p.map((v) => (v.id === view.id ? view : v)));
      toast.success(`Updated “${view.name}”`);
      setEditing(null);
    } catch {
      toast.error("Couldn’t update this view");
    } finally {
      setSavingEdit(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    const target = pendingDelete;
    setDeleting(true);
    setViews((p) => p.filter((v) => v.id !== target.id));
    try {
      await api.deleteSavedView(target.id);
      toast.success(`Deleted “${target.name}”`);
      setPendingDelete(null);
    } catch {
      setViews((p) =>
        [...p, target].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
      toast.error("Couldn’t delete this view");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Bookmark size={13} />
            Views
            <ChevronDown size={11} className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="end">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {views.length === 0 ? (
            <div className="text-muted-foreground px-2 py-1.5 text-xs">No saved views yet.</div>
          ) : (
            views.map((v) => (
              <DropdownMenuItem
                key={v.id}
                onSelect={() => onApply(v.filters)}
                className="group flex items-center justify-between gap-2"
              >
                <span className="truncate text-dense">{v.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(v);
                    }}
                    aria-label={`Edit ${v.name}`}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(v);
                    }}
                    aria-label={`Delete ${v.name}`}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setName("");
              setSaveOpen(true);
            }}
            disabled={!hasCurrent}
            className="text-dense"
          >
            Save current view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
            <DialogDescription>
              Name this filter set to apply it again in one click.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="saved-view-name">Name</Label>
              <Input
                id="saved-view-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Critical pricing moves"
                maxLength={60}
                autoFocus
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={!name.trim() || saving}>
                {saving ? "Saving…" : "Save view"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit view</DialogTitle>
            <DialogDescription>Rename this view or save your current filters into it.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="edit-view-name">Name</Label>
              <Input
                id="edit-view-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={60}
                autoFocus
              />
            </div>
            {hasCurrent && (
              <label className="flex items-start gap-2 text-dense">
                <Checkbox
                  checked={editUseCurrent}
                  onCheckedChange={(v) => setEditUseCurrent(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Replace its filters with the current selection
                  <span className="text-muted-foreground block text-xs">
                    Overwrites the saved filters with what’s applied now.
                  </span>
                </span>
              </label>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={!editName.trim() || savingEdit}>
                {savingEdit ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete view</DialogTitle>
            <DialogDescription>
              Delete “{pendingDelete?.name}”? This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
