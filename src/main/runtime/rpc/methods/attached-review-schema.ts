import { z } from 'zod'

/** Lives in its own module because worktree-create-schemas and worktree-schemas import values from
 *  each other at module scope: bundling them together leaves no evaluation order where this schema
 *  is initialized before the `z.array(AttachedReviewSchema)` calls that consume it. */
export const AttachedReviewSchema = z.object({
  provider: z.enum(['github', 'gitlab', 'bitbucket', 'azure-devops', 'gitea']),
  number: z.number().int().positive(),
  url: z.string().min(1),
  baseRef: z.string().optional(),
  title: z.string().optional(),
  state: z.enum(['open', 'merged', 'closed', 'draft']).optional()
})
