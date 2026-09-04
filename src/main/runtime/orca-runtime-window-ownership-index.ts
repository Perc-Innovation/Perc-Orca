// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithAttachWindow } from './orca-runtime-attach-window'
import { resolveWorkspaceProjectGroupId } from '../../shared/workspace-project-group'
import {
  computeWindowOwnershipPrioritySeed,
  diffPtyOwnerWindows,
  windowPublishesPty
} from './window-pty-ownership-priority'

export class OrcaRuntimeWithWindowOwnershipIndex extends OrcaRuntimeWithAttachWindow {
  /** Which window's renderer published the tab, so UI relays reach that window. */
  resolveOwnerWindowIdForTabId(tabId: string): number | null {
    return this.tabOwnerWindowById.get(tabId) ?? null
  }

  resolveOwnerWindowIdForWorktreeTab(worktreeId: string, tabId: string): number | null {
    return (
      this.tabOwnerWindowByWorktreeAndTabId.get(this.getWorktreeTabOwnerKey(worktreeId, tabId)) ??
      null
    )
  }

  resolveOwnerWindowIdForLeaf(tabId: string, leafId: string): number | null {
    return this.leafOwnerWindowByKey.get(this.getLeafKey(tabId, leafId)) ?? null
  }

  resolveOwnerWindowIdForLeafId(leafId: string): number | null {
    for (const [leafKey, ownerWindowId] of this.leafOwnerWindowByKey) {
      if (leafKey.endsWith(`::${leafId}`)) {
        return ownerWindowId
      }
    }
    return null
  }

  resolveOwnerWindowIdForPtyId(ptyId: string): number | null {
    return this.ptyOwnerWindowById.get(ptyId) ?? null
  }

  resolvePtyIdsForOwnerWindow(windowId: number): string[] {
    const ptyIds: string[] = []
    for (const [ptyId, ownerWindowId] of this.ptyOwnerWindowById) {
      if (ownerWindowId === windowId) {
        ptyIds.push(ptyId)
      }
    }
    return ptyIds
  }

  resolveOwnerWindowIdForBrowserPageId(browserPageId: string): number | null {
    return this.browserPageOwnerWindowById.get(browserPageId) ?? null
  }

  /** True when this window may mutate the terminal behind `handle`. */
  senderWindowOwnsTerminalHandle(handle: string, senderWindowId: number): boolean {
    const leaf = this.resolveLeafForHandle(handle)
    if (!leaf?.ptyId) {
      return false
    }
    return this.resolveOwnerWindowIdForPtyId(leaf.ptyId) === senderWindowId
  }

  /** Stamps a window on a runtime-created PTY before any graph publish adopts it. */
  registerPtyOwnerWindow(ptyId: string, windowId: number): void {
    this.transientPtyOwnerWindowById.set(ptyId, windowId)
    this.ptyOwnerWindowById.set(ptyId, windowId)
  }

  protected filterPtyIdsForOwnerWindow(
    ptyIds: ReadonlySet<string>,
    senderWindowId: number | undefined
  ): Set<string> {
    if (senderWindowId === undefined) {
      return new Set(ptyIds)
    }
    return new Set(
      [...ptyIds].filter((ptyId) => this.resolveOwnerWindowIdForPtyId(ptyId) === senderWindowId)
    )
  }

  protected isOwnedByAnotherWindow(
    ownerIndex: Map<string, number>,
    key: string,
    windowId: number
  ): boolean {
    const ownerWindowId = ownerIndex.get(key)
    return ownerWindowId !== undefined && ownerWindowId !== windowId
  }

  // Why: an explicit claim, then the window bound to the entry's project group, then the first
  // live publisher (window-pty-ownership-priority.ts) — so a project window takes its own
  // terminals over a free window that merely published first, and duplicate ids stay
  // deterministic across republishes.
  protected rebuildOwnerWindowIndexes(): void {
    const previousPtyOwners = new Map(this.ptyOwnerWindowById)
    this.tabOwnerWindowById.clear()
    this.tabOwnerWindowByWorktreeAndTabId.clear()
    this.leafOwnerWindowByKey.clear()
    this.ptyOwnerWindowById.clear()
    this.browserPageOwnerWindowById.clear()
    this.seedOwnerWindowIndexesByPriority()
    for (const [windowId, publication] of this.windowGraphPublications) {
      for (const tabId of publication.tabIds) {
        if (!this.tabOwnerWindowById.has(tabId)) {
          this.tabOwnerWindowById.set(tabId, windowId)
        }
        const worktreeId = this.tabs.get(tabId)?.worktreeId
        if (worktreeId !== undefined) {
          const worktreeTabKey = this.getWorktreeTabOwnerKey(worktreeId, tabId)
          if (!this.tabOwnerWindowByWorktreeAndTabId.has(worktreeTabKey)) {
            this.tabOwnerWindowByWorktreeAndTabId.set(
              worktreeTabKey,
              this.tabOwnerWindowById.get(tabId) ?? windowId
            )
          }
        }
      }
      for (const leafKey of publication.leafKeys) {
        if (!this.leafOwnerWindowByKey.has(leafKey)) {
          this.leafOwnerWindowByKey.set(leafKey, windowId)
        }
        const ptyId = this.leaves.get(leafKey)?.ptyId
        if (ptyId && !this.ptyOwnerWindowById.has(ptyId)) {
          this.ptyOwnerWindowById.set(ptyId, windowId)
          this.transientPtyOwnerWindowById.delete(ptyId)
        }
      }
      for (const browserPageId of publication.browserPageIds) {
        if (!this.browserPageOwnerWindowById.has(browserPageId)) {
          this.browserPageOwnerWindowById.set(browserPageId, windowId)
        }
      }
    }
    for (const [ptyId, windowId] of this.transientPtyOwnerWindowById) {
      if (!this.ptyOwnerWindowById.has(ptyId)) {
        this.ptyOwnerWindowById.set(ptyId, windowId)
      }
    }
    const changes = diffPtyOwnerWindows(previousPtyOwners, this.ptyOwnerWindowById)
    if (changes.length > 0) {
      this.onPtyOwnerWindowsChanged?.(changes)
    }
  }

  private seedOwnerWindowIndexesByPriority(): void {
    const resolveWindowProjectGroupId = this.resolveWindowProjectGroupIdFn
    if (!resolveWindowProjectGroupId && this.explicitPtyOwnerWindowById.size === 0) {
      return
    }
    const store = this.store
    const seed = computeWindowOwnershipPrioritySeed({
      publications: this.windowGraphPublications,
      explicitPtyClaims: this.explicitPtyOwnerWindowById,
      resolveWindowProjectGroupId: resolveWindowProjectGroupId ?? (() => null),
      resolveWorktreeProjectGroupId: (worktreeId) =>
        store
          ? resolveWorkspaceProjectGroupId(
              {
                getRepo: (repoId) => store.getRepo(repoId),
                getFolderWorkspaces: () => store.getFolderWorkspaces?.() ?? []
              },
              worktreeId
            )
          : null,
      getTabWorktreeId: (tabId) => this.tabs.get(tabId)?.worktreeId,
      getLeaf: (leafKey) => this.leaves.get(leafKey)
    })
    for (const [tabId, windowId] of seed.tabOwners) {
      this.tabOwnerWindowById.set(tabId, windowId)
    }
    for (const [leafKey, windowId] of seed.leafOwners) {
      this.leafOwnerWindowByKey.set(leafKey, windowId)
    }
    for (const [ptyId, windowId] of seed.ptyOwners) {
      this.ptyOwnerWindowById.set(ptyId, windowId)
      this.transientPtyOwnerWindowById.delete(ptyId)
    }
  }

  /** A rebind ("change project", "free mode", group deleted) changes who outranks whom; re-resolve. */
  handleWindowScopesChanged(): void {
    this.rebuildOwnerWindowIndexes()
  }

  /**
   * "Bring here": the sender window takes the PTY over scope and arrival order. Only a window
   * that publishes a pane for it may claim it, so a claim never targets a PTY the window cannot
   * render.
   */
  claimPtyOwnerWindow(
    ptyId: string,
    windowId: number
  ): 'claimed' | 'already-owner' | 'unavailable' {
    const publication = this.windowGraphPublications.get(windowId)
    if (!publication || !windowPublishesPty(publication, ptyId, (key) => this.leaves.get(key))) {
      return 'unavailable'
    }
    if (this.ptyOwnerWindowById.get(ptyId) === windowId) {
      this.explicitPtyOwnerWindowById.set(ptyId, windowId)
      return 'already-owner'
    }
    this.explicitPtyOwnerWindowById.set(ptyId, windowId)
    this.rebuildOwnerWindowIndexes()
    return 'claimed'
  }

  listPtyOwnerWindows(): { ptyId: string; windowId: number }[] {
    return Array.from(this.ptyOwnerWindowById, ([ptyId, windowId]) => ({ ptyId, windowId }))
  }

  protected clearOwnerWindowForPty(ptyId: string): void {
    this.transientPtyOwnerWindowById.delete(ptyId)
    this.explicitPtyOwnerWindowById.delete(ptyId)
    this.ptyOwnerWindowById.delete(ptyId)
  }

  // Why: a closed window's claims die with it; the PTY falls back to scope or arrival order.
  protected clearTransientPtyOwnersForWindow(windowId: number): void {
    for (const [ptyId, ownerWindowId] of this.transientPtyOwnerWindowById) {
      if (ownerWindowId === windowId) {
        this.transientPtyOwnerWindowById.delete(ptyId)
      }
    }
    for (const [ptyId, ownerWindowId] of this.explicitPtyOwnerWindowById) {
      if (ownerWindowId === windowId) {
        this.explicitPtyOwnerWindowById.delete(ptyId)
      }
    }
  }

  protected getWorktreeTabOwnerKey(worktreeId: string, tabId: string): string {
    return `${worktreeId}\u0000${tabId}`
  }
}
