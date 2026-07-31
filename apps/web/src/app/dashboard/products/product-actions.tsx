"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DotsThreeIcon,
  NotePencilIcon,
  SpinnerIcon,
  StarIcon,
  TrashIcon,
} from "@/components/icons";
import { api } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
import { useSetProductScope } from "@/components/dashboard/product-scope-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

/**
 * The product's lifecycle verbs (rename, promote, remove), shared between the
 * portfolio rows and the detail page header so both surfaces say it the same way.
 */

/**
 * Renaming happens in a dialog rather than inline: on the portfolio the row is a
 * dense grid under a stretched link, and on the detail page the name is the page
 * title — neither has room for an input swapped in place.
 */
export function RenameProductDialog({
  product,
  busy,
  onSubmit,
  onClose,
}: {
  product: { name: string } | null;
  busy: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (product) setName(product.name);
  }, [product]);

  const trimmed = name.trim();
  const unchanged = product !== null && trimmed === product.name;

  return (
    <Dialog open={product !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {product?.name ?? "product"}</DialogTitle>
          <DialogDescription>
            The new name shows everywhere this product does: its page, its signals,
            its battle cards.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed && !unchanged) onSubmit(trimmed);
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
            aria-label="Product name"
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed || unchanged || busy}>
              {busy && <SpinnerIcon size={16} className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The detail page's actions menu: the same verbs the portfolio rows carry, so a
 * product open on screen can be managed without going back to the list. Removing
 * archives the product and leaves for the portfolio — the page it was on no longer
 * exists — releasing the scope first, otherwise the portfolio would redirect
 * straight back into the archived product.
 */
export function ProductActionsMenu({
  productId,
  name,
  isPrimary,
}: {
  productId: string;
  name: string;
  isPrimary: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setScope = useSetProductScope();
  const [busy, setBusy] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  async function onRenameSubmit(next: string) {
    setBusy("rename");
    try {
      await api.updateProduct(productId, { name: next });
      setRenameOpen(false);
      await refresh();
    } catch (e) {
      toastApiError(e, { title: "Couldn't rename the product" });
    } finally {
      setBusy(null);
    }
  }

  async function onMakePrimary() {
    if (busy) return;
    setBusy("primary");
    try {
      await api.updateProduct(productId, { isPrimary: true });
      toast.success(`${name} is now your primary product`);
      await refresh();
    } catch (e) {
      toastApiError(e, { title: "Couldn't update the product" });
    } finally {
      setBusy(null);
    }
  }

  async function onConfirmRemove() {
    setBusy("remove");
    try {
      await api.archiveProduct(productId);
      toast.success(`Removed ${name}.`);
      setScope(null);
      router.push("/dashboard/products?product=all");
      void refresh();
    } catch (e) {
      toastApiError(e, { title: "Couldn't remove the product" });
      setBusy(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`More actions for ${name}`}
          >
            <DotsThreeIcon size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <NotePencilIcon size={16} /> Rename…
          </DropdownMenuItem>
          {!isPrimary && (
            <DropdownMenuItem onSelect={() => void onMakePrimary()}>
              <StarIcon size={16} /> Make primary
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {isPrimary ? (
            <>
              <DropdownMenuItem disabled>
                <TrashIcon size={16} /> Remove
              </DropdownMenuItem>
              <p className="px-2 py-1.5 text-meta text-muted-foreground">
                Make another product primary first, so the workspace keeps one.
              </p>
            </>
          ) : (
            <DropdownMenuItem
              onSelect={() => setRemoveOpen(true)}
              className="text-critical focus:text-critical"
            >
              <TrashIcon size={16} /> Remove
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameProductDialog
        product={renameOpen ? { name } : null}
        busy={busy === "rename"}
        onSubmit={(next) => void onRenameSubmit(next)}
        onClose={() => busy !== "rename" && setRenameOpen(false)}
      />

      <Dialog
        open={removeOpen}
        onOpenChange={(o) => {
          if (!o && busy !== "remove") setRemoveOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {name}?</DialogTitle>
            <DialogDescription>
              This takes the product out of your workspace and stops its scans. Its
              competitors stay tracked at the workspace level, and its history is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRemoveOpen(false)}
              disabled={busy === "remove"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void onConfirmRemove()}
              disabled={busy === "remove"}
            >
              {busy === "remove" && <SpinnerIcon size={16} className="animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
