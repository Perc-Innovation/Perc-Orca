import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'

test('manual-group folder workspace remains visible across a headed restart @headful', async (// oxlint-disable-next-line no-empty-pattern -- This restart test owns its Electron launches.
{}, testInfo) => {
  test.setTimeout(300_000)
  const session = createRestartSession(testInfo)
  const dataFile = path.join(session.userDataDir, 'orca-data.json')
  const folderPath = path.join(session.userDataDir, 'manual-folder')
  const groupId = 'manual-folder-group'
  const workspaceId = 'manual-folder-workspace'
  const workspaceName = 'Persisted manual folder'
  mkdirSync(folderPath)
  const state = JSON.parse(readFileSync(dataFile, 'utf-8')) as Record<string, unknown>
  const now = Date.now()
  state.projectGroups = [
    {
      id: groupId,
      name: 'Manual folder group',
      parentPath: null,
      connectionId: null,
      parentGroupId: null,
      createdFrom: 'manual',
      tabOrder: 0,
      isCollapsed: false,
      color: null,
      createdAt: now,
      updatedAt: now
    }
  ]
  state.folderWorkspaces = [
    {
      id: workspaceId,
      projectGroupId: groupId,
      name: workspaceName,
      folderPath,
      connectionId: null,
      linkedTask: null,
      linkedTaskSourceContext: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: now,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now
    }
  ]
  writeFileSync(dataFile, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')

  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null
  const workspaceRow = (page: Awaited<ReturnType<typeof session.launch>>['page']) =>
    page.locator(`[data-worktree-id="folder:${workspaceId}"]`)
  try {
    const first = await session.launch()
    firstApp = first.app
    await waitForSessionReady(first.page)
    await expect(workspaceRow(first.page)).toContainText(workspaceName)

    await session.close(firstApp)
    firstApp = null

    const second = await session.launch()
    secondApp = second.app
    await waitForSessionReady(second.page)
    await expect(workspaceRow(second.page)).toContainText(workspaceName)
  } finally {
    for (const app of [secondApp, firstApp]) {
      if (app) {
        await session.close(app)
      }
    }
    await session.dispose()
  }
})
