export const migration0009ReviewQueueHardeningSql = `
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_entities_open_surface
  ON pending_entities (lower(surface))
  WHERE status = 'pending';
`;
