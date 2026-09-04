// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithWindowOwnershipIndex } from './orca-runtime-window-ownership-index'
import { HEADLESS_RUNTIME_WINDOW_ID } from '../../shared/runtime-types'
import type { RuntimeLeafRecord } from './runtime-terminal-state-records'

export class OrcaRuntimeWithDropWindowGraphContribution extends OrcaRuntimeWithWindowOwnershipIndex {
  protected nextGraphPublisherWindowId(excludedWindowId: number): number | null {
    for (const windowId of this.windowGraphPublications.keys()) {
      // Why: the headless sentinel is restored through its own fallback path, never
      // promoted here as if it were another desktop window.
      if (windowId !== excludedWindowId && windowId !== HEADLESS_RUNTIME_WINDOW_ID) {
        return windowId
      }
    }
    return null
  }

  // Why: closing one window must retire only the tabs and leaves it published;
  // anything another live window still publishes stays in the aggregate graph.
  protected dropWindowGraphContribution(windowId: number): void {
    const publication = this.windowGraphPublications.get(windowId)
    this.windowGraphPublications.delete(windowId)
    this.clearTransientPtyOwnersForWindow(windowId)
    if (!publication) {
      this.rebuildOwnerWindowIndexes()
      return
    }
    const survivingTabIds = new Set<string>()
    const survivingLeafKeys = new Set<string>()
    for (const other of this.windowGraphPublications.values()) {
      for (const tabId of other.tabIds) {
        survivingTabIds.add(tabId)
      }
      for (const leafKey of other.leafKeys) {
        survivingLeafKeys.add(leafKey)
      }
    }
    const retiredLeaves: RuntimeLeafRecord[] = []
    for (const leafKey of publication.leafKeys) {
      if (survivingLeafKeys.has(leafKey)) {
        continue
      }
      const leaf = this.leaves.get(leafKey)
      if (leaf) {
        retiredLeaves.push(leaf)
      }
    }
    this.rememberDetachedPreAllocatedLeavesForLeaves(retiredLeaves)
    for (const leaf of retiredLeaves) {
      const leafKey = this.getLeafKey(leaf.tabId, leaf.leafId)
      this.leaves.delete(leafKey)
      this.invalidateLeafHandle(leafKey)
    }
    for (const tabId of publication.tabIds) {
      if (!survivingTabIds.has(tabId)) {
        this.tabs.delete(tabId)
      }
    }
    this.rebuildLeafPtyIndex()
    this.rebuildOwnerWindowIndexes()
    this.refreshWritableFlags()
  }
}
