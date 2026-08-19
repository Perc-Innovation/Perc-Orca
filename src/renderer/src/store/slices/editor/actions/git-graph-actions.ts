import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import { GIT_GRAPH_TAB_LABEL, buildGitGraphTabId } from '@/components/git-graph/git-graph-tab'
import type { OpenFile } from '../types/open-file'
import { openWorkspaceEditorItem } from '../tabs/workspace-editor-item'

export function createGitGraphActions(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'openGitGraph'> {
  return {
    // Why: the sidebar graph panel only fits the active branch; the whole-repo
    // graph gets the center pane, one live tab per workspace.
    openGitGraph: (worktreeId) => {
      const id = buildGitGraphTabId(worktreeId)
      set((s) => {
        const activation = {
          activeFileId: id,
          activeTabType: 'editor' as const,
          activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
          activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' as const }
        }
        if (s.openFiles.some((f) => f.id === id)) {
          return activation
        }
        const newFile: OpenFile = {
          id,
          filePath: id,
          relativePath: GIT_GRAPH_TAB_LABEL,
          worktreeId,
          language: 'plaintext',
          isDirty: false,
          mode: 'git-graph'
        }
        return { openFiles: [...s.openFiles, newFile], ...activation }
      })
      void openWorkspaceEditorItem(get(), id, worktreeId, GIT_GRAPH_TAB_LABEL, 'git-graph')
    }
  }
}
