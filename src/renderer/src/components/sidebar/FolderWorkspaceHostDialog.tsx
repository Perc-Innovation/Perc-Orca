import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getFolderWorkspacePathStatusTitle } from '@/lib/folder-workspace-path-status'
import type { FolderWorkspacePathStatus } from '../../../../shared/folder-workspace-path-status'
import type { ProjectGroup } from '../../../../shared/project-group-types'

const LOCAL_HOST_VALUE = 'local'
const PATH_CHECK_DEBOUNCE_MS = 400
const DEFAULT_WORKSPACE_NAME = 'Terminals'

type FolderWorkspaceHostDialogProps = {
  open: boolean
  projectGroup: ProjectGroup | null
  onOpenChange: (open: boolean) => void
}

/** Creates a folder workspace in a group while letting the user pin its host —
 *  local or any SSH target — independently of the group's own connection. */
export function FolderWorkspaceHostDialog({
  open,
  projectGroup,
  onOpenChange
}: FolderWorkspaceHostDialogProps): React.JSX.Element {
  const nameId = useId()
  const hostId = useId()
  const pathId = useId()
  const { sshTargetLabels, sshConnectionStates, createFolderWorkspace, fetchPathStatus } =
    useAppStore(
      useShallow((s) => ({
        sshTargetLabels: s.sshTargetLabels,
        sshConnectionStates: s.sshConnectionStates,
        createFolderWorkspace: s.createFolderWorkspace,
        fetchPathStatus: s.fetchFolderWorkspacePathStatus
      }))
    )
  const [name, setName] = useState(DEFAULT_WORKSPACE_NAME)
  // Why: seed from props in the initializers too — the reseed branch below only
  // fires on open/group transitions, never on the very first render.
  const [hostValue, setHostValue] = useState<string>(projectGroup?.connectionId ?? LOCAL_HOST_VALUE)
  const [path, setPath] = useState(projectGroup?.parentPath ?? '')
  const [pathStatus, setPathStatus] = useState<FolderWorkspacePathStatus | null>(null)
  const [checkingPath, setCheckingPath] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const pathCheckIdRef = useRef(0)

  // Why: seed synchronously on open so the first frame shows the group's own
  // host and folder instead of a stale draft from the previous group.
  const [previousOpenState, setPreviousOpenState] = useState({ open, groupId: projectGroup?.id })
  if (open !== previousOpenState.open || projectGroup?.id !== previousOpenState.groupId) {
    setPreviousOpenState({ open, groupId: projectGroup?.id })
    if (open) {
      setName(DEFAULT_WORKSPACE_NAME)
      setHostValue(projectGroup?.connectionId ?? LOCAL_HOST_VALUE)
      setPath(projectGroup?.parentPath ?? '')
      setPathStatus(null)
      setSubmitting(false)
      setSubmitError(null)
    }
  }

  const trimmedPath = path.trim()
  const connectionId = hostValue === LOCAL_HOST_VALUE ? null : hostValue

  useEffect(() => {
    if (!open || !trimmedPath) {
      setPathStatus(null)
      setCheckingPath(false)
      return
    }
    const checkId = pathCheckIdRef.current + 1
    pathCheckIdRef.current = checkId
    setCheckingPath(true)
    const timer = setTimeout(() => {
      void fetchPathStatus({ scope: 'path', path: trimmedPath, connectionId }, { force: true })
        .then((status) => {
          if (pathCheckIdRef.current === checkId) {
            setPathStatus(status)
          }
        })
        .catch(() => {
          if (pathCheckIdRef.current === checkId) {
            setPathStatus(null)
          }
        })
        .finally(() => {
          if (pathCheckIdRef.current === checkId) {
            setCheckingPath(false)
          }
        })
    }, PATH_CHECK_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [open, trimmedPath, connectionId, fetchPathStatus])

  const sshTargetOptions = [...sshTargetLabels.entries()]
    .map(([id, label]) => ({
      id,
      label,
      connected: sshConnectionStates.get(id)?.status === 'connected'
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
  const hostIsDisconnectedSsh =
    connectionId !== null && sshConnectionStates.get(connectionId)?.status !== 'connected'

  const pathExists = pathStatus?.exists === true && pathStatus.path === trimmedPath
  const pathStatusTitle = getFolderWorkspacePathStatusTitle(
    pathStatus && pathStatus.path === trimmedPath ? pathStatus : null
  )
  const canSubmit =
    Boolean(projectGroup) &&
    Boolean(name.trim()) &&
    Boolean(trimmedPath) &&
    pathExists &&
    !submitting

  const handleSubmit = useCallback(
    async (event?: React.FormEvent<HTMLFormElement>) => {
      event?.preventDefault()
      if (!projectGroup || !canSubmit) {
        return
      }
      setSubmitting(true)
      setSubmitError(null)
      try {
        // Why: always send the connection explicitly — null pins local — so the
        // workspace never silently inherits a group connection the user overrode.
        const workspace = await createFolderWorkspace({
          projectGroupId: projectGroup.id,
          name: name.trim(),
          folderPath: trimmedPath,
          connectionId
        })
        if (workspace) {
          onOpenChange(false)
        }
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : String(err))
      } finally {
        setSubmitting(false)
      }
    },
    [canSubmit, connectionId, createFolderWorkspace, name, onOpenChange, projectGroup, trimmedPath]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.sidebar.FolderWorkspaceHostDialog.title',
              'New folder workspace'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.sidebar.FolderWorkspaceHostDialog.description',
              'Open terminals in a folder of {{value0}} on the host you choose.',
              { value0: projectGroup?.name ?? '' }
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor={nameId}>
              {translate('auto.components.sidebar.FolderWorkspaceHostDialog.nameLabel', 'Name')}
            </Label>
            <Input
              id={nameId}
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder={DEFAULT_WORKSPACE_NAME}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={hostId}>
              {translate('auto.components.sidebar.FolderWorkspaceHostDialog.hostLabel', 'Host')}
            </Label>
            <Select value={hostValue} onValueChange={setHostValue}>
              <SelectTrigger id={hostId} className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={LOCAL_HOST_VALUE}>
                  {translate(
                    'auto.components.sidebar.FolderWorkspaceHostDialog.localHost',
                    'This computer'
                  )}
                </SelectItem>
                {sshTargetOptions.map((target) => (
                  <SelectItem key={target.id} value={target.id}>
                    {target.connected
                      ? target.label
                      : translate(
                          'auto.components.sidebar.FolderWorkspaceHostDialog.disconnectedHost',
                          '{{value0}} (disconnected)',
                          { value0: target.label }
                        )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hostIsDisconnectedSsh ? (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.sidebar.FolderWorkspaceHostDialog.connectHint',
                  'Connect this host to verify the folder and create the workspace.'
                )}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={pathId}>
              {translate(
                'auto.components.sidebar.FolderWorkspaceHostDialog.pathLabel',
                'Folder path'
              )}
            </Label>
            <Input
              id={pathId}
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder={translate(
                'auto.components.sidebar.FolderWorkspaceHostDialog.pathPlaceholder',
                '/path/to/folder/on/host'
              )}
            />
            {trimmedPath && !checkingPath && pathStatusTitle ? (
              <p className="text-xs text-destructive">{pathStatusTitle}</p>
            ) : null}
            {checkingPath ? (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.sidebar.FolderWorkspaceHostDialog.checkingPath',
                  'Checking folder…'
                )}
              </p>
            ) : null}
          </div>
          {submitError ? <p className="text-xs text-destructive">{submitError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {translate('auto.components.sidebar.FolderWorkspaceHostDialog.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting
                ? translate(
                    'auto.components.sidebar.FolderWorkspaceHostDialog.creating',
                    'Creating…'
                  )
                : translate(
                    'auto.components.sidebar.FolderWorkspaceHostDialog.create',
                    'Create workspace'
                  )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
