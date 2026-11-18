-- Only for a disposable diagnosis_ci schema. Set @smokeAccount to an existing
-- synthetic account created through /api/user/register; credentials stay outside Git.
INSERT INTO t_news (id,title,userId,content,summary,coverImg,status,publishTime)
SELECT 81002,'Synthetic smoke bulletin',id,
       '<p>Synthetic smoke content. Not medical advice.</p>',
       'Synthetic smoke content. Not medical advice.','',1,'2026-11-15 10:00:00'
FROM t_user
WHERE DATABASE()='diagnosis_ci' AND BINARY userAccount=BINARY @smokeAccount
  AND userAccount LIKE 'irisSmokeFixture%' AND isDelete=0;
