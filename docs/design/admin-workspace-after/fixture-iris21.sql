USE diagnosis;
-- Iris 2.1 管理端证据采集用夹具（窗口内「有判读」状态）。
-- 明确标记：modelVersion = 'fixture-iris21'，采集结束后按该标记整段删除。
-- 数据落在本机 3306 的 diagnosis 库（当前 8081 后端连的就是它）。
INSERT INTO t_diagnosis
  (id, url, userId, result, confidence, severity, reexamineStatus, humanReviewStatus,
   aiRejected, modelVersion, createTime, isDelete)
VALUES
  (8900000000000000001, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-30_4027317000837089.jpg', 1915412470597001217, 'cataract',   95, 'moderate', 3, 'REVIEWED',        0, 'fixture-iris21', '2026-11-13 09:12:00', 0),
  (8900000000000000002, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-30_0955942204744016.jpg', 1913835897733287938, 'glaucoma',   88, 'severe',   1, 'AWAITING_REVIEW', 0, 'fixture-iris21', '2026-11-12 14:30:00', 0),
  (8900000000000000003, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-30_8418142450123121.jpg', 1915412470597001217, 'diabetes',   91, 'moderate', 1, 'AI_ONLY',         0, 'fixture-iris21', '2026-11-11 10:05:00', 0),
  (8900000000000000004, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2025-05-05_4043234199685902.jpg', 1913835897733287938, NULL,          NULL, NULL,      1, 'PENDING_AI',      1, 'fixture-iris21', '2026-11-10 16:44:00', 0),
  (8900000000000000005, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-28_2022667305600769.jpg', 1915412470597001217, 'amd',        83, 'moderate', 3, 'REVIEWED',        0, 'fixture-iris21', '2026-11-08 11:20:00', 0),
  (8900000000000000006, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2025-04-28_9778256800660013.png', 1913835897733287938, 'hypertension', 79, 'mild',    1, 'AWAITING_REVIEW', 0, 'fixture-iris21', '2026-11-06 08:55:00', 0),
  (8900000000000000007, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-30_4027317000837089.jpg', 1915412470597001217, 'cataract',   92, 'moderate', 1, 'AI_ONLY',         0, 'fixture-iris21', '2026-11-03 15:40:00', 0),
  (8900000000000000008, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-30_0955942204744016.jpg', 1913835897733287938, 'glaucoma',   90, 'severe',   3, 'REVIEWED',        0, 'fixture-iris21', '2026-10-29 19:10:00', 0),
  (8900000000000000009, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-30_8418142450123121.jpg', 1915412470597001217, 'myopia',     86, 'mild',     1, 'AI_ONLY',         0, 'fixture-iris21', '2026-10-24 09:05:00', 0),
  (8900000000000000010, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2025-05-05_4043234199685902.jpg', 1913835897733287938, 'diabetes',   94, 'moderate', 3, 'REVIEWED',        0, 'fixture-iris21', '2026-10-20 13:25:00', 0),
  (8900000000000000011, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2026-04-28_2022667305600769.jpg', 1915412470597001217, 'normal',     97, 'normal',   3, 'REVIEWED',        0, 'fixture-iris21', '2026-11-13 17:50:00', 0),
  (8900000000000000012, 'https://yuwen-diagnosis-1325795131.cos.ap-guangzhou.myqcloud.com//public/1913835897733287938/2025-04-28_9778256800660013.png', 1913835897733287938, 'cataract',   87, 'moderate', 1, 'AWAITING_REVIEW', 0, 'fixture-iris21', '2026-11-09 09:35:00', 0);
