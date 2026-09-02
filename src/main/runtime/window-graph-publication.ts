import type { RuntimeMobileSessionTabsSnapshot } from '../../shared/runtime-types'

/** What one window's renderer last published, so its contribution can be dropped
 *  when that window closes without disturbing the other windows' graphs. */
export type WindowGraphPublication = {
  tabIds: Set<string>
  leafKeys: Set<string>
  browserPageIds: Set<string>
}

export function emptyWindowGraphPublication(): WindowGraphPublication {
  return { tabIds: new Set(), leafKeys: new Set(), browserPageIds: new Set() }
}

export function collectBrowserPageIds(
  snapshots: readonly RuntimeMobileSessionTabsSnapshot[]
): Set<string> {
  const browserPageIds = new Set<string>()
  for (const snapshot of snapshots) {
    for (const tab of snapshot.tabs) {
      if (tab.type === 'browser' && tab.browserPageId) {
        browserPageIds.add(tab.browserPageId)
      }
    }
  }
  return browserPageIds
}
