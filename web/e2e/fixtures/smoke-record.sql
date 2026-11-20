-- Seed after testing the empty-account path. Same isolation/account guard as smoke-news.sql.
INSERT INTO t_diagnosis (id,url,userId,result,confidence,probability,severity,
                         modelVersion,humanReviewStatus,recommendations)
SELECT 81001,'',id,'glaucoma',0.7,70,'moderate',
       'synthetic-smoke','AWAITING_REVIEW','Synthetic fixture. Not medical advice.'
FROM t_user
WHERE DATABASE()='diagnosis_ci' AND BINARY userAccount=BINARY @smokeAccount
  AND userAccount LIKE 'irisSmokeFixture%' AND isDelete=0;
