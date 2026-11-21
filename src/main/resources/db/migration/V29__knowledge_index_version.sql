ALTER TABLE t_knowledge_document
    ADD COLUMN indexVersion VARCHAR(36) NULL COMMENT '服务端索引处理版本；旧无版本片段须重新处理才可引用';
