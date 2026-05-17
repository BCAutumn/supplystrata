export const migration0005RemoveLegacyReviewQueueSql = `
DROP TABLE IF EXISTS extraction_review_queue;
`;
